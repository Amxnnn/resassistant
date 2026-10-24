"""Measure response delay the way a caller hears it, over real audio in a LiveKit room.

A scripted caller joins a room, speaks each line below (synthesised once with a Deepgram voice and
cached), and measures the gap from the end of its own speech to the first sound of the agent's
reply. The agent's own log shows where that time went (end of turn, STT, LLM, TTS) for each turn.

Run the agent first (uv run python -m agent.main dev; and the web app when DATA_SOURCE=api), then
from agent/:
    uv run python scripts/voice_benchmark.py
Uses LiveKit, Deepgram and LLM quota like a short real call. It books nothing: it never says yes
to a read-back.
"""

from __future__ import annotations

import asyncio
import hashlib
import os
import statistics
import time
import uuid
from collections import deque
from pathlib import Path

import httpx
import numpy as np
from dotenv import load_dotenv
from livekit import api, rtc

SAMPLE_RATE = 24000
FRAME_MS = 20
SAMPLES = SAMPLE_RATE * FRAME_MS // 1000
SPEECH_RMS = 400  # int16 RMS above this counts as the agent speaking
REPLY_DONE_SILENCE = 1.6  # seconds of agent silence that end its reply
CACHE = Path(".cache/voice_benchmark")

LINES = [
    "Hi, what time do you open tomorrow?",
    "Do you have any vegan dishes?",
    "Is there parking near the restaurant?",
    "Can I get a table for two this Tuesday at eight pm?",
    "Does the paneer tikka have nuts in it?",
]


def synthesise(text: str, key: str) -> np.ndarray:
    """The caller's voice: Deepgram Aura, a different voice from the agent's, cached on disk."""
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"{hashlib.sha1(text.encode()).hexdigest()[:12]}.pcm"
    if not path.exists():
        resp = httpx.post(
            "https://api.deepgram.com/v1/speak",
            params={"model": "aura-2-thalia-en", "encoding": "linear16", "sample_rate": SAMPLE_RATE},
            headers={"Authorization": f"Token {key}"},
            json={"text": text},
            timeout=30,
        )
        resp.raise_for_status()
        path.write_bytes(resp.content)
    return np.frombuffer(path.read_bytes(), dtype=np.int16)


class Caller:
    def __init__(self) -> None:
        self.room = rtc.Room()
        # A short queue keeps capture_frame in step with real time, so "finished speaking" is exact.
        self.source = rtc.AudioSource(SAMPLE_RATE, 1, queue_size_ms=60)
        self._frames: deque[bytes] = deque()
        self._spoken = asyncio.Event()
        self.ended_at = 0.0
        self.speaking = False
        self.agent_loud_at = 0.0  # last time agent audio was above the threshold
        self.first_loud_after: float | None = None
        self.transcripts: list[str] = []

    async def join(self) -> None:
        room_name = f"bench-{uuid.uuid4().hex[:6]}"
        token = (
            api.AccessToken(os.environ["LIVEKIT_API_KEY"], os.environ["LIVEKIT_API_SECRET"])
            .with_identity("bench-caller")
            .with_grants(api.VideoGrants(room_join=True, room=room_name))
            .to_jwt()
        )

        @self.room.on("track_subscribed")
        def on_track(track: rtc.Track, publication: rtc.RemoteTrackPublication, participant):
            # The agent's voice, not its background-audio track.
            if track.kind == rtc.TrackKind.KIND_AUDIO and "background" not in publication.name:
                asyncio.ensure_future(self._listen(track))

        async def read_text(reader: rtc.TextStreamReader, who: str) -> None:
            try:
                text = await reader.read_all()
            except rtc.data_stream.StreamError:  # the room closed mid-transcript
                return
            if reader.info.attributes.get("lk.transcription_final") == "true" and text.strip():
                self.transcripts.append(f"{who.split('-')[0]}: {text}")

        self.room.register_text_stream_handler(
            "lk.transcription", lambda reader, who: asyncio.ensure_future(read_text(reader, who))
        )
        await self.room.connect(os.environ["LIVEKIT_URL"], token)
        track = rtc.LocalAudioTrack.create_audio_track("caller-mic", self.source)
        await self.room.local_participant.publish_track(
            track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
        )
        asyncio.ensure_future(self._pump())
        print(f"joined {room_name}")

    async def _listen(self, track: rtc.Track) -> None:
        async for event in rtc.AudioStream(track, sample_rate=SAMPLE_RATE, num_channels=1):
            samples = np.frombuffer(event.frame.data, dtype=np.int16).astype(np.float32)
            if samples.size and float(np.sqrt(np.mean(samples**2))) > SPEECH_RMS:
                now = time.perf_counter()
                self.agent_loud_at = now
                if self.first_loud_after is None and not self.speaking:
                    self.first_loud_after = now

    async def _pump(self) -> None:
        """The mic's only writer: queued speech when there is some, silence otherwise, like a phone
        line. (Two tasks capturing frames at once makes LiveKit reject them.)"""
        quiet = np.zeros(SAMPLES, dtype=np.int16).tobytes()
        while True:
            data = self._frames.popleft() if self._frames else quiet
            await self.source.capture_frame(rtc.AudioFrame(data, SAMPLE_RATE, 1, SAMPLES))
            if self.speaking and not self._frames:
                self.speaking = False
                self.ended_at = time.perf_counter()
                self._spoken.set()

    async def say(self, audio: np.ndarray) -> float:
        """Speak in real time; returns when the last sample has gone out."""
        padded = np.pad(audio, (0, -len(audio) % SAMPLES))
        self._spoken.clear()
        self._frames.extend(padded[i : i + SAMPLES].tobytes() for i in range(0, len(padded), SAMPLES))
        self.speaking = True
        await self._spoken.wait()
        return self.ended_at

    async def wait_for_reply(self, timeout: float = 25) -> None:
        """Wait until the agent has started a new reply and then gone quiet."""
        deadline = time.perf_counter() + timeout
        while time.perf_counter() < deadline:
            started = self.first_loud_after is not None
            if started and time.perf_counter() - self.agent_loud_at > REPLY_DONE_SILENCE:
                return
            await asyncio.sleep(0.05)


async def main() -> None:
    load_dotenv()
    caller = Caller()
    lines = [(text, synthesise(text, os.environ["DEEPGRAM_API_KEY"])) for text in LINES]
    await caller.join()
    caller.first_loud_after = None
    await caller.wait_for_reply(timeout=40)  # the greeting
    results = []
    for text, audio in lines:
        caller.first_loud_after = None
        ended = await caller.say(audio)
        await caller.wait_for_reply()
        delay = (caller.first_loud_after - ended) if caller.first_loud_after else None
        results.append((text, delay))
        print(f"{'-' if delay is None else f'{delay * 1000:5.0f} ms'}  {text}")
    measured = [d for _, d in results if d is not None]
    if measured:
        print(
            f"\ncaller-heard delay over {len(measured)} turns: "
            f"median {statistics.median(measured) * 1000:.0f} ms, worst {max(measured) * 1000:.0f} ms"
        )
    print("\n".join(caller.transcripts[-2 * len(lines) :]))
    await caller.room.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
