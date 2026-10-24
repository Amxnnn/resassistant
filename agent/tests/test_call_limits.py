import asyncio

from livekit.agents import UserStateChangedEvent

from agent.call_limits import CHECK_IN, SILENCE_GOODBYE, TIME_UP_GOODBYE, CallLimits


class FakeSession:
    def __init__(self) -> None:
        self.handlers: dict[str, list] = {}
        self.said: list[str] = []
        self.shut_down = False

    def on(self, event, handler):
        self.handlers.setdefault(event, []).append(handler)

    def emit(self, event, ev):
        for handler in self.handlers.get(event, []):
            handler(ev)

    def say(self, text, **_):
        self.said.append(text)
        done = asyncio.get_running_loop().create_future()
        done.set_result(None)
        return done

    def interrupt(self, **_):
        done = asyncio.get_running_loop().create_future()
        done.set_result(None)
        return done

    def shutdown(self):
        self.shut_down = True


class FakeJob:
    def __init__(self) -> None:
        self.room_deleted = False
        self.shutdown_reason = None

    async def delete_room(self):
        self.room_deleted = True

    def shutdown(self, reason=""):
        self.shutdown_reason = reason


def state(new: str) -> UserStateChangedEvent:
    return UserStateChangedEvent(old_state="listening", new_state=new)


async def test_silence_gets_one_check_in_then_a_goodbye_and_hang_up():
    # LiveKit reports "away" once and stays there, so a single event must lead to the hang-up.
    session, job = FakeSession(), FakeJob()
    CallLimits(session, job, max_call_seconds=60, silence_grace_seconds=0.01).start()

    session.emit("user_state_changed", state("away"))
    await asyncio.sleep(0.05)
    assert session.said == [CHECK_IN, SILENCE_GOODBYE]
    assert session.shut_down and job.room_deleted and job.shutdown_reason == "caller silent"


async def test_answering_the_check_in_keeps_the_call_going():
    session, job = FakeSession(), FakeJob()
    CallLimits(session, job, max_call_seconds=60, silence_grace_seconds=0.05).start()

    session.emit("user_state_changed", state("away"))
    await asyncio.sleep(0.01)
    session.emit("user_state_changed", state("speaking"))
    await asyncio.sleep(0.1)
    assert session.said == [CHECK_IN]
    assert not session.shut_down

    session.emit("user_state_changed", state("away"))  # silent again later: a fresh check-in
    await asyncio.sleep(0.01)
    assert session.said == [CHECK_IN, CHECK_IN]


async def test_calls_are_wrapped_up_at_the_time_limit():
    session, job = FakeSession(), FakeJob()
    CallLimits(session, job, max_call_seconds=0.01).start()
    await asyncio.sleep(0.05)
    assert session.said == [TIME_UP_GOODBYE]
    assert job.shutdown_reason == "max call length reached"


async def test_hang_up_happens_once():
    session, job = FakeSession(), FakeJob()
    limits = CallLimits(session, job, max_call_seconds=60)
    await limits.hang_up("Bye!", reason="test")
    await limits.hang_up("Bye again!", reason="test")
    assert session.said == ["Bye!"]


class FakeSpeech:
    def __init__(self) -> None:
        self.callbacks = []

    def add_done_callback(self, callback):
        self.callbacks.append(callback)

    def finish(self):
        for callback in self.callbacks:
            callback(self)


async def test_end_call_hangs_up_only_after_the_goodbye_has_played():
    session, job = FakeSession(), FakeJob()
    limits = CallLimits(session, job, max_call_seconds=60)
    goodbye = FakeSpeech()
    limits.end_after(goodbye)
    await asyncio.sleep(0)
    assert not session.shut_down  # still saying goodbye

    goodbye.finish()
    await asyncio.sleep(0)
    assert session.shut_down and job.room_deleted and job.shutdown_reason == "caller finished"

    session.emit("user_state_changed", state("away"))  # no check-ins once we're hanging up
    assert session.said == []
