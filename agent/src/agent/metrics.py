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

from livekit.agents import AgentSession, ConversationItemAddedEvent
from livekit.agents.llm import ChatMessage

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
    llm_model: str | None
    turns: list[Turn] = field(default_factory=list)
    _pending_caller: ChatMessage | None = field(default=None, init=False, repr=False)

    def attach(self, session: AgentSession) -> None:
        session.on("conversation_item_added", self._on_item_added)

    def _on_item_added(self, ev: ConversationItemAddedEvent) -> None:
        if isinstance(ev.item, ChatMessage):
            self.add_message(ev.item)

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
                logger.info(_format_turn(turn.index, latency))
            return turn
        return None

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
            llm_model=self.llm_model,
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
