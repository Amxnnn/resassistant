"""Answer Telegram calls with the voice agent, for testing.

A Telegram user account (bots can't take calls) logs in here. When someone on
TELEGRAM_ALLOWED_USER_IDS calls it, the call is bridged into a new LiveKit room, LiveKit sends the
voice agent there as for any call, and the agent answers: same pipeline, tools and call log
(channel "telegram"). Calls from anyone else are left alone, to ring on the account's own devices.

Run from agent/ (docs/agent.md has the setup):
    uv run --group telegram-call python -m agent.telegram_call

The first run asks for the account's phone number and the code Telegram sends, then keeps the
login in TELEGRAM_CALL_SESSION.session. That file is the account's login: keep it private. This
drives a user account through Telegram's API, which Telegram may restrict: use a spare account.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import sys
from uuid import uuid4

from dotenv import load_dotenv
from livekit import rtc
from pytgcalls import PyTgCalls
from pytgcalls import filters as call_filters
from pytgcalls.types import (
    CallConfig,
    ChatUpdate,
    Device,
    Direction,
    ExternalMedia,
    MediaStream,
    RecordStream,
    StreamFrames,
)
from pytgcalls.types.raw import AudioParameters
from telethon import TelegramClient

from agent.chat.telegram import allowed_user_ids, restaurant_phone
from agent.speakable import normalize_phone
from agent.telegram_call.bridge import CHANNELS, SAMPLE_RATE, CallBridge, bridge_token

load_dotenv()
logger = logging.getLogger("agent.telegram_call")

AUDIO = AudioParameters(bitrate=SAMPLE_RATE, channels=CHANNELS)
# The caller hears ringing until the agent is in the room. On LiveKit Cloud's free plan an idle
# agent takes 10 to 20 s to wake (docs/agent.md), and Telegram rings for about a minute.
AGENT_JOIN_SECONDS = 45


class Answering:
    """Answers the allowed callers' Telegram calls with the agent, one call at a time."""

    def __init__(
        self,
        telegram: TelegramClient,
        calls: PyTgCalls,
        *,
        allowed: set[int],
        livekit: tuple[str, str, str],  # url, API key, API secret
        restaurant_phone: str,
    ) -> None:
        self._telegram = telegram
        self._calls = calls
        self._allowed = allowed
        self._livekit = livekit
        self._restaurant_phone = restaurant_phone
        self._chat_id: int | None = None  # the caller being answered, by Telegram user ID
        self._bridge: CallBridge | None = None
        # Only a call the bridge picked up is ever hung up here: one it didn't may have been answered
        # on the account's phone instead, and discarding it would cut that call off.
        self._answered = False
        self._tasks: set[asyncio.Task[None]] = set()

    def incoming(self, chat_id: int) -> None:
        """A call is ringing. Handled in its own task: an update handler mustn't block for a whole call."""
        task = asyncio.create_task(self._answer(chat_id))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    def left(self, chat_id: int) -> None:
        """The Telegram call ended (hung up, declined or dropped): end its room too."""
        if self._bridge is not None and chat_id == self._chat_id:
            self._bridge.ended.set()

    def frames(self, update: StreamFrames) -> None:
        if self._bridge is not None and update.chat_id == self._chat_id:
            for frame in update.frames:
                self._bridge.from_caller(frame.frame)

    async def aclose(self) -> None:
        await self._finish()
        for task in self._tasks:
            task.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)

    async def _answer(self, chat_id: int) -> None:
        if chat_id not in self._allowed:
            logger.info("call from Telegram user %s, who isn't on the allowlist: left to ring", chat_id)
            return
        if self._bridge is not None:
            logger.info("already on a call: the call from Telegram user %s is left to ring", chat_id)
            return

        async def send(pcm: bytes) -> None:
            await self._calls.send_frame(chat_id, Device.MICROPHONE, pcm)

        bridge = CallBridge(rtc.Room(), send)
        self._chat_id, self._bridge, self._answered = chat_id, bridge, False
        room = f"telegram-call-{uuid4().hex[:12]}"
        try:
            try:
                caller = await self._telegram.get_entity(chat_id)
            except ValueError:  # not in this login's cache yet: no name or number to pass on
                caller = None
            attributes = {"call_channel": "telegram", "restaurant_phone": self._restaurant_phone}
            # Telegram shows the number only if the caller shares it with this account; it's then
            # the account's verified number, as trusted as caller ID.
            if (number := getattr(caller, "phone", None)) and (phone := normalize_phone(f"+{number}")):
                attributes["caller_phone"] = phone
            url, key, secret = self._livekit
            name = getattr(caller, "first_name", None) or "Telegram caller"
            token = bridge_token(
                key, secret, room=room, identity=f"telegram-{chat_id}", name=name, attributes=attributes
            )
            await bridge.connect(url, token)
            logger.info("call from %s (%s): waiting for the agent in room %s", name, chat_id, room)
            if not await bridge.wait_for_agent(AGENT_JOIN_SECONDS):
                if not bridge.ended.is_set():
                    logger.error(
                        "no agent came to %s within %d s, so the call is left to ring. Is the agent "
                        "running (uv run python -m agent.main dev, or deployed to LiveKit Cloud)?",
                        room,
                        AGENT_JOIN_SECONDS,
                    )
                return
            await self._calls.play(chat_id, MediaStream(ExternalMedia.AUDIO, AUDIO), CallConfig())
            self._answered = True
            await self._calls.record(chat_id, RecordStream(True, AUDIO))
            await bridge.start_audio()
            logger.info("call answered: %s is talking to the agent in %s", name, room)
            await bridge.ended.wait()  # the agent hung up, or the caller did (left())
        except Exception:
            logger.exception("call from %s failed", chat_id)
        finally:
            await self._finish()

    async def _finish(self) -> None:
        """End the current call: its room, and the Telegram call if the bridge picked it up. Safe twice."""
        chat_id, bridge, answered = self._chat_id, self._bridge, self._answered
        self._chat_id, self._bridge, self._answered = None, None, False
        if answered and chat_id is not None:
            with contextlib.suppress(Exception):  # already over on Telegram's side
                await self._calls.leave_call(chat_id)
        if bridge is not None:
            await bridge.aclose()
            logger.info("call with %s ended", chat_id)


