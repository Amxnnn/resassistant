"""Entrypoint: builds the voice pipeline and runs one AgentSession per call.

Run from agent/:
    uv run python -m agent.main download-files   # once: turn detector and VAD weights
    uv run python -m agent.main console          # talk to it in the terminal
    lk agent dev src/agent/main.py               # join LiveKit Cloud with hot reload
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, Literal

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
from agent.prompts import build_greeting
from agent.speakable import speak_numbers_digit_by_digit, speak_plain_punctuation
from agent.tools import CallState, Receptionist, new_call_id
from agent.turn_taking import QUICK, TurnTaking

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

# A model that failed (usually on a rate limit) sits out this long, then the next real request tries
# it again. Groq's per-minute windows reopen within seconds; a model out of its daily tokens just
# fails again, which costs that request about 0.2 s before the next model answers.
RETRY_FAILED_LLM_AFTER = 20.0

NOT_SET_UP = "Sorry, this number isn't set up yet. Please try again later. Goodbye!"
API_DOWN = "Sorry, I can't reach our booking system right now. Please call back in a few minutes. Goodbye!"


def groq_models() -> list[str]:
    return [m.strip() for m in os.getenv("GROQ_MODELS", DEFAULT_GROQ_MODELS).split(",") if m.strip()]


def groq_llm(model: str | None = None) -> llm.LLM:
    # The plugin sets reasoning_effort="low" for gpt-oss models. One tool call per reply: a tool that
    # speaks for itself ends the turn, and a second call alongside it would get a reply on top.
    return groq.LLM(
        model=model or groq_models()[0], max_completion_tokens=MAX_REPLY_TOKENS, parallel_tool_calls=False
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


class NoProbeFallbackAdapter(llm.FallbackAdapter):
    """LiveKit's FallbackAdapter without its recovery probes.

    To learn whether a failed model works again, the adapter re-sends the whole failed request in the
    background and throws the answer away. On the free tiers that spends a request's worth of tokens
    (~2,500) from the per-minute budget that just ran out. Here a failed model rejoins the chain after
    RETRY_FAILED_LLM_AFTER seconds, and the next real request finds out.
    """

    def chat(self, **kwargs: Any) -> llm.LLMStream:
        stream = super().chat(**kwargs)
        # Private hook, replaced before the stream's task first runs; tests/test_llm_setup.py pins it.
        stream._try_recovery = self._rejoin_later  # type: ignore[attr-defined]
        return stream

    def _rejoin_later(self, failed: llm.LLM) -> None:
        status = self._status[self._llm_instances.index(failed)]
        if status.recovering_task is None or status.recovering_task.done():
            status.recovering_task = asyncio.create_task(self._rejoin(status))

    @staticmethod
    async def _rejoin(status: Any) -> None:
        await asyncio.sleep(RETRY_FAILED_LLM_AFTER)
        status.available = True


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
    return NoProbeFallbackAdapter(chain, attempt_timeout=10.0), label


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
    identity: str | None = None  # the caller's participant in the room; None in console mode


async def identify_call(ctx: JobContext) -> CallInfo:
    default = os.getenv("DEFAULT_RESTAURANT_PHONE", SAMPLE_RESTAURANT_PHONE)
    if ctx.is_fake_job():  # console mode: no room, no caller ID
        return CallInfo("browser", None, default)
    participant = await ctx.wait_for_participant()
    attrs = participant.attributes
    if participant.kind == rtc.ParticipantKind.PARTICIPANT_KIND_SIP:
        dialed = attrs.get("sip.trunkPhoneNumber") or default
        return CallInfo("phone", attrs.get("sip.phoneNumber"), dialed, participant.identity)
    # Browser test calls: the web token route sets restaurant_phone (see contracts/openapi.yaml).
    return CallInfo("browser", None, attrs.get("restaurant_phone") or default, participant.identity)


async def release_console_audio() -> None:
    """Console mode: close the terminal's microphone and speaker before the job's event loop closes.

    LiveKit's built-in console (livekit-agents 1.8) leaves both running when a call ends, by hang-up
    or Ctrl+C. Every audio callback then fails with "Event loop is closed", which Windows shows as
    one error dialog after another.
    """
    console = cli.AgentsConsole.get_instance()
    for name in ("set_microphone_enabled", "set_speaker_enabled"):
        if set_enabled := getattr(console, name, None):  # only the built-in console has its own audio
            set_enabled(False)


def prewarm(proc: JobProcess) -> None:
    # Load once per worker process, not once per call. End-of-turn detection only starts after
    # this much silence, so it sets a floor on every reply: Silero's 0.55 s default added ~0.25 s
    # to each turn. The turn detector decides whether the caller has actually finished.
    proc.userdata["vad"] = silero.VAD.load(
        min_silence_duration=float(os.getenv("VAD_MIN_SILENCE_SECONDS", "0.3"))
    )
    # Ready before the call rings: building the HTTPS client blocks the event loop for ~0.15 s.
    proc.userdata["api"] = make_restaurant_api()


server = AgentServer(setup_fnc=prewarm)


@server.rtc_session()
async def entrypoint(ctx: JobContext) -> None:
    # One id per conversation, on every log line and on everything the call creates. Room names
    # aren't enough: console mode reuses one, and a test page can reuse a name it's given.
    call_id = new_call_id()
    started_at = datetime.now(UTC)
    ctx.log_context_fields = {"room": ctx.room.name, "call_id": call_id}

    # Taken, not shared: the call closes its client when it ends.
    api = ctx.proc.userdata.pop("api", None) or make_restaurant_api()
    call = await identify_call(ctx)
    # Fetched while the session sets up the call's audio (about a second, mostly loading noise
    # cancellation), instead of one after the other.
    settings = asyncio.create_task(api.get_restaurant_by_number(call.dialed))

    session_llm, llm_label = build_llm()
    stt = deepgram.STT(model="nova-3", language="en-US")
    # Seconds of silence before "Are you still there?", and again before hanging up.
    silence_seconds = float(os.getenv("SILENCE_CHECK_IN_SECONDS", "10"))
    # Its userdata (the CallState) is set once the restaurant's settings are in.
    session = AgentSession[CallState](
        vad=ctx.proc.userdata["vad"],
        stt=stt,
        llm=session_llm,
        tts=deepgram.TTS(model="aura-2-andromeda-en"),
        turn_handling=TurnHandlingOptions(
            # LiveKit's turn model: hosted in dev and on LiveKit Cloud, local "mini" model as fallback.
            turn_detection=inference.TurnDetector(),
            # Quick by default; longer only while the caller reads out a phone number (turn_taking.py).
            endpointing=QUICK,
            # Start the LLM, and the voice for its reply, before the turn is confirmed: when the guess
            # holds, the reply is ready the moment the caller stops. At most one guess per turn, as
            # each is another request against the free tier's tokens-per-minute limit.
            preemptive_generation={"max_retries": 1, "preemptive_tts": True},
            # Only real words stop the agent mid-sentence: "no, wait" (2 words) does, while
            # "mm-hmm", a cough, background noise or speaker echo don't. A false stop resumes.
            interruption={"min_words": 2, "resume_false_interruption": True},
        ),
        # Plain punctuation for the voice, and phone numbers read digit by digit even when the LLM
        # writes "9876543210".
        tts_text_transforms=[
            "filter_markdown",
            "filter_emoji",
            speak_plain_punctuation,
            speak_numbers_digit_by_digit,
        ],
        user_away_timeout=silence_seconds,
        max_tool_steps=3,
    )

    limits = CallLimits(
        session,
        ctx,
        max_call_seconds=float(os.getenv("MAX_CALL_SECONDS", "300")),
        silence_grace_seconds=silence_seconds,
    )
    receptionist = Receptionist()  # silent until it has the restaurant's settings
    latency = LatencyTracker(llm_model=llm_label)
    latency.attach(session)
    TurnTaking(session).attach()
    state: CallState | None = None
    closed = False

    async def close_call() -> None:
        """Once per call: whichever comes first, the caller leaving or the job shutting down."""
        nonlocal closed
        if closed:
            return
        closed = True
        limits.stop()
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
        if state is not None:
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

    ctx.add_shutdown_callback(close_call)
    if ctx.is_fake_job():
        ctx.add_shutdown_callback(release_console_audio)
    session_closed = asyncio.Event()
    session.on("close", lambda _ev: session_closed.set())

    async def after_caller_left() -> None:
        # LiveKit closes the session when the caller hangs up, which once took a full minute; the
        # call log (and the dashboard) shouldn't wait that long. A normal close takes well under this,
        # and lets the session record the line the caller hung up on.
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(session_closed.wait(), timeout=3.0)
        await close_call()

    def on_participant_left(participant: rtc.RemoteParticipant) -> None:
        if call.identity and participant.identity == call.identity:
            task = asyncio.create_task(after_caller_left())
            _background_tasks.add(task)
            task.add_done_callback(_background_tasks.discard)

    ctx.room.on("participant_disconnected", on_participant_left)

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

    try:
        restaurant = await settings
    except ApiError as e:
        if e.code == "not_found":
            logger.error("no restaurant for dialed number %s: %s", call.dialed, e)
            await limits.hang_up(NOT_SET_UP, reason="no restaurant for this number")
        else:  # the API is down or refused the request (a wrong AGENT_API_KEY): not the number's fault
            logger.error(
                "couldn't load the restaurant for %s from the tool API at %s (is the web app running?): %s",
                call.dialed,
                os.getenv("API_BASE_URL"),
                e,
            )
            await limits.hang_up(API_DOWN, reason="tool API unavailable")
        return
    state = CallState(api=api, restaurant=restaurant, call_id=call_id, caller_phone=call.caller_phone)
    state.end_call = limits.end_after
    session.userdata = state
    logger.info("call started | %s | %s | %s", call_id, call.channel, restaurant.name)

    await receptionist.begin(state)
    session.say(build_greeting(restaurant))
    limits.start()

    # A quiet front-of-house hum, and keyboard sounds while a tool is working. Started after the
    # greeting so it doesn't delay it. Room calls only: console mode logs a warning and skips it.
    background = BackgroundAudioPlayer(
        ambient_sound=AudioConfig(BuiltinAudioClip.CROWDED_ROOM, volume=0.08),
        thinking_sound=[
            AudioConfig(BuiltinAudioClip.KEYBOARD_TYPING, volume=0.5, probability=0.6),
            AudioConfig(BuiltinAudioClip.KEYBOARD_TYPING2, volume=0.4, probability=0.4),
        ],
    )
    await background.start(room=ctx.room, agent_session=session)

    async def load_restaurant_facts(state: CallState) -> None:
        # Fetched while the greeting plays, so menu and info questions skip the API afterwards,
        # and the STT learns the dish and street names it would otherwise mishear.
        facts = await load_facts(api, state.restaurant)
        if facts:
            await receptionist.use_facts(state, facts)
            stt.update_options(keyterm=facts.keyterms)
            logger.info(
                "restaurant facts in the prompt (%d characters), %d STT keyterms, tools: %s",
                len(facts.text),
                len(facts.keyterms),
                ", ".join(t.id for t in receptionist.tools),
            )

    task = asyncio.create_task(load_restaurant_facts(state))
    _background_tasks.add(task)  # the entrypoint returns before it finishes
    task.add_done_callback(_background_tasks.discard)


if __name__ == "__main__":
    cli.run_app(server)
