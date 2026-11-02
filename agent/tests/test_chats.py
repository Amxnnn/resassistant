"""Many chats at once: bursts, order, limits and endings, with stand-in conversations."""

import asyncio

from agent.api_client import ApiError
from agent.chat.chats import API_DOWN, NOT_SET_UP, TOO_FAST, ChatLimits, Chats, turns
from agent.chat.conversation import Reply

GUEST = "+919876543210"


class FakeConversation:
    def __init__(self, phone: str | None, delay: float = 0.0) -> None:
        self.phone = phone
        self.texts: list[str] = []
        self.closed = False
        self.call_id = "call_fake"
        self._delay = delay

    async def know_phone(self, phone: str) -> None:
        self.phone = phone

    async def reply(self, text: str) -> Reply:
        await asyncio.sleep(self._delay)
        self.texts.append(text)
        return Reply([f"re: {text}"], ended=text == "bye")

    async def close(self) -> None:
        self.closed = True


def make_chats(*, delay: float = 0.0, failures: list[Exception] | None = None, **limits):
    """Chats with stand-in conversations. Each of `failures` fails one attempt to open a conversation."""
    opened: list[FakeConversation] = []
    sent: list[tuple[str, list[str]]] = []
    failures = list(failures or [])

    async def open_conversation(phone):
        if failures:
            raise failures.pop(0)
        opened.append(FakeConversation(phone, delay))
        return opened[-1]

    async def deliver(chat_id, lines):
        sent.append((chat_id, lines))

    settings = {"quiet_seconds": 0.05, "idle_seconds": 5.0, **limits}
    return Chats(open_conversation, deliver, limits=ChatLimits(**settings)), opened, sent


async def settle(seconds: float = 0.2) -> None:
    await asyncio.sleep(seconds)


async def test_a_burst_of_messages_gets_one_reply():
    chats, opened, sent = make_chats()
    for text in ("hi", "table for 4", "saturday"):
        await chats.receive("7", text)
    await settle()
    assert opened[0].texts == ["hi\ntable for 4\nsaturday"]
    assert sent == [("7", ["re: hi\ntable for 4\nsaturday"])]
    await chats.aclose()


def test_a_command_is_never_merged_into_other_messages():
    assert turns(["/menu", "is the korma spicy", "and vegan?", "/start"]) == [
        "/menu",
        "is the korma spicy\nand vegan?",
        "/start",
    ]


async def test_a_message_sent_during_a_reply_waits_its_turn():
    chats, opened, sent = make_chats(delay=0.2)
    await chats.receive("7", "first")
    await settle(0.1)  # the reply to "first" is being written
    await chats.receive("7", "second")
    await settle(0.5)
    assert opened[0].texts == ["first", "second"]
    assert [lines for _, lines in sent] == [["re: first"], ["re: second"]]
    await chats.aclose()


async def test_chats_with_different_guests_are_separate_conversations():
    chats, opened, _ = make_chats()
    await chats.receive("7", "hi from 7")
    await chats.receive("8", "hi from 8")
    await settle()
    assert sorted(c.texts[0] for c in opened) == ["hi from 7", "hi from 8"]
    await chats.aclose()


async def test_goodbye_closes_the_conversation_and_the_next_message_starts_a_new_one():
    chats, opened, _ = make_chats()
    await chats.receive("7", "bye")
    await settle()
    assert opened[0].closed
    await chats.receive("7", "hello again")
    await settle()
    assert len(opened) == 2 and opened[1].texts == ["hello again"]
    await chats.aclose()


async def test_a_quiet_chat_closes_and_the_next_message_starts_a_new_one():
    chats, opened, _ = make_chats(idle_seconds=0.2)
    await chats.receive("7", "hi")
    await settle(0.5)
    assert opened[0].closed
    await chats.receive("7", "back again")
    await settle()
    assert len(opened) == 2 and opened[1].texts == ["back again"]
    await chats.aclose()


async def test_a_shared_number_reaches_a_new_conversation_and_an_open_one():
    chats, opened, _ = make_chats()
    chats.set_phone("7", GUEST)
    await chats.receive("7", "hi")
    await settle()
    assert opened[0].phone == GUEST  # opened with it

    await chats.receive("8", "hi")
    await settle()
    chats.set_phone("8", GUEST)
    await chats.receive("8", "I've shared my phone number.")
    await settle()
    assert opened[1].phone == GUEST  # told before its next turn
    await chats.aclose()


async def test_a_flood_of_messages_is_cut_off_with_one_notice():
    chats, opened, sent = make_chats(max_messages=3, per_seconds=60)
    for i in range(6):
        await chats.receive("7", f"message {i}")
    await settle()
    assert opened[0].texts == ["message 0\nmessage 1\nmessage 2"]
    assert sent.count(("7", [TOO_FAST])) == 1
    await chats.aclose()


async def test_a_very_long_message_is_turned_away():
    chats, opened, sent = make_chats(max_length=20)
    await chats.receive("7", "x" * 21)
    await settle()
    assert opened == [] and "shorter parts, under 20 characters" in sent[0][1][0]
    await chats.aclose()


async def test_an_unreachable_api_is_explained_and_the_next_message_tries_again():
    chats, opened, sent = make_chats(failures=[ApiError("unreachable", "down")])
    await chats.receive("7", "hi")
    await settle()
    assert sent == [("7", [API_DOWN])] and opened == []
    await chats.receive("7", "hello?")
    await settle()
    assert opened[0].texts == ["hello?"]
    await chats.aclose()


async def test_a_number_the_api_doesnt_know_is_explained():
    chats, _, sent = make_chats(failures=[ApiError("not_found", "no such number")])
    await chats.receive("7", "hi")
    await settle()
    assert sent == [("7", [NOT_SET_UP])]
    await chats.aclose()


async def test_closing_closes_every_open_conversation():
    chats, opened, _ = make_chats()
    await chats.receive("7", "hi")
    await chats.receive("8", "hi")
    await settle()
    await chats.aclose()
    assert len(opened) == 2 and all(c.closed for c in opened)


async def test_typing_shows_while_a_reply_is_written():
    typed: list[str] = []

    async def open_conversation(phone):
        return FakeConversation(phone, delay=0.1)

    async def deliver(chat_id, lines):
        pass

    async def typing(chat_id):
        typed.append(chat_id)

    chats = Chats(open_conversation, deliver, typing=typing, limits=ChatLimits(quiet_seconds=0.01))
    await chats.receive("7", "hi")
    await settle(0.3)
    assert typed == ["7"]
    await chats.aclose()