def required(name: str, where: str) -> str:
    value = os.getenv(name)
    if not value:
        raise SystemExit(f"Set {name} in agent/.env ({where})")
    return value


async def run() -> None:
    api_id = required("TELEGRAM_API_ID", "from my.telegram.org, API development tools")
    api_hash = required("TELEGRAM_API_HASH", "from my.telegram.org, API development tools")
    livekit = (
        required("LIVEKIT_URL", "your LiveKit Cloud project"),
        required("LIVEKIT_API_KEY", "your LiveKit Cloud project"),
        required("LIVEKIT_API_SECRET", "your LiveKit Cloud project"),
    )
    if not api_id.isdigit():
        raise SystemExit("TELEGRAM_API_ID is a number (my.telegram.org, API development tools)")
    allowed = allowed_user_ids(os.getenv("TELEGRAM_ALLOWED_USER_IDS", ""))
    if not allowed:
        raise SystemExit("Set TELEGRAM_ALLOWED_USER_IDS in agent/.env: only those users' calls are answered")

    telegram = TelegramClient(os.getenv("TELEGRAM_CALL_SESSION", ".telegram_call"), int(api_id), api_hash)
    # First run only: Telegram sends a login code to the account's other devices.
    await telegram.start(phone=lambda: input("Phone number of the Telegram account that answers calls: "))
    me = await telegram.get_me()
    if getattr(me, "bot", False):
        raise SystemExit(
            "That's a bot account, and Telegram bots can't take calls: log in with a user account"
        )

    calls = PyTgCalls(telegram)
    answering = Answering(
        telegram, calls, allowed=allowed, livekit=livekit, restaurant_phone=restaurant_phone()
    )

    @calls.on_update(call_filters.chat_update(ChatUpdate.Status.INCOMING_CALL))
    async def on_incoming(_client, update: ChatUpdate) -> None:
        answering.incoming(update.chat_id)

    @calls.on_update(call_filters.chat_update(ChatUpdate.Status.LEFT_CALL))
    async def on_left(_client, update: ChatUpdate) -> None:
        answering.left(update.chat_id)

    @calls.on_update(call_filters.stream_frame(Direction.INCOMING, Device.MICROPHONE))
    async def on_frames(_client, update: StreamFrames) -> None:
        answering.frames(update)

    await calls.start()
    logger.info(
        "answering Telegram calls to %s from %d allowed user(s) for %s. Ctrl+C to stop.",
        f"@{me.username}" if me.username else me.first_name,
        len(allowed),
        restaurant_phone(),
    )
    try:
        await telegram.run_until_disconnected()
    finally:
        await answering.aclose()
        await telegram.disconnect()


def main() -> None:
    # Callers' names in the logs needn't be ASCII, which Windows' default for piped output can't write.
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    with contextlib.suppress(KeyboardInterrupt):
        asyncio.run(run())


if __name__ == "__main__":
    main()
