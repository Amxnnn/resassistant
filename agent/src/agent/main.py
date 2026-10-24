"""Entrypoint: builds the voice pipeline and runs one AgentSession per call.

Run from agent/:
    uv run python -m agent.main download-files   # once: turn detector and VAD weights
    uv run python -m agent.main console          # talk to it in the terminal
    lk agent dev src/agent/main.py               # join LiveKit Cloud with hot reload
"""

from __future__ import annotations

import logging
import os
from datetime import datetime
from typing import TYPE_CHECKING
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
from livekit import rtc
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    JobContext,
    JobProcess,
    TurnHandlingOptions,
    cli,
    inference,
    llm,
    room_io,
)
from livekit.plugins import deepgram, google, groq, noise_cancellation, silero

from agent.metrics import LatencyTracker
from agent.prompts import build_greeting, build_instructions

if TYPE_CHECKING:
    from livekit.agents.voice.room_io.types import NoiseCancellationParams

load_dotenv()
logger = logging.getLogger("agent")

# Stand-in for GET /api/agent/restaurants/by-number/{phone} until the API client lands in
# week 2. Mirrors the example response in contracts/openapi.yaml. Fictional data only.
DEV_RESTAURANT = {
    "name": "The Saffron Table",
    "timezone": "Asia/Kolkata",
    "greeting": "Thanks for calling The Saffron Table.",
    "recording_enabled": True,
    "address": "12 Residency Road, near the Brigade Road junction.",
    "hours_summary": "Open Tuesday to Sunday, 12 to 3 PM and 6 to 11 PM. Closed on Mondays.",
    "policies": [
        "We hold tables for 15 minutes past the booking time.",
        "Parties of more than 8 are booked by the manager.",
    ],
}


def build_llm() -> llm.LLM:
    """Gemini by default; LLM_PROVIDER=groq switches, so the two can be timed side by side."""
    provider = os.getenv("LLM_PROVIDER", "gemini").lower()
    if provider == "groq":
        return groq.LLM(model=os.getenv("GROQ_MODEL", "llama-3.1-8b-instant"))
    if provider != "gemini":
        raise ValueError(f"LLM_PROVIDER must be 'gemini' or 'groq', got {provider!r}")

    model = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
    # Thinking adds hundreds of ms before the first token: turn it off (2.5) or to minimal (3+).
    thinking = {"thinking_budget": 0} if model.startswith("gemini-2.") else {"thinking_level": "minimal"}
    return google.LLM(model=model, thinking_config=thinking)


def select_noise_cancellation(params: NoiseCancellationParams):
    """Phone audio gets the telephony-tuned model; browser and app audio get the general one."""
    if params.participant.kind == rtc.ParticipantKind.PARTICIPANT_KIND_SIP:
        return noise_cancellation.BVCTelephony()
    return noise_cancellation.BVC()


class Receptionist(Agent):
    """The restaurant's phone receptionist. Function tools are added here in week 2."""

    def __init__(self, restaurant: dict, now: datetime) -> None:
        super().__init__(instructions=build_instructions(restaurant, now))


def prewarm(proc: JobProcess) -> None:
    # Load once per worker process, not once per call.
    proc.userdata["vad"] = silero.VAD.load()


server = AgentServer(setup_fnc=prewarm)


@server.rtc_session()
async def entrypoint(ctx: JobContext) -> None:
    ctx.log_context_fields = {"room": ctx.room.name}

    restaurant = DEV_RESTAURANT
    now = datetime.now(ZoneInfo(restaurant["timezone"]))
    session_llm = build_llm()

    session = AgentSession(
        vad=ctx.proc.userdata["vad"],
        stt=deepgram.STT(model="nova-3", language="en-US"),
        llm=session_llm,
        tts=deepgram.TTS(model="aura-2-andromeda-en"),
        # LiveKit's turn model: hosted in dev and on LiveKit Cloud, local "mini" model as fallback.
        turn_handling=TurnHandlingOptions(turn_detection=inference.TurnDetector()),
    )

    latency = LatencyTracker(llm_model=session_llm.model)
    latency.attach(session)

    async def log_latency_summary() -> None:
        latency.log_summary()

    ctx.add_shutdown_callback(log_latency_summary)

    await session.start(
        agent=Receptionist(restaurant, now),
        room=ctx.room,
        room_options=room_io.RoomOptions(
            audio_input=room_io.AudioInputOptions(noise_cancellation=select_noise_cancellation),
        ),
    )
    session.say(build_greeting(restaurant))


if __name__ == "__main__":
    cli.run_app(server)
