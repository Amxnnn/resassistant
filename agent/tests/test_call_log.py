from datetime import UTC, datetime

from livekit.agents.llm import ChatMessage

from agent.call_log import build_call_log, save_call_log
from agent.metrics import LatencyTracker
from agent.tools import new_call_id


async def test_call_log_carries_the_conversation_id_transcript_and_outcome(make_state, api):
    state = make_state()
    state.call_id = new_call_id()
    state.outcomes.append("booked")
    tracker = LatencyTracker(llm_model="m")
    tracker.add_message(ChatMessage(role="assistant", content=["Thanks for calling."]))
    tracker.add_message(
        ChatMessage(role="user", content=["A table for two?"], metrics={"stopped_speaking_at": 1.0})
    )
    tracker.add_message(
        ChatMessage(role="assistant", content=["Sure."], metrics={"started_speaking_at": 1.6})
    )

    log = build_call_log(
        state,
        tracker,
        channel="browser",
        dialed_number="+14155550123",
        started_at=datetime(2026, 10, 24, 14, 0, tzinfo=UTC),
        ended_at=datetime(2026, 10, 24, 14, 2, tzinfo=UTC),
    )
    assert log.call_id == state.call_id
    assert log.outcome == "booked"
    assert log.dialed_number is None  # browser calls have no dialled number
    assert log.started_at.isoformat() == "2026-10-24T19:30:00+05:30"  # restaurant's offset
    assert [(t.speaker, t.text) for t in log.turns] == [
        ("agent", "Thanks for calling."),
        ("caller", "A table for two?"),
        ("agent", "Sure."),
    ]
    assert log.turns[2].latency.total_ms == 600

    saved = []
    original = api.create_call_log

    async def recording(request):
        saved.append(request)
        return await original(request)

    api.create_call_log = recording
    await save_call_log(state, log)
    assert saved == [log]


def test_a_chat_log_has_no_dialled_number(make_state):
    state = make_state(caller_phone="+919876543210")
    tracker = LatencyTracker(llm_model="m")
    tracker.add_message(ChatMessage(role="user", content=["is there parking"]))
    tracker.add_message(ChatMessage(role="assistant", content=["Yes, valet from 6 PM."], metrics={}))
    log = build_call_log(
        state,
        tracker,
        channel="telegram",
        dialed_number="+14155550123",
        started_at=datetime(2026, 10, 24, 14, 0, tzinfo=UTC),
        ended_at=datetime(2026, 10, 24, 14, 1, tzinfo=UTC),
    )
    assert log.channel == "telegram" and log.dialed_number is None
    assert log.caller_number == "+919876543210"  # the number the guest shared
    assert log.turns[1].latency.total_ms is None  # no voice in a chat
