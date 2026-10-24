"""Entrypoint: builds the voice pipeline and runs one AgentSession per call.

Run from agent/:
    uv run python -m agent.main download-files   # once: turn detector and VAD weights
    uv run python -m agent.main console          # talk to it in the terminal
    lk agent dev src/agent/main.py               # join LiveKit Cloud with hot reload
"""

from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Literal

from dotenv import load_dotenv
from livekit import rtc
from livekit.agents import (
    AgentServer,
    AgentSession,
    AudioConfig,
    BackgroundAudioPlayer,
    BuiltinAudioClip,
    JobContext,
    JobProcess,
    TurnHandlingOptions,
    cli,
    inference,
    llm,
    room_io,
)
from livekit.plugins import deepgram, google, groq, noise_cancellation, silero

from agent.api_client import SAMPLE_RESTAURANT_PHONE, ApiError, make_restaurant_api
from agent.call_limits import CallLimits
from agent.call_log import build_call_log, save_call_log
from agent.facts import load_facts
from agent.metrics import LatencyTracker
from agent.prompts import build_greeting, build_instructions
from agent.speakable import speak_numbers_digit_by_digit
from agent.tools import CallState, Receptionist, new_call_id

if TYPE_CHECKING:
    from livekit.agents.voice.room_io.types import NoiseCancellationParams

load_dotenv()
logger = logging.getLogger("agent")
_background_tasks: set[asyncio.Task[None]] = set()

# A runaway guard, not a length limit: the prompt keeps replies short. gpt-oss and Gemini count
# their hidden reasoning against this cap, so a tight cap cuts the spoken answer off mid-sentence.
MAX_REPLY_TOKENS = 600


# Groq's free tier counts its per-minute and per-day token limits per model, so each model in this
# list is a separate budget. gpt-oss-120b first: as fast as 20b here (~0.4-0.6 s to first token)
# and better at following the prompt and tools.
DEFAULT_GROQ_MODELS = "openai/gpt-oss-120b,openai/gpt-oss-20b"


def groq_models() -> list[str]:
    return [m.strip() for m in os.getenv("GROQ_MODELS", DEFAULT_GROQ_MODELS).split(",") if m.strip()]


def groq_llm(model: str | None = None) -> llm.LLM:
    # The plugin sets reasoning_effort="low" for gpt-oss models.
    return groq.LLM(model=model or groq_models()[0], max_completion_tokens=MAX_REPLY_TOKENS)


class ForeignCallSignatures(dict[str, bytes]):
    """Thought signatures for Gemini, with a stand-in for tool calls another model made.

    Gemini 3 rejects a request whose current turn has a tool call without a thought signature,
    which is every call Groq made before a mid-turn fallback. Google documents a dummy signature
    that skips the check for calls Gemini didn't make; Gemini's own signatures still pass through.
    """

    SKIP = b"skip_thought_signature_validator"

    def get(self, key: str, default: bytes | None = None) -> bytes:  # type: ignore[override]
        return super().get(key, self.SKIP)

    def __bool__(self) -> bool:  # the plugin skips signatures entirely when the map is falsy
        return True


def gemini_llm() -> llm.LLM:
    # Thinking adds latency before the first token. Gemini 3+ takes a level, and the lowest
    # accepted level varies by model: 3.5 Flash-Lite takes "minimal", 3.8 Flash needs "low".
    gemini = google.LLM(
        model=os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite"),
        thinking_config={"thinking_level": os.getenv("GEMINI_THINKING_LEVEL", "minimal")},
        max_output_tokens=MAX_REPLY_TOKENS,
    )
    # Private plugin attribute; tests/test_llm_setup.py fails if an upgrade changes it.
    gemini._thought_signatures = ForeignCallSignatures()
    return gemini


