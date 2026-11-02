"""The Telegram bot: polls the Bot API for new messages and passes each one to Chats.

Long polling needs no public URL or tunnel, so the bot runs anywhere, a laptop included. Only one
copy may poll a bot at a time: Telegram answers a second one with HTTP 409.

Who gets in: private chats with the users in TELEGRAM_ALLOWED_USER_IDS. Anyone else gets a polite
refusal that includes their user ID, so a tester can be added.

A guest's number counts as theirs (CallState.caller_phone, so it's never read back) only when it
comes from Telegram's share-my-number button and the contact shared is their own. A number they
type is treated like a number said on a call: read back before anything is booked with it.
"""

from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import Awaitable, Callable
from typing import Any

import httpx

from agent.api_client import SAMPLE_RESTAURANT_PHONE
from agent.chat.chats import ChatLimits, Chats, OpenConversation
from agent.speakable import normalize_phone

logger = logging.getLogger("agent.chat.telegram")

API_URL = "https://api.telegram.org"
POLL_SECONDS = 50  # how long one getUpdates call waits for a message before returning empty
MAX_MESSAGE = 4096  # characters in one Telegram message

SHARE_PHONE = "Share my phone number"
SHARE_KEYBOARD = {
    "keyboard": [[{"text": SHARE_PHONE, "request_contact": True}]],
    "resize_keyboard": True,
    "input_field_placeholder": "Ask about the menu, or book a table",
}
NO_KEYBOARD = {"remove_keyboard": True}

NOT_INVITED = (
    "Sorry, this is a private demo for invited testers. "
    "(Your Telegram user ID is {user_id}, in case the owner wants to add you.)"
)
TEXT_ONLY = "Sorry, I can only read text messages and voice notes."
VOICE_NOTE_MAX_SECONDS = 30  # about 75 words: inside a chat message's length limit
NOTE_TOO_LONG = "That voice note is a bit long for me. Could you keep it under 30 seconds, or type it?"
NOTE_UNCLEAR = "Sorry, I couldn't make out that voice note. Could you send it again, or type it?"
NOTE_FAILED = "Sorry, I couldn't listen to that voice note just now. Could you type it instead?"
HEARD = 'I heard: "{text}"'  # so a misheard word is easy to spot and correct
NOT_YOUR_CONTACT = (
    f'That looks like someone else\'s contact. To use your own number, tap "{SHARE_PHONE}" below, '
    "or type the number."
)
BAD_CONTACT = "Sorry, I couldn't read that number. Could you type it instead?"
SHARED = "I've shared my phone number."  # what the agent hears when a guest taps the button

Transcribe = Callable[[bytes, str], Awaitable[str]]  # audio and its MIME type -> the words


class TelegramError(Exception):
    def __init__(self, code: int, description: str, retry_after: float | None = None) -> None:
        super().__init__(f"{code}: {description}")
        self.code = code  # Telegram's error_code (an HTTP status); 0 when Telegram wasn't reached
        self.retry_after = retry_after


