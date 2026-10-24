"""Keeps calls from hanging open and burning free-tier quota.

- Silence: when the caller says nothing for a while, check in once ("Are you still there?"). If they
  stay silent for `silence_grace_seconds` after that, say goodbye and hang up.
- Length: a call can't run past MAX_CALL_SECONDS. At the limit the agent wraps up and hangs up.
- Goodbye: when the LLM calls end_call, hang up as soon as its goodbye has played.

The check-in and goodbyes are fixed sentences (session.say), so they cost no LLM requests.
"""

from __future__ import annotations

import asyncio
import logging

from livekit.agents import AgentSession, JobContext, UserStateChangedEvent
from livekit.agents.voice.speech_handle import SpeechHandle

logger = logging.getLogger("agent.call_limits")

CHECK_IN = "Are you still there?"
SILENCE_GOODBYE = "I'll let you go now. Thanks for calling, goodbye!"
TIME_UP_GOODBYE = (
    "I'm sorry, I have to wrap up this call now. Please call again if you need anything else. Goodbye!"
)


class CallLimits:
    def __init__(
        self,
        session: AgentSession,
        ctx: JobContext,
        *,
        max_call_seconds: float,
        silence_grace_seconds: float = 8.0,
    ) -> None:
        self._session = session
        self._ctx = ctx
        self._max_call_seconds = max_call_seconds
        self._silence_grace_seconds = silence_grace_seconds
        self._ending = False
        self._timers: list[asyncio.Task[None]] = []
        self._silence: asyncio.Task[None] | None = None

    def start(self) -> None:
        self._session.on("user_state_changed", self._on_user_state)
        self._timers.append(asyncio.create_task(self._end_at_time_limit(), name="call_time_limit"))
        self._session.on("close", lambda _ev: self._cancel_timers())

    def _on_user_state(self, ev: UserStateChangedEvent) -> None:
        if ev.new_state == "speaking" and self._silence:
            self._silence.cancel()  # they answered
            self._silence = None
        elif ev.new_state == "away" and not self._ending and not self._silence:
            # LiveKit reports "away" once and stays there, so the follow-up needs its own timer.
            self._silence = asyncio.create_task(self._check_in_then_hang_up(), name="silence_check_in")
            self._timers.append(self._silence)

    async def _check_in_then_hang_up(self) -> None:
        await self._session.say(CHECK_IN)
        await asyncio.sleep(self._silence_grace_seconds)
        await self.hang_up(SILENCE_GOODBYE, reason="caller silent")

    async def _end_at_time_limit(self) -> None:
        await asyncio.sleep(self._max_call_seconds)
        await self.hang_up(TIME_UP_GOODBYE, reason="max call length reached")

    async def hang_up(self, goodbye: str, *, reason: str) -> None:
        """Say a fixed goodbye, then end the session and disconnect the caller."""
        if self._ending:
            return
        self._ending = True
        try:
            await self._session.interrupt(force=True)
            await self._session.say(goodbye, allow_interruptions=False)
        finally:
            await self._disconnect(reason)

    def end_after(self, speech: SpeechHandle) -> None:
        """Hang up once `speech` (the agent's goodbye) has finished playing. Used by end_call."""
        if self._ending:
            return
        self._ending = True
        speech.add_done_callback(lambda _: asyncio.create_task(self._disconnect("caller finished")))

    async def _disconnect(self, reason: str) -> None:
        logger.info("hanging up: %s", reason)
        self._cancel_timers()
        self._session.shutdown()
        await self._ctx.delete_room()  # disconnects a phone caller too; a no-op in console mode
        self._ctx.shutdown(reason=reason)

    def _cancel_timers(self) -> None:
        current = asyncio.current_task()
        for task in self._timers:
            if task is not current:
                task.cancel()
