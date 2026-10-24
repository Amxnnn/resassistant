from livekit.agents.llm import ChatMessage

from agent.metrics import LatencyTracker, TurnLatency, percentile


def caller(text: str, **metrics) -> ChatMessage:
    return ChatMessage(role="user", content=[text], metrics=metrics)


def agent(text: str, *, interrupted: bool = False, **metrics) -> ChatMessage:
    return ChatMessage(role="assistant", content=[text], interrupted=interrupted, metrics=metrics)


def test_agent_reply_is_paired_with_the_caller_turn_before_it():
    tracker = LatencyTracker(llm_model="gemini-test")
    tracker.add_message(agent("Thanks for calling."))
    tracker.add_message(
        caller(
            "A table for four on Saturday?",
            stopped_speaking_at=100.0,
            end_of_turn_delay=0.21,
            transcription_delay=0.14,
        )
    )
    turn = tracker.add_message(
        agent("Sure, what time?", started_speaking_at=100.735, llm_node_ttft=0.42, tts_node_ttfb=0.095)
    )

    assert [t.speaker for t in tracker.turns] == ["agent", "caller", "agent"]
    assert tracker.turns[0].latency is None  # the greeting answers nobody
    assert turn.latency == TurnLatency(
        eou_ms=210, stt_ms=140, llm_ttft_ms=420, tts_ttfb_ms=95, total_ms=735, llm_model="gemini-test"
    )


def test_a_second_agent_message_without_a_new_caller_turn_has_no_latency():
    tracker = LatencyTracker(llm_model=None)
    tracker.add_message(caller("Hi", stopped_speaking_at=1.0))
    tracker.add_message(agent("Hello!", started_speaking_at=1.5))
    follow_up = tracker.add_message(agent("Anything else?", started_speaking_at=4.0))

    assert follow_up.latency is None


def test_missing_timestamps_leave_total_empty_but_keep_the_stages():
    tracker = LatencyTracker(llm_model=None)
    tracker.add_message(caller("Hi", end_of_turn_delay=0.2))
    turn = tracker.add_message(agent("Hello!", interrupted=True, llm_node_ttft=0.4))

    assert turn.interrupted
    assert turn.latency.total_ms is None
    assert turn.latency.eou_ms == 200
    assert turn.latency.llm_ttft_ms == 400


def test_summary_reports_voice_to_voice_percentiles():
    tracker = LatencyTracker(llm_model="m")
    for start, total in enumerate([0.6, 0.7, 0.8, 0.9, 2.0]):
        tracker.add_message(caller("q", stopped_speaking_at=float(start)))
        tracker.add_message(agent("a", started_speaking_at=start + total))

    summary = tracker.summary()
    assert summary["turns"] == 5
    assert summary["total_p50_ms"] == 800
    assert summary["total_p95_ms"] == 2000


def test_percentile_uses_nearest_rank():
    assert percentile([], 50) is None
    assert percentile([400, 100, 300, 200], 50) == 200
    assert percentile([400, 100, 300, 200], 95) == 400