def build_llm() -> tuple[llm.LLM, str]:
    """Every configured LLM in order, LLM_PROVIDER's first (Groq by default: the fastest).

    A rate limit or outage on one model moves the request to the next instead of dropping the turn.
    Returns the LLM and a label for the latency logs.
    """
    provider = os.getenv("LLM_PROVIDER", "groq").lower()
    if provider not in ("groq", "gemini"):
        raise ValueError(f"LLM_PROVIDER must be 'gemini' or 'groq', got {provider!r}")
    groqs = [groq_llm(m) for m in groq_models()] if os.getenv("GROQ_API_KEY") else []
    geminis = [gemini_llm()] if os.getenv("GOOGLE_API_KEY") else []
    chain = groqs + geminis if provider == "groq" else geminis + groqs
    if not chain:
        raise RuntimeError("Set GROQ_API_KEY and/or GOOGLE_API_KEY in agent/.env")
    label = chain[0].model + (f" (fallback {', '.join(m.model for m in chain[1:])})" if chain[1:] else "")
    if len(chain) == 1:
        return chain[0], label
    # Each attempt's timeout becomes Gemini's request deadline, and Google rejects anything under
    # 10 s ("Minimum allowed deadline is 10s"), which would make every fallback request fail.
    return llm.FallbackAdapter(chain, attempt_timeout=10.0), label


def select_noise_cancellation(params: NoiseCancellationParams):
    """Phone audio gets the telephony-tuned model; browser and app audio get the general one."""
    if params.participant.kind == rtc.ParticipantKind.PARTICIPANT_KIND_SIP:
        return noise_cancellation.BVCTelephony()
    return noise_cancellation.BVC()


@dataclass
class CallInfo:
    channel: Literal["phone", "browser"]
    caller_phone: str | None  # from the phone line; None for browser and console calls
    dialed: str  # the restaurant number the call is for


async def identify_call(ctx: JobContext) -> CallInfo:
    default = os.getenv("DEFAULT_RESTAURANT_PHONE", SAMPLE_RESTAURANT_PHONE)
    if ctx.is_fake_job():  # console mode: no room, no caller ID
        return CallInfo("browser", None, default)
    participant = await ctx.wait_for_participant()
    attrs = participant.attributes
    if participant.kind == rtc.ParticipantKind.PARTICIPANT_KIND_SIP:
        return CallInfo("phone", attrs.get("sip.phoneNumber"), attrs.get("sip.trunkPhoneNumber") or default)
    # Browser test calls: the web token route sets restaurant_phone (see contracts/openapi.yaml).
    return CallInfo("browser", None, attrs.get("restaurant_phone") or default)


def prewarm(proc: JobProcess) -> None:
    # Load once per worker process, not once per call.
    proc.userdata["vad"] = silero.VAD.load()


server = AgentServer(setup_fnc=prewarm)


