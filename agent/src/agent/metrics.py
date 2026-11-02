"""Per-turn latency: how long the caller waits between finishing a sentence and hearing the reply.

LiveKit attaches timings to each chat message. Caller messages carry the end-of-turn and
transcription delays; agent messages carry LLM time-to-first-token and TTS time-to-first-audio.
Pairing each agent reply with the caller message before it gives one row per turn, in the
shape of CallTurn / TurnLatency in contracts/openapi.yaml, ready for POST /api/agent/calls.
"""

from __future__ import annotations

import logging
import math
import statistics
from dataclasses import dataclass, field
from datetime import UTC, datetime

from livekit.agents import (
    AgentSession,
    ConversationItemAddedEvent,
    FunctionToolsExecutedEvent,
    MetricsCollectedEvent,
)
from livekit.agents.llm import ChatMessage
from livekit.agents.metrics import LLMMetrics

logger = logging.getLogger("agent.metrics")


def _ms(seconds: float | None) -> int | None:
    return None if seconds is None else round(seconds * 1000)


def percentile(values: list[int], pct: float) -> int | None:
    """Nearest-rank percentile; None for an empty list."""
    if not values:
        return None
    ordered = sorted(values)
    rank = max(1, math.ceil(pct / 100 * len(ordered)))
    return ordered[rank - 1]


@dataclass
class TurnLatency:
    eou_ms: int | None  # end of caller speech -> end-of-turn decision
    stt_ms: int | None  # end of caller speech -> final transcript
    llm_ttft_ms: int | None  # LLM time to first token
    tts_ttfb_ms: int | None  # TTS time to first audio
    total_ms: int | None  # end of caller speech -> agent starts speaking (voice-to-voice)
    llm_model: str | None


@dataclass
class Turn:
    index: int
    speaker: str  # "caller" or "agent"
    text: str
    at: datetime
    interrupted: bool
    latency: TurnLatency | None = None