class TelegramBot:
    def __init__(
        self,
        token: str,
        *,
        allowed_user_ids: set[int],
        open_conversation: OpenConversation,
        limits: ChatLimits | None = None,
        transcribe: Transcribe | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._token = token
        self._http = httpx.AsyncClient(
            base_url=f"{API_URL}/bot{token}/", timeout=POLL_SECONDS + 10, transport=transport
        )
        self._allowed = allowed_user_ids
        self._transcribe = transcribe  # voice notes; None turns them away like any other non-text
        self.chats = Chats(open_conversation, self.send, typing=self.typing, limits=limits)
        self._phones: dict[str, str] = {}  # chat id -> the number its guest shared
        self._keyboard_up: set[str] = set()  # chats showing the share-my-number button

    async def run(self) -> None:
        """Poll for messages until cancelled. Raises TelegramError if Telegram rejects the token."""
        me = await self._call("getMe")
        logger.info(
            "Telegram bot @%s is up (long polling), %d allowed user(s)",
            me.get("username"),
            len(self._allowed),
        )
        if not self._allowed:
            logger.warning("TELEGRAM_ALLOWED_USER_IDS is empty: everyone gets the private-demo reply")
        offset: int | None = None
        failures = 0
        while True:
            try:
                offset = await self.poll(offset)
                failures = 0
            except TelegramError as e:
                if e.code == 401:
                    raise
                failures += 1
                delay = e.retry_after or min(30.0, 2.0**failures)
                if e.code == 409:
                    logger.error(
                        "another copy of this bot is polling, or a webhook is set (only one may): %s", e
                    )
                else:
                    logger.warning("Telegram poll failed (%s); trying again in %.0f s", e, delay)
                await asyncio.sleep(delay)

    async def poll(self, offset: int | None) -> int | None:
        """One long poll: handle each new message, and return the offset for the next poll."""
        updates = await self._call(
            "getUpdates", offset=offset, timeout=POLL_SECONDS, allowed_updates=["message"]
        )
        for update in updates:
            offset = update["update_id"] + 1
            try:
                await self.handle(update)
            except Exception:
                logger.exception("couldn't handle Telegram update %s", update.get("update_id"))
        return offset

    async def handle(self, update: dict[str, Any]) -> None:
        message = update.get("message")
        if not message or message.get("chat", {}).get("type") != "private":
            return  # one-to-one chats only: the bot isn't meant for groups
        chat_id = str(message["chat"]["id"])
        user = message.get("from") or {}
        if user.get("id") not in self._allowed:
            logger.info(
                "Telegram user %s (%s) isn't on the allowlist",
                user.get("id"),
                user.get("username") or user.get("first_name"),
            )
            await self._send_one(chat_id, NOT_INVITED.format(user_id=user.get("id")))
            return
        if contact := message.get("contact"):
            await self._contact(chat_id, user, contact)
        elif text := message.get("text"):
            await self.chats.receive(chat_id, command(text))
        elif (note := message.get("voice")) and self._transcribe is not None:
            await self._voice_note(chat_id, note)
        else:  # photos, stickers, files
            await self.send(chat_id, [TEXT_ONLY])

    async def _voice_note(self, chat_id: str, note: dict[str, Any]) -> None:
        """Hear a voice note, show the guest what was heard, and carry on as if they'd typed it."""
        assert self._transcribe is not None
        if (note.get("duration") or 0) > VOICE_NOTE_MAX_SECONDS:
            await self.send(chat_id, [NOTE_TOO_LONG])
            return
        try:
            file = await self._call("getFile", file_id=note["file_id"])
            audio = await self._download(file["file_path"])
            text = await self._transcribe(audio, note.get("mime_type") or "audio/ogg")
        except Exception as e:
            logger.warning("chat %s: voice note not transcribed: %s", chat_id, self._redact(e))
            await self.send(chat_id, [NOTE_FAILED])
            return
        if not text:
            await self.send(chat_id, [NOTE_UNCLEAR])
            return
        await self.send(chat_id, [HEARD.format(text=text)])
        await self.chats.receive(chat_id, text)

    async def _download(self, file_path: str) -> bytes:
        try:
            resp = await self._http.get(f"{API_URL}/file/bot{self._token}/{file_path}")
            resp.raise_for_status()
        except httpx.HTTPError as e:
            raise TelegramError(0, self._redact(e)) from None
        return resp.content

    def _redact(self, error: Exception) -> str:
        return f"{type(error).__name__}: {error}".replace(self._token, "<token>")

    async def _contact(self, chat_id: str, user: dict[str, Any], contact: dict[str, Any]) -> None:
        if contact.get("user_id") != user.get("id"):
            await self.send(chat_id, [NOT_YOUR_CONTACT])
            return
        # Telegram sends the number with its country code, with or without the "+".
        phone = normalize_phone(contact.get("phone_number", ""))
        if phone is None:
            await self.send(chat_id, [BAD_CONTACT])
            return
        self._phones[chat_id] = phone
        self.chats.set_phone(chat_id, phone)
        await self.chats.receive(chat_id, SHARED)

    async def send(self, chat_id: str, lines: list[str]) -> None:
        """Each line as a message. The last one carries the share-my-number button until the guest
        has shared their number, and then removes it."""
        parts = [part for line in lines for part in split_message(line)]
        for i, part in enumerate(parts):
            await self._send_one(chat_id, part, self._keyboard(chat_id) if i == len(parts) - 1 else None)

    async def typing(self, chat_id: str) -> None:
        await self._call("sendChatAction", chat_id=chat_id, action="typing")

    async def aclose(self) -> None:
        """Close every open chat (saving their logs), then the connection."""
        await self.chats.aclose()
        await self._http.aclose()

    def _keyboard(self, chat_id: str) -> dict[str, Any] | None:
        if chat_id not in self._phones:
            self._keyboard_up.add(chat_id)
            return SHARE_KEYBOARD
        if chat_id in self._keyboard_up:
            self._keyboard_up.discard(chat_id)
            return NO_KEYBOARD
        return None

    async def _send_one(self, chat_id: str, text: str, keyboard: dict[str, Any] | None = None) -> None:
        await self._call("sendMessage", chat_id=chat_id, text=text, reply_markup=keyboard)

    async def _call(self, method: str, **params: Any) -> Any:
        """One Bot API call. Errors never carry the URL, which contains the bot token."""
        payload = {k: v for k, v in params.items() if v is not None}
        try:
            resp = await self._http.post(method, json=payload)
        except httpx.HTTPError as e:
            raise TelegramError(0, self._redact(e)) from None
        try:
            body = resp.json()
        except ValueError:
            raise TelegramError(resp.status_code, "the reply wasn't JSON") from None
        if not body.get("ok"):
            retry_after = (body.get("parameters") or {}).get("retry_after")
            raise TelegramError(
                body.get("error_code", resp.status_code), body.get("description", ""), retry_after
            )
        return body["result"]


def command(text: str) -> str:
    """'/menu@ResassistantBot' or '/start abc' -> '/menu' or '/start'. Any other text as it came."""
    if not text.startswith("/"):
        return text
    return text.split(maxsplit=1)[0].split("@", 1)[0].lower()


def split_message(text: str, limit: int = MAX_MESSAGE) -> list[str]:
    """Text in parts Telegram accepts, split at line breaks where possible."""
    parts: list[str] = []
    while len(text) > limit:
        cut = text.rfind("\n", 0, limit)
        if cut <= 0:
            cut = limit
        parts.append(text[:cut].rstrip())
        text = text[cut:].lstrip("\n")
    return [*parts, text] if text else parts


def restaurant_phone() -> str:
    """The restaurant Telegram guests reach (chats and calls), by its number in the API."""
    return os.getenv("TELEGRAM_RESTAURANT_PHONE") or os.getenv(
        "DEFAULT_RESTAURANT_PHONE", SAMPLE_RESTAURANT_PHONE
    )


def allowed_user_ids(raw: str) -> set[int]:
    """TELEGRAM_ALLOWED_USER_IDS, "123, 456", as a set of user IDs."""
    ids = set()
    for part in raw.replace(" ", "").split(","):
        if part and not part.isdigit():
            raise SystemExit(
                f"TELEGRAM_ALLOWED_USER_IDS: {part!r} isn't a user ID (@userinfobot shows yours)"
            )
        if part:
            ids.add(int(part))
    return ids