@server.rtc_session()
async def entrypoint(ctx: JobContext) -> None:
    # One id per conversation, on every log line and on everything the call creates. Room names
    # aren't enough: console mode reuses one, and a test page can reuse a name it's given.
    call_id = new_call_id()
    started_at = datetime.now(UTC)
    ctx.log_context_fields = {"room": ctx.room.name, "call_id": call_id}

    api = make_restaurant_api()
    call = await identify_call(ctx)
    try:
        restaurant = await api.get_restaurant_by_number(call.dialed)
    except ApiError as e:
        logger.error("no restaurant for dialed number %s: %s", call.dialed, e)
        await api.aclose()
        return
    state = CallState(api=api, restaurant=restaurant, call_id=call_id, caller_phone=call.caller_phone)
    logger.info("call started | %s | %s | %s", call_id, call.channel, restaurant.name)

    session_llm, llm_label = build_llm()
    # Seconds of silence before "Are you still there?", and again before hanging up.
    silence_seconds = float(os.getenv("SILENCE_CHECK_IN_SECONDS", "10"))
    session = AgentSession[CallState](
        userdata=state,
        vad=ctx.proc.userdata["vad"],
        stt=deepgram.STT(model="nova-3", language="en-US"),
        llm=session_llm,
        tts=deepgram.TTS(model="aura-2-andromeda-en"),
        turn_handling=TurnHandlingOptions(
            # LiveKit's turn model: hosted in dev and on LiveKit Cloud, local "mini" model as fallback.
            turn_detection=inference.TurnDetector(),
            # Start the LLM, and the voice for its reply, before the turn is confirmed: when the guess
            # holds, the reply is ready the moment the caller stops. At most one guess per turn, as
            # each is another request against the free tier's tokens-per-minute limit.
            preemptive_generation={"max_retries": 1, "preemptive_tts": True},
            # Only real words stop the agent mid-sentence: "no, wait" (2 words) does, while
            # "mm-hmm", a cough, background noise or speaker echo don't. A false stop resumes.
            interruption={"min_words": 2, "resume_false_interruption": True},
        ),
        # Phone numbers are read digit by digit even when the LLM writes "9876543210".
        tts_text_transforms=["filter_markdown", "filter_emoji", speak_numbers_digit_by_digit],
        user_away_timeout=silence_seconds,
        max_tool_steps=3,
    )

    limits = CallLimits(
        session,
        ctx,
        max_call_seconds=float(os.getenv("MAX_CALL_SECONDS", "300")),
        silence_grace_seconds=silence_seconds,
    )
    state.end_call = limits.end_after

    receptionist = Receptionist(state)
    latency = LatencyTracker(llm_model=llm_label)
    latency.attach(session)

    async def on_shutdown() -> None:
        latency.log_summary()
        for usage in session.usage.model_usage:
            if getattr(usage, "type", "") == "llm_usage":
                logger.info(
                    "llm usage | %s %s | input %d tokens, output %d tokens",
                    usage.provider,
                    usage.model,
                    usage.input_tokens,
                    usage.output_tokens,
                )
        log = build_call_log(
            state,
            latency,
            channel=call.channel,
            dialed_number=call.dialed,
            started_at=started_at,
            ended_at=datetime.now(UTC),
        )
        await save_call_log(state, log)
        await api.aclose()

    ctx.add_shutdown_callback(on_shutdown)

    await session.start(
        agent=receptionist,
        room=ctx.room,
        room_options=room_io.RoomOptions(
            audio_input=room_io.AudioInputOptions(
                noise_cancellation=select_noise_cancellation
                if os.getenv("NOISE_CANCELLATION", "on").lower() != "off"
                else None
            ),
        ),
    )

    # A quiet front-of-house hum, and keyboard sounds while a tool is working. Room calls only:
    # console mode logs a warning and skips it.
    background = BackgroundAudioPlayer(
        ambient_sound=AudioConfig(BuiltinAudioClip.CROWDED_ROOM, volume=0.08),
        thinking_sound=[
            AudioConfig(BuiltinAudioClip.KEYBOARD_TYPING, volume=0.5, probability=0.6),
            AudioConfig(BuiltinAudioClip.KEYBOARD_TYPING2, volume=0.4, probability=0.4),
        ],
    )
    await background.start(room=ctx.room, agent_session=session)

    limits.start()
    session.say(build_greeting(restaurant))

    async def load_restaurant_facts() -> None:
        # Fetched while the greeting plays, so menu and info questions skip the API afterwards.
        facts = await load_facts(api, restaurant)
        if facts:
            instructions = build_instructions(
                restaurant, caller_id_known=call.caller_phone is not None, facts=facts
            )
            await receptionist.update_instructions(instructions)
            logger.info("restaurant facts in the prompt (%d characters)", len(facts))

    task = asyncio.create_task(load_restaurant_facts())
    _background_tasks.add(task)  # the entrypoint returns before it finishes
    task.add_done_callback(_background_tasks.discard)


if __name__ == "__main__":
    cli.run_app(server)
