"""Text chats with the receptionist: the Telegram bot, or a chat in this terminal.

Run from agent/:
    uv run python -m agent.chat telegram   # the Telegram bot (TELEGRAM_BOT_TOKEN in .env; docs/agent.md)
    uv run python -m agent.chat terminal   # type to the receptionist here: no Telegram needed

Both read DATA_SOURCE like a call does: the sample restaurant, or the web API at API_BASE_URL.
Terminal chats save no call log.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import logging
import os
import sys

from dotenv import load_dotenv

from agent.api_client import ApiError, RestaurantAPI, make_restaurant_api
from agent.api_client.models import RestaurantSettings
from agent.chat.chats import ChatLimits
from agent.chat.conversation import Conversation
from agent.chat.telegram import TelegramBot, TelegramError, allowed_user_ids, restaurant_phone
from agent.chat.voice_notes import VoiceNotes
from agent.facts import load_facts

load_dotenv()
logger = logging.getLogger("agent.chat")


async def check_restaurant(api: RestaurantAPI, phone: str) -> RestaurantSettings | None:
    """Say at startup, not on a guest's first message, when the restaurant can't be loaded.

    The bot keeps running either way: the web app may simply not be up yet.
    """
    try:
        restaurant = await api.get_restaurant_by_number(phone)
    except ApiError as e:
        if os.getenv("DATA_SOURCE", "sample").lower() == "api":
            source = f"the web API at {os.getenv('API_BASE_URL')}"
        else:
            source = "the sample data"
        if e.code == "not_found":
            fix = f"no restaurant has the number {phone}: set TELEGRAM_RESTAURANT_PHONE in agent/.env"
        else:
            fix = "is the web app running (cd web && pnpm dev)? Or set DATA_SOURCE=sample in agent/.env"
        logger.error(
            "can't load the restaurant from %s (%s): %s. Until it loads, guests are told to try later.",
            source,
            e.code,
            fix,
        )
        return None
    logger.info("answering for %s (%s)", restaurant.name, phone)
    return restaurant


async def voice_notes(api: RestaurantAPI, restaurant: RestaurantSettings | None) -> VoiceNotes | None:
    """Voice notes heard like a call: same language, and the restaurant's dish and street names."""
    key = os.getenv("DEEPGRAM_API_KEY")
    if not key:
        logger.warning("DEEPGRAM_API_KEY isn't set: voice notes get a text-only reply")
        return None
    facts = await load_facts(api, restaurant) if restaurant else None
    return VoiceNotes(
        key, language=os.getenv("STT_LANGUAGE", "en-US"), keyterms=facts.keyterms if facts else []
    )


def chat_limits() -> ChatLimits:
    return ChatLimits(
        quiet_seconds=float(os.getenv("CHAT_QUIET_SECONDS", "1.5")),
        idle_seconds=60 * float(os.getenv("CHAT_IDLE_MINUTES", "30")),
    )


async def run_telegram() -> None:
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    if not token:
        raise SystemExit("Set TELEGRAM_BOT_TOKEN in agent/.env (from @BotFather)")
    allowed = allowed_user_ids(os.getenv("TELEGRAM_ALLOWED_USER_IDS", ""))
    api = make_restaurant_api()  # one client for every chat: the process is long-lived
    phone = restaurant_phone()

    async def open_conversation(guest_phone: str | None) -> Conversation:
        return await Conversation.open(api, phone, channel="telegram", phone=guest_phone)

    notes = await voice_notes(api, await check_restaurant(api, phone))
    bot = TelegramBot(
        token,
        allowed_user_ids=allowed,
        open_conversation=open_conversation,
        limits=chat_limits(),
        transcribe=notes.transcribe if notes else None,
    )
    try:
        await bot.run()  # handles Telegram's errors itself once it's up; these come from starting it
    except TelegramError as e:
        if e.code == 401:
            raise SystemExit(
                "Telegram rejected TELEGRAM_BOT_TOKEN: check it, or get a new one from @BotFather"
            ) from None
        raise SystemExit(f"Couldn't start the Telegram bot: {e}") from None
    finally:
        await bot.aclose()  # saves the logs of chats still open
        if notes:
            await notes.aclose()
        await api.aclose()


async def run_terminal() -> None:
    api = make_restaurant_api()
    conversation = await Conversation.open(api, restaurant_phone(), channel=None)
    try:
        for line in (await conversation.reply("/start")).lines:
            print(f"agent> {line}")
        while True:
            # Blocking on purpose: nothing else needs to run between turns, and input() in a worker
            # thread would keep the process alive after Ctrl+C until Enter is pressed.
            try:
                text = input("you> ")
            except EOFError:
                break
            if text.strip().lower() in ("quit", "exit"):
                break
            reply = await conversation.reply(text)
            for line in reply.lines:
                print(f"agent> {line}")
            if reply.ended:
                break
    finally:
        await conversation.close()
        await api.aclose()


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m agent.chat", description=__doc__.splitlines()[0])
    parser.add_argument("mode", choices=["telegram", "terminal"])
    parser.add_argument("-v", "--verbose", action="store_true", help="in the terminal, log each turn too")
    args = parser.parse_args()
    # Replies and logs carry ₹ prices, which Windows' default for piped output (cp1252) can't write.
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    quiet = args.mode == "terminal" and not args.verbose
    logging.basicConfig(
        level=logging.WARNING if quiet else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    # httpx logs every request's URL at INFO, and Bot API URLs contain the bot token.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    with contextlib.suppress(KeyboardInterrupt):
        asyncio.run(run_telegram() if args.mode == "telegram" else run_terminal())


if __name__ == "__main__":
    main()
