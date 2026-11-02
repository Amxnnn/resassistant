"""Telegram calls: the bridge's audio and room handling, and how the agent recognises such a call.

The Telegram side (agent/telegram_call/__main__.py) needs a logged-in account and isn't tested here.
"""

import asyncio
from array import array
from types import SimpleNamespace

import jwt
import pytest
from livekit import rtc

import agent.telegram_call.bridge as bridge_module
from agent.main import caller_audio, identify_call
from agent.telegram_call.bridge import CATCH_UP, FRAME_BYTES, CallBridge, bridge_token, is_silent

AGENT = rtc.ParticipantKind.PARTICIPANT_KIND_AGENT
STANDARD = rtc.ParticipantKind.PARTICIPANT_KIND_STANDARD


def voice(ms: int = 10) -> bytes:
    """Loud enough to be speech: alternating samples of +-8000."""
    samples = FRAME_BYTES // 2 * ms // 10
    return array("h", [8000, -8000] * (samples // 2)).tobytes()


def silence(ms: int = 10) -> bytes:
    return bytes(FRAME_BYTES * ms // 10)


class FakeRoom(rtc.EventEmitter):
    def __init__(self) -> None:
        super().__init__()
        self.remote_participants: dict = {}
        self.published: list = []
        self.disconnected = False
        self.local_participant = SimpleNamespace(publish_track=self._publish)

    async def _publish(self, track, options):
        self.published.append((track, options))

    async def disconnect(self):
        self.disconnected = True


class FakeSource:
    def __init__(self) -> None:
        self.frames: list[rtc.AudioFrame] = []
        self.closed = False

    async def capture_frame(self, frame):
        self.frames.append(frame)

    async def aclose(self):
        self.closed = True


def make_bridge():
    room, source, sent = FakeRoom(), FakeSource(), []

    async def send(pcm):
        sent.append(pcm)

    return CallBridge(room, send, source=source), room, source, sent


def participant(kind=AGENT, identity="agent-1"):
    return SimpleNamespace(kind=kind, identity=identity)


def test_the_token_joins_one_room_as_the_caller_with_the_attributes_the_agent_reads():
    token = bridge_token(
        "key",
        "secret-" + "x" * 32,
        room="telegram-call-1",
        identity="telegram-42",
        name="Asha",
        attributes={"call_channel": "telegram", "restaurant_phone": "+14155550123"},
    )
    claims = jwt.decode(token, "secret-" + "x" * 32, algorithms=["HS256"])
    assert claims["sub"] == "telegram-42" and claims["name"] == "Asha"
    assert claims["video"]["room"] == "telegram-call-1" and claims["video"]["roomJoin"] is True
    assert claims["attributes"] == {"call_channel": "telegram", "restaurant_phone": "+14155550123"}


def test_silence_is_told_apart_from_speech():
    assert is_silent(silence()) and not is_silent(voice())


async def test_agent_audio_goes_to_telegram_in_whole_10_ms_frames():
    bridge, *_ = make_bridge()
    bridge.to_caller(voice(25))
    assert bridge._to_caller.qsize() == 2  # the last 5 ms wait for the rest of their frame
    bridge.to_caller(voice(5))
    assert bridge._to_caller.qsize() == 3
    assert all(len(f) == FRAME_BYTES for f in bridge._to_caller._queue)


async def test_a_backlog_sheds_silence_but_keeps_every_word():
    bridge, *_ = make_bridge()
    for _ in range(CATCH_UP):
        bridge.to_caller(voice())
    bridge.to_caller(silence())  # behind: a pause is dropped to catch up
    assert bridge._to_caller.qsize() == CATCH_UP
    bridge.to_caller(voice())  # speech never is
    assert bridge._to_caller.qsize() == CATCH_UP + 1

    fresh, *_ = make_bridge()
    fresh.to_caller(silence())  # not behind: silence plays like anything else
    assert fresh._to_caller.qsize() == 1


async def test_audio_goes_both_ways_once_the_call_is_connected(monkeypatch):
    monkeypatch.setattr(rtc.LocalAudioTrack, "create_audio_track", staticmethod(lambda name, source: name))
    bridge, room, source, sent = make_bridge()
    bridge.from_caller(voice())  # arrives as Telegram connects, before the room hears anything
    await bridge.start_audio()
    [(track, options)] = room.published
    assert track == "telegram_caller" and options.source == rtc.TrackSource.SOURCE_MICROPHONE

    frames = [voice(), silence(), voice()]
    for frame in frames:
        bridge.to_caller(frame)
    started = asyncio.get_running_loop().time()
    await asyncio.sleep(0.15)
    assert sent == frames  # in order
    assert asyncio.get_running_loop().time() - started >= 0.02  # paced, not all at once
    assert [f.samples_per_channel for f in source.frames] == [480]  # 10 ms at 48 kHz, mono

    await bridge.aclose()
    assert room.disconnected and source.closed and bridge.ended.is_set()


async def test_the_bridge_waits_for_the_agent_and_gives_up_when_the_call_ends():
    bridge, room, *_ = make_bridge()
    room.emit("participant_connected", participant(STANDARD, "someone"))
    assert not await bridge.wait_for_agent(0.05)  # only the agent counts
    room.emit("participant_connected", participant())
    assert await bridge.wait_for_agent(1)

    hung_up, *_ = make_bridge()
    hung_up.ended.set()  # the caller hung up while it rang
    assert not await hung_up.wait_for_agent(1)


async def test_the_agent_leaving_or_the_room_closing_ends_the_call():
    bridge, room, *_ = make_bridge()
    room.emit("participant_disconnected", participant(STANDARD, "someone"))
    assert not bridge.ended.is_set()
    room.emit("participant_disconnected", participant())
    assert bridge.ended.is_set()

    closed, closed_room, *_ = make_bridge()
    closed_room.emit("disconnected", "ROOM_DELETED")  # the agent hung up: it deletes the room
    assert closed.ended.is_set()


async def test_only_the_agents_voice_reaches_the_caller(monkeypatch):
    bridge, room, *_ = make_bridge()
    followed = []

    async def follow(track):
        followed.append(track)

    monkeypatch.setattr(bridge, "_agent_audio", follow)
    audio = SimpleNamespace(kind=rtc.TrackKind.KIND_AUDIO)
    voice_track = SimpleNamespace(source=rtc.TrackSource.SOURCE_MICROPHONE)
    hum = SimpleNamespace(source=rtc.TrackSource.SOURCE_UNKNOWN)  # BackgroundAudioPlayer's track
    room.emit("track_subscribed", audio, hum, participant())
    room.emit("track_subscribed", audio, voice_track, participant(STANDARD, "someone"))
    room.emit("track_subscribed", audio, voice_track, participant())
    await asyncio.sleep(0)
    assert followed == [audio]
    await bridge.aclose()


# -- the agent's side ---------------------------------------------------------------------------


def job(attributes: dict, kind=STANDARD, identity="telegram-42"):
    caller = SimpleNamespace(kind=kind, attributes=attributes, identity=identity)

    async def wait_for_participant():
        return caller

    return SimpleNamespace(is_fake_job=lambda: False, wait_for_participant=wait_for_participant)


async def test_the_agent_recognises_a_telegram_call_and_its_callers_number():
    attributes = {
        "call_channel": "telegram",
        "restaurant_phone": "+14155550123",
        "caller_phone": "+919876543210",
    }
    call = await identify_call(job(attributes))
    assert (call.channel, call.caller_phone, call.dialed, call.identity) == (
        "telegram",
        "+919876543210",
        "+14155550123",
        "telegram-42",
    )
    unknown = await identify_call(job({"call_channel": "telegram", "restaurant_phone": "+14155550123"}))
    assert unknown.channel == "telegram" and unknown.caller_phone is None


async def test_a_browser_test_call_is_still_a_browser_call():
    call = await identify_call(job({"restaurant_phone": "+14155550123"}))
    assert (call.channel, call.caller_phone, call.dialed) == ("browser", None, "+14155550123")


@pytest.fixture
def room_with_caller():
    room = FakeRoom()
    caller = SimpleNamespace(track_publications={})
    room.remote_participants["telegram-42"] = caller
    return room, caller


async def test_the_greeting_waits_until_the_telegram_call_is_connected(room_with_caller):
    room, caller = room_with_caller
    waiting = asyncio.create_task(caller_audio(room, "telegram-42", timeout=1))
    await asyncio.sleep(0.05)
    assert not waiting.done()  # still ringing
    caller.track_publications["TR_1"] = SimpleNamespace(kind=rtc.TrackKind.KIND_AUDIO)
    room.emit("track_published", None, caller)
    assert await waiting


async def test_the_greeting_goes_ahead_if_the_call_never_connects(room_with_caller):
    room, _caller = room_with_caller
    assert not await caller_audio(room, "telegram-42", timeout=0.05)
    assert await caller_audio(room, "telegram-42", timeout=0.05) is False


async def test_audio_already_published_needs_no_wait(room_with_caller):
    room, caller = room_with_caller
    caller.track_publications["TR_1"] = SimpleNamespace(kind=rtc.TrackKind.KIND_AUDIO)
    assert await caller_audio(room, "telegram-42", timeout=0.01)


def test_the_bridge_module_needs_no_telegram_libraries():
    """CI installs no Telegram call libraries, so the bridge must import without them."""
    assert "pytgcalls" not in bridge_module.__dict__ and "telethon" not in bridge_module.__dict__
