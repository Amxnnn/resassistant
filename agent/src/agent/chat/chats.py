"""Every guest's chat at once: one worker per chat, so each guest has one conversation, in order.

A worker waits `quiet_seconds` for more messages before answering, so "hi", "table for 4" and
"saturday" sent in a burst get one reply (and one LLM request) instead of three. A message that
arrives while a reply is being written waits for the next turn. After `idle_seconds` of quiet, or
once the guest says goodbye, the conversation closes and is logged; the next message starts a new
one with a fresh greeting, like a new call.

Limits keep one chat from using up the free LLM tiers: a cap on messages per window, and on
message length. Both are checked before anything reaches the LLM.

Nothing here knows about Telegram: a chat is an id, text in, and lines out through `deliver`.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections import deque
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from time import monotonic

from agent.api_client import ApiError
from agent.chat.conversation import SORRY, Conversation, Reply

logger = logging.getLogger("agent.chat")

# Opens a conversation for a guest; the argument is the number they shared, if any.
OpenConversation = Callable[[str | None], Awaitable[Conversation]]
Deliver = Callable[[str, list[str]], Awaitable[None]]
Typing = Callable[[str], Awaitable[None]]

TOO_FAST = "You're sending messages faster than I can keep up. Please wait a few minutes and try again."
TOO_LONG = "That's a long message! Could you send it in shorter parts, under {limit} characters each?"
NOT_SET_UP = "Sorry, this chat isn't set up yet. Please try again later."
API_DOWN = "Sorry, I can't reach our booking system right now. Please try again in a few minutes."
TYPING_EVERY = 4.0  # Telegram's "typing…" fades after 5 seconds


@dataclass
class ChatLimits:
    quiet_seconds: float = 1.5  # wait this long for more messages before replying
    idle_seconds: float = 30 * 60  # this much quiet ends the conversation
    max_messages: int = 20  # messages a chat may send...
    per_seconds: float = 10 * 60  # ...in this window
    max_length: int = 500  # characters in one message


class Chats:
    def __init__(
        self,
        open_conversation: OpenConversation,
        deliver: Deliver,
        *,
        typing: Typing | None = None,
        limits: ChatLimits | None = None,
    ) -> None:
        self._open_conversation = open_conversation
        self._deliver = deliver
        self._typing = typing
        self._limits = limits or ChatLimits()
        self._inboxes: dict[str, asyncio.Queue[str]] = {}
        self._workers: dict[str, asyncio.Task[None]] = {}
        self._phones: dict[str, str] = {}  # the number each guest shared, for their next conversations too
        self._recent: dict[str, deque[float]] = {}  # when each chat's recent messages arrived
        self._warned: set[str] = set()  # chats told they're over the limit, until they're back under

    def set_phone(self, chat_id: str, phone: str) -> None:
        """The guest shared their own number: their conversation uses it from the next turn."""
        self._phones[chat_id] = phone

    async def receive(self, chat_id: str, text: str) -> None:
        """Queue a guest's message for their chat's worker, starting one if the chat has none."""
        if len(text) > self._limits.max_length:
            await self._send(chat_id, [TOO_LONG.format(limit=self._limits.max_length)])
            return
        if self._over_limit(chat_id):
            if chat_id not in self._warned:
                self._warned.add(chat_id)
                logger.warning("chat %s is over its message limit", chat_id)
                await self._send(chat_id, [TOO_FAST])
            return
        self._warned.discard(chat_id)
        inbox = self._inboxes.get(chat_id)
        if inbox is None:
            inbox = self._inboxes[chat_id] = asyncio.Queue()
            self._workers[chat_id] = asyncio.create_task(self._work(chat_id, inbox), name=f"chat_{chat_id}")
        inbox.put_nowait(text)

    async def aclose(self) -> None:
        """Close every open chat, saving each one's log."""
        workers = list(self._workers.values())
        for worker in workers:
            worker.cancel()
        await asyncio.gather(*workers, return_exceptions=True)

    def _over_limit(self, chat_id: str) -> bool:
        now = monotonic()
        recent = self._recent.setdefault(chat_id, deque())
        while recent and now - recent[0] > self._limits.per_seconds:
            recent.popleft()
        if len(recent) >= self._limits.max_messages:
            return True
        recent.append(now)
        return False

    async def _work(self, chat_id: str, inbox: asyncio.Queue[str]) -> None:
        conversation: Conversation | None = None
        try:
            while True:
                first = await _next(inbox, self._limits.idle_seconds)
                if first is None:
                    return  # quiet for too long: the chat is over
                burst = [first]
                while (more := await _next(inbox, self._limits.quiet_seconds)) is not None:
                    burst.append(more)
                for text in turns(burst):
                    async with self._showing_typing(chat_id):
                        if conversation is None:
                            conversation = await self._open(chat_id)
                            if conversation is None:
                                break  # the guest has been told why; this burst is dropped
                        reply = await self._reply(chat_id, conversation, text)
                    await self._send(chat_id, reply.lines)
                    if reply.ended:
                        await _close(conversation)
                        conversation = None
        finally:
            del self._inboxes[chat_id], self._workers[chat_id]  # a new message now starts a new worker
            if conversation is not None:
                await _close(conversation)

    async def _open(self, chat_id: str) -> Conversation | None:
        try:
            return await self._open_conversation(self._phones.get(chat_id))
        except ApiError as e:
            logger.error("chat %s: couldn't load the restaurant from the tool API: %s", chat_id, e)
            await self._send(chat_id, [NOT_SET_UP if e.code == "not_found" else API_DOWN])
        except Exception:
            logger.exception("chat %s: couldn't start a conversation", chat_id)
            await self._send(chat_id, [SORRY])
        return None

    async def _reply(self, chat_id: str, conversation: Conversation, text: str) -> Reply:
        try:
            phone = self._phones.get(chat_id)
            if phone and conversation.phone != phone:
                await conversation.know_phone(phone)
            return await conversation.reply(text)
        except Exception:  # Conversation.reply catches LLM failures itself; this is anything else
            logger.exception("chat %s: reply failed", chat_id)
            return Reply([SORRY])

    async def _send(self, chat_id: str, lines: list[str]) -> None:
        if not lines:
            return
        try:
            await self._deliver(chat_id, lines)
        except Exception:
            logger.exception("chat %s: couldn't send the reply", chat_id)

    @contextlib.asynccontextmanager
    async def _showing_typing(self, chat_id: str) -> AsyncIterator[None]:
        """Show "typing…" in the chat while a reply is being written."""
        if self._typing is None:
            yield
            return
        typing = self._typing

        async def keep_typing() -> None:
            while True:
                try:
                    await typing(chat_id)
                except Exception as e:  # cosmetic: never let it hold up the reply
                    logger.debug("chat %s: typing indicator failed: %s", chat_id, e)
                await asyncio.sleep(TYPING_EVERY)

        task = asyncio.create_task(keep_typing())
        try:
            yield
        finally:
            task.cancel()


async def _close(conversation: Conversation) -> None:
    try:
        await conversation.close()
    except Exception:
        logger.exception("couldn't close conversation %s cleanly", conversation.call_id)


async def _next(inbox: asyncio.Queue[str], timeout: float) -> str | None:
    """The next message, or None if none comes within `timeout` seconds."""
    while True:
        try:
            return await asyncio.wait_for(inbox.get(), timeout)
        except TimeoutError:
            # A message that arrived just as the wait timed out is still in the queue.
            if inbox.empty():
                return None


def turns(burst: list[str]) -> list[str]:
    """A burst of messages as turns: plain messages joined into one, each command a turn of its own."""
    result: list[str] = []
    joinable = False
    for text in burst:
        if text.startswith("/"):
            result.append(text)
            joinable = False
        elif joinable:
            result[-1] += "\n" + text
        else:
            result.append(text)
            joinable = True
    return result
