"""One Telegram call bridged into a LiveKit room, where the voice agent answers it.

Both sides carry 48 kHz mono, 16-bit PCM in 10 ms frames: Telegram's call library (ntgcalls) and
LiveKit both take that format, so nothing is resampled.
- The caller's voice comes from Telegram and is published as this participant's microphone.
- The agent's voice comes from its microphone track in the room and goes to Telegram one frame
  every 10 ms, like a live microphone. Its other track, the restaurant hum, stays in the room.

The bridge joins the room as an ordinary participant carrying the attributes the agent reads
(main.py identify_call), so the agent treats it like any call: same pipeline, tools and call log.
"""

from __future__ import annotations

import asyncio
import logging
from array import array
from collections.abc import Awaitable, Callable
from typing import Any

from livekit import api, rtc

logger = logging.getLogger("agent.telegram_call")

SAMPLE_RATE = 48000
CHANNELS = 1
FRAME_SECONDS = 0.01
FRAME_BYTES = int(SAMPLE_RATE * FRAME_SECONDS) * CHANNELS * 2  # 960
# Agent audio waiting for Telegram. Past CATCH_UP frames of backlog, silent frames are dropped, so a
# delay that builds up (a burst after a network hiccup) melts away in the next pause instead of
# lagging every later reply. Past MAX_BACKLOG frames, everything new is dropped.
CATCH_UP = 10  # 100 ms
MAX_BACKLOG = 300  # 3 s
SILENT_PEAK = 200  # out of 32767: about -44 dBFS, quieter than any speech

SendAudio = Callable[[bytes], Awaitable[Any]]
AGENT = rtc.ParticipantKind.PARTICIPANT_KIND_AGENT


def bridge_token(
    api_key: str, api_secret: str, *, room: str, identity: str, name: str, attributes: dict[str, str]
) -> str:
    """A token that joins `room` as the caller, with the attributes the agent reads."""
    grants = api.VideoGrants(room_join=True, room=room, can_publish=True, can_subscribe=True)
    return (
        api.AccessToken(api_key, api_secret)
        .with_identity(identity)
        .with_name(name)
        .with_grants(grants)
        .with_attributes(attributes)
        .to_jwt()
    )


def is_silent(frame: bytes) -> bool:
    samples = array("h", frame)
    return not samples or max(map(abs, samples)) < SILENT_PEAK


class CallBridge:
    """Create, connect(), wait_for_agent(), then start_audio() once Telegram has connected the call."""

    def __init__(
        self, room: rtc.Room, send_to_caller: SendAudio, *, source: rtc.AudioSource | None = None
    ) -> None:
        self._room = room
        self._send = send_to_caller
        self._source = source or rtc.AudioSource(SAMPLE_RATE, CHANNELS)
        self._from_caller: asyncio.Queue[bytes] = asyncio.Queue()
        self._to_caller: asyncio.Queue[bytes] = asyncio.Queue()
        self._partial = b""  # agent audio short of a whole frame
        self._agent_here = asyncio.Event()
        self.ended = asyncio.Event()  # the room is over: the agent hung up, left, or the bridge closed
        self._tasks: set[asyncio.Task[None]] = set()
        room.on("participant_connected", self._on_participant)
        room.on("participant_disconnected", self._on_participant_left)
        room.on("track_subscribed", self._on_track)
        room.on("disconnected", self._on_disconnected)

    async def connect(self, url: str, token: str) -> None:
        """Join (and so create) the room. LiveKit then dispatches the agent to it."""
        await self._room.connect(url, token)
        for participant in self._room.remote_participants.values():
            self._on_participant(participant)

    async def wait_for_agent(self, timeout: float) -> bool:
        """True once the agent is in the room; False if it isn't within `timeout` or the call ends."""
        waits = [asyncio.ensure_future(self._agent_here.wait()), asyncio.ensure_future(self.ended.wait())]
        try:
            await asyncio.wait(waits, timeout=timeout, return_when=asyncio.FIRST_COMPLETED)
        finally:
            for wait in waits:
                wait.cancel()
        return self._agent_here.is_set() and not self.ended.is_set()

    async def start_audio(self) -> None:
        """Telegram has connected the call: publish the caller's voice and start sending the agent's.

        The agent greets once this track appears (main.py caller_audio), so nothing is said early.
        """
        track = rtc.LocalAudioTrack.create_audio_track("telegram_caller", self._source)
        options = rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
        await self._room.local_participant.publish_track(track, options)
        self._spawn(self._caller_to_room())
        self._spawn(self._agent_to_caller())

    def from_caller(self, pcm: bytes) -> None:
        """Audio from the Telegram call, queued in arrival order for the room."""
        self._from_caller.put_nowait(pcm)

    def to_caller(self, pcm: bytes) -> None:
        """Audio from the agent, queued for Telegram in whole frames."""
        pcm = self._partial + pcm
        whole = len(pcm) - len(pcm) % FRAME_BYTES
        self._partial = pcm[whole:]
        for start in range(0, whole, FRAME_BYTES):
            frame = pcm[start : start + FRAME_BYTES]
            backlog = self._to_caller.qsize()
            if backlog >= MAX_BACKLOG or (backlog >= CATCH_UP and is_silent(frame)):
                continue
            self._to_caller.put_nowait(frame)

    async def aclose(self) -> None:
        self.ended.set()
        for task in self._tasks:
            task.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        await self._room.disconnect()
        await self._source.aclose()

    async def _caller_to_room(self) -> None:
        while True:
            pcm = await self._from_caller.get()
            frame = rtc.AudioFrame(pcm, SAMPLE_RATE, CHANNELS, len(pcm) // (2 * CHANNELS))
            await self._source.capture_frame(frame)

    async def _agent_to_caller(self) -> None:
        """One frame every 10 ms, as a live microphone would deliver it; a pause restarts the clock."""
        loop = asyncio.get_running_loop()
        due = 0.0
        failed = False
        while True:
            frame = await self._to_caller.get()
            wait = due - loop.time()
            if wait > 0:
                await asyncio.sleep(wait)
            else:
                due = loop.time()
            try:
                await self._send(frame)
            except Exception as e:  # the call is ending: the bridge closes shortly
                if not failed:
                    logger.warning("couldn't send audio to the Telegram call: %s", e)
                failed = True
            due += FRAME_SECONDS

    async def _agent_audio(self, track: rtc.Track) -> None:
        stream = rtc.AudioStream(track, sample_rate=SAMPLE_RATE, num_channels=CHANNELS, frame_size_ms=10)
        try:
            async for event in stream:
                self.to_caller(bytes(event.frame.data))
        finally:
            await stream.aclose()

    def _on_participant(self, participant: rtc.RemoteParticipant) -> None:
        if participant.kind == AGENT:
            self._agent_here.set()

    def _on_participant_left(self, participant: rtc.RemoteParticipant) -> None:
        if participant.kind == AGENT:
            logger.info("the agent left the room")
            self.ended.set()

    def _on_track(self, track: rtc.Track, publication: rtc.RemoteTrackPublication, participant) -> None:
        # The agent's voice only: its microphone track, not the background hum it also publishes.
        if (
            participant.kind == AGENT
            and track.kind == rtc.TrackKind.KIND_AUDIO
            and publication.source == rtc.TrackSource.SOURCE_MICROPHONE
        ):
            self._spawn(self._agent_audio(track))

    def _on_disconnected(self, *_args) -> None:
        self.ended.set()

    def _spawn(self, coro) -> None:
        task = asyncio.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