@dataclass
class LatencyTracker:
    llm_model: str | None  # the configured chain; each turn records the model that answered it
    turns: list[Turn] = field(default_factory=list)
    _pending_caller: ChatMessage | None = field(default=None, init=False, repr=False)
    _answered_by: str | None = field(default=None, init=False, repr=False)

    def attach(self, session: AgentSession) -> None:
        session.on("conversation_item_added", self._on_item_added)
        session.on("function_tools_executed", self._on_tools_executed)
        session.on("metrics_collected", self._on_metrics)

    def _on_item_added(self, ev: ConversationItemAddedEvent) -> None:
        if isinstance(ev.item, ChatMessage):
            self.add_message(ev.item)

    def _on_metrics(self, ev: MetricsCollectedEvent) -> None:
        if isinstance(ev.metrics, LLMMetrics):
            self.add_llm_request(ev.metrics)

    def add_llm_request(self, m: LLMMetrics) -> None:
        """One LLM request: which model answered (after any fallback) and its tokens, the budget the
        free tiers limit per minute and per day."""
        if m.cancelled:
            return
        self._answered_by = (m.metadata.model_name if m.metadata else None) or m.label
        logger.info(
            "llm request | %s | %d prompt + %d output tokens | first token %s ms",
            self._answered_by,
            m.prompt_tokens,
            m.completion_tokens,
            _ms(m.ttft) if m.ttft >= 0 else "-",
        )

    def _on_tools_executed(self, ev: FunctionToolsExecutedEvent) -> None:
        """Tool calls add an API round trip and another LLM request to a turn: log what ran."""
        ran = [
            f"{call.name} {_ms(out.created_at - call.created_at)} ms"
            for call, out in zip(ev.function_calls, ev.function_call_outputs, strict=False)
            if out is not None
        ]
        if ran:
            logger.info("tools: %s", ", ".join(ran))

    def add_message(self, msg: ChatMessage) -> Turn | None:
        if msg.role == "user":
            self._pending_caller = msg
            turn = self._record(msg, "caller", latency=None)
            logger.info("caller: %s", turn.text)
            return turn
        if msg.role == "assistant":
            latency = self._pair(self._pending_caller, msg) if self._pending_caller else None
            self._pending_caller = None
            turn = self._record(msg, "agent", latency)
            # An interrupted turn holds only what was actually spoken before the caller cut in.
            # If the next "caller" line repeats the agent's own words, the mic is picking up echo.
            if turn.interrupted:
                logger.warning("agent (INTERRUPTED, stopped after): %s", turn.text)
            else:
                logger.info("agent: %s", turn.text)
            if latency is not None:
                # Time from LLM start to the first sentence reaching TTS: how long the voice waited for text.
                ttfs = _ms(msg.metrics.get("llm_node_ttfs"))
                logger.info(
                    _format_turn(turn.index, latency)
                    + ("" if ttfs is None else f" | first text to tts {ttfs}")
                )
            return turn
        return None

    def add_unmeasured(self, msg: ChatMessage) -> Turn:
        """A line that never went through the LLM (a chat's /menu and the menu it sent): in the
        transcript, with no timings."""
        self._pending_caller = None
        return self._record(msg, "agent" if msg.role == "assistant" else "caller", latency=None)

    def _record(self, msg: ChatMessage, speaker: str, latency: TurnLatency | None) -> Turn:
        turn = Turn(
            index=len(self.turns),
            speaker=speaker,
            text=msg.text_content or "",
            at=datetime.fromtimestamp(msg.created_at, tz=UTC),
            interrupted=msg.interrupted,
            latency=latency,
        )
        self.turns.append(turn)
        return turn

    def _pair(self, caller: ChatMessage, agent: ChatMessage) -> TurnLatency:
        c, a = caller.metrics, agent.metrics
        total = None
        if "stopped_speaking_at" in c and "started_speaking_at" in a:
            total = _ms(a["started_speaking_at"] - c["stopped_speaking_at"])
        return TurnLatency(
            eou_ms=_ms(c.get("end_of_turn_delay")),
            stt_ms=_ms(c.get("transcription_delay")),
            llm_ttft_ms=_ms(a.get("llm_node_ttft")),
            tts_ttfb_ms=_ms(a.get("tts_node_ttfb")),
            total_ms=total,
            llm_model=self._answered_by or self.llm_model,
        )

    def summary(self) -> dict[str, int | None]:
        measured = [t.latency for t in self.turns if t.latency is not None]

        def stage(name: str) -> list[int]:
            return [v for lat in measured if (v := getattr(lat, name)) is not None]

        totals = stage("total_ms")
        return {
            "turns": len(measured),
            "total_p50_ms": percentile(totals, 50),
            "total_p95_ms": percentile(totals, 95),
            "eou_median_ms": _median(stage("eou_ms")),
            "stt_median_ms": _median(stage("stt_ms")),
            "llm_ttft_median_ms": _median(stage("llm_ttft_ms")),
            "tts_ttfb_median_ms": _median(stage("tts_ttfb_ms")),
        }

    def log_summary(self) -> None:
        s = self.summary()
        if not s["turns"]:
            logger.info("call latency: no measured turns")
            return
        logger.info(
            "call latency over %d turns | voice-to-voice p50 %s ms, p95 %s ms | "
            "median eou %s, stt %s, llm ttft %s (%s), tts ttfb %s",
            s["turns"],
            s["total_p50_ms"],
            s["total_p95_ms"],
            s["eou_median_ms"],
            s["stt_median_ms"],
            s["llm_ttft_median_ms"],
            self.llm_model,
            s["tts_ttfb_median_ms"],
        )


def _median(values: list[int]) -> int | None:
    return round(statistics.median(values)) if values else None


def _format_turn(index: int, lat: TurnLatency) -> str:
    def show(v: int | None) -> str:
        return "-" if v is None else str(v)

    return (
        f"turn {index} latency | total {show(lat.total_ms)} ms | eou {show(lat.eou_ms)} | "
        f"stt {show(lat.stt_ms)} | llm ttft {show(lat.llm_ttft_ms)} ({lat.llm_model}) | "
        f"tts ttfb {show(lat.tts_ttfb_ms)}"
    )
