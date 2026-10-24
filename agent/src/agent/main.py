"""Entrypoint: builds the voice pipeline and runs one AgentSession per call.

Run from agent/:
    uv run python -m agent.main download-files   # once: turn detector and VAD weights
    uv run python -m agent.main console          # talk to it in the terminal
    lk agent dev src/agent/main.py               # join LiveKit Cloud with hot reload
"""

from __future__ import annotations

import logging
import os
from typing import TYPE_CHECKING

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
from agent.metrics import LatencyTracker
from agent.prompts import build_greeting
from agent.tools import CallState, Receptionist

if TYPE_CHECKING:
    from livekit.agents.voice.room_io.types import NoiseCancellationParams

load_dotenv()
logger = logging.getLogger("agent")

# A runaway guard, not a length limit: the prompt keeps replies short. gpt-oss and Gemini count
# their hidden reasoning against this cap, so a tight cap cuts the spoken answer off mid-sentence.
MAX_REPLY_TOKENS = 600


def groq_llm() -> llm.LLM:
    # The plugin sets reasoning_effort="low" for gpt-oss models.
    return groq.LLM(
        model=os.getenv("GROQ_MODEL", "openai/gpt-oss-20b"), max_completion_tokens=MAX_REPLY_TOKENS
    )


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
    """The LLM_PROVIDER model first (Groq by default, the fastest in the week-1 measurements).

    When the other provider's key is set too, it becomes an automatic fallback: a rate-limit or
    outage on the first switches the call to the second instead of dropping it.
    Returns the LLM and a label for the latency logs.
    """
    provider = os.getenv("LLM_PROVIDER", "groq").lower()
    if provider not in ("groq", "gemini"):
        raise ValueError(f"LLM_PROVIDER must be 'gemini' or 'groq', got {provider!r}")
    primary, backup, backup_key = (
        (groq_llm(), gemini_llm, "GOOGLE_API_KEY")
        if provider == "groq"
        else (gemini_llm(), groq_llm, "GROQ_API_KEY")
    )
    if not os.getenv(backup_key):
        return primary, primary.model
    fallback = backup()
    # Each attempt's timeout becomes Gemini's request deadline, and Google rejects anything under
    # 10 s ("Minimum allowed deadline is 10s"), which would make every fallback request fail.
    adapter = llm.FallbackAdapter([primary, fallback], attempt_timeout=10.0)
    return adapter, f"{primary.model} (fallback {fallback.model})"


def select_noise_cancellation(params: NoiseCancellationParams):
    """Phone audio gets the telephony-tuned model; browser and app audio get the general one."""
    if params.participant.kind == rtc.ParticipantKind.PARTICIPANT_KIND_SIP:
        return noise_cancellation.BVCTelephony()
    return noise_cancellation.BVC()


async def identify_call(ctx: JobContext) -> tuple[str | None, str]:
    """(caller's number if the phone line gives one, the restaurant number that was dialled)."""
    default = os.getenv("DEFAULT_RESTAURANT_PHONE", SAMPLE_RESTAURANT_PHONE)
    if ctx.is_fake_job():  # console mode: no room, no caller ID
        return None, default
    participant = await ctx.wait_for_participant()
    attrs = participant.attributes
    if participant.kind == rtc.ParticipantKind.PARTICIPANT_KIND_SIP:
        return attrs.get("sip.phoneNumber"), attrs.get("sip.trunkPhoneNumber") or default
    # Browser test calls: the web token route sets restaurant_phone (see contracts/openapi.yaml).
    return None, attrs.get("restaurant_phone") or default


def prewarm(proc: JobProcess) -> None:
    # Load once per worker process, not once per call.
    proc.userdata["vad"] = silero.VAD.load()


server = AgentServer(setup_fnc=prewarm)


@server.rtc_session()
async def entrypoint(ctx: JobContext) -> None:
    ctx.log_context_fields = {"room": ctx.room.name}

    api = make_restaurant_api()
    caller_phone, dialed = await identify_call(ctx)
    try:
        restaurant = await api.get_restaurant_by_number(dialed)
    except ApiError as e:
        logger.error("no restaurant for dialed number %s: %s", dialed, e)
        await api.aclose()
        return
    state = CallState(api=api, restaurant=restaurant, call_id=ctx.room.name, caller_phone=caller_phone)

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
            # Start the LLM before the turn ends to save latency, but at most once per turn: each
            # retry is another request against the free tier's tokens-per-minute limit.
            preemptive_generation={"max_retries": 1},
            # Only real words stop the agent mid-sentence: "no, wait" (2 words) does, while
            # "mm-hmm", a cough, background noise or speaker echo don't. A false stop resumes.
            interruption={"min_words": 2, "resume_false_interruption": True},
        ),
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
        await api.aclose()

    ctx.add_shutdown_callback(on_shutdown)

    await session.start(
        agent=Receptionist(state),
        room=ctx.room,
        room_options=room_io.RoomOptions(
            audio_input=room_io.AudioInputOptions(noise_cancellation=select_noise_cancellation),
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


if __name__ == "__main__":
    cli.run_app(server)
