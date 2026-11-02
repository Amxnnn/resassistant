"""The Telegram bot against a stand-in Bot API: who gets in, phone numbers, commands and replies."""

import json

import httpx
import pytest

from agent.chat.telegram import (
    NO_KEYBOARD,
    NOT_YOUR_CONTACT,
    SHARE_KEYBOARD,
    SHARED,
    TEXT_ONLY,
    TelegramBot,
    TelegramError,
    command,
    split_message,
)

TOKEN = "123456:TEST-token"
ME, STRANGER = 111, 999


class BotAPI:
    """Records each Bot API call and answers it like Telegram would."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []
        self.updates: list[list[dict]] = []  # one list per getUpdates call
        self.fail_with: dict | None = None

    def handler(self, request: httpx.Request) -> httpx.Response:
        if "/file/" in request.url.path:  # a file download: the voice note's audio
            self.calls.append(("download", {"path": request.url.path}))
            return httpx.Response(200, content=b"OggS-voice-note")
        method = request.url.path.rsplit("/", 1)[-1]
        body = json.loads(request.content or b"{}")
        self.calls.append((method, body))
        if method == "getFile":
            return httpx.Response(200, json={"ok": True, "result": {"file_path": "voice/file_7.oga"}})
        if self.fail_with:
            return httpx.Response(200, json={"ok": False, **self.fail_with})
        if method == "getUpdates":
            return httpx.Response(
                200, json={"ok": True, "result": self.updates.pop(0) if self.updates else []}
            )
        if method == "getMe":
            return httpx.Response(200, json={"ok": True, "result": {"username": "ResassistantBot"}})
        return httpx.Response(200, json={"ok": True, "result": True})

    def sent(self) -> list[dict]:
        return [body for method, body in self.calls if method == "sendMessage"]


class RecordingChats:
    def __init__(self) -> None:
        self.received: list[tuple[str, str]] = []
        self.phones: dict[str, str] = {}

    async def receive(self, chat_id: str, text: str) -> None:
        self.received.append((chat_id, text))

    def set_phone(self, chat_id: str, phone: str) -> None:
        self.phones[chat_id] = phone

    async def aclose(self) -> None:
        pass


@pytest.fixture
def telegram():
    return BotAPI()


@pytest.fixture
def bot(telegram):
    async def no_conversations(phone):
        raise AssertionError("the bot's Chats are replaced in these tests")

    bot = TelegramBot(
        TOKEN,
        allowed_user_ids={ME},
        open_conversation=no_conversations,
        transport=httpx.MockTransport(telegram.handler),
    )
    bot.chats = RecordingChats()
    return bot


def message(text=None, *, user=ME, chat_type="private", **extra) -> dict:
    msg = {"message_id": 1, "chat": {"id": user, "type": chat_type}, "from": {"id": user, "first_name": "A"}}
    if text is not None:
        msg["text"] = text
    return {"update_id": 500, "message": {**msg, **extra}}


async def test_a_text_from_an_allowed_user_goes_to_their_chat(bot, telegram):
    await bot.handle(message("table for 2 tonight?"))
    assert bot.chats.received == [(str(ME), "table for 2 tonight?")]
    assert telegram.calls == []  # the reply comes later, from the chat's worker


async def test_anyone_else_is_turned_away_and_told_their_id(bot, telegram):
    await bot.handle(message("hi", user=STRANGER))
    assert bot.chats.received == []
    [sent] = telegram.sent()
    assert "private demo" in sent["text"] and str(STRANGER) in sent["text"]


async def test_group_chats_are_ignored(bot, telegram):
    await bot.handle(message("hi", chat_type="group"))
    assert bot.chats.received == [] and telegram.calls == []


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("/menu", "/menu"),
        ("/Menu@ResassistantBot", "/menu"),
        ("/start abc123", "/start"),
        ("hi /menu", "hi /menu"),
    ],
)
def test_commands_arrive_without_the_bot_name_or_arguments(text, expected):
    assert command(text) == expected


async def test_sharing_your_own_number_sets_it_and_tells_the_agent(bot, telegram):
    contact = {"phone_number": "919876543210", "user_id": ME, "first_name": "A"}
    await bot.handle(message(contact=contact))
    assert bot.chats.phones == {str(ME): "+919876543210"}  # with the "+" Telegram may leave off
    assert bot.chats.received == [(str(ME), SHARED)]


async def test_someone_elses_contact_is_not_used(bot, telegram):
    contact = {"phone_number": "+14155550199", "user_id": STRANGER, "first_name": "B"}
    await bot.handle(message(contact=contact))
    assert bot.chats.phones == {} and bot.chats.received == []
    assert telegram.sent()[0]["text"] == NOT_YOUR_CONTACT


async def test_a_contact_without_a_telegram_account_is_not_used(bot, telegram):
    contact = {"phone_number": "+14155550199", "first_name": "B"}  # saved in the address book only
    await bot.handle(message(contact=contact))
    assert bot.chats.phones == {}


async def test_stickers_and_photos_get_a_text_only_note(bot, telegram):
    await bot.handle(message(sticker={"file_id": "x"}))
    assert telegram.sent()[0]["text"] == TEXT_ONLY and bot.chats.received == []


async def test_the_share_button_shows_until_the_number_is_shared_then_goes_away(bot, telegram):
    chat = str(ME)
    await bot.send(chat, ["Hi!", "How can I help?"])
    first, second = telegram.sent()
    assert "reply_markup" not in first and second["reply_markup"] == SHARE_KEYBOARD  # on the last only

    await bot.handle(message(contact={"phone_number": "+919876543210", "user_id": ME}))
    await bot.send(chat, ["Thanks!"])
    await bot.send(chat, ["Anything else?"])
    *_, removed, plain = telegram.sent()
    assert removed["reply_markup"] == NO_KEYBOARD
    assert "reply_markup" not in plain


def test_long_text_is_split_at_line_breaks_under_telegrams_limit():
    text = "\n".join(f"line {i:04d}" for i in range(1000))  # about 10,000 characters
    parts = split_message(text)
    assert all(len(p) <= 4096 for p in parts) and len(parts) == 3
    assert "\n".join(parts) == text


async def test_a_poll_handles_each_update_and_moves_the_offset_on(bot, telegram):
    telegram.updates = [[{**message("hi"), "update_id": 7}, {**message("there"), "update_id": 8}]]
    offset = await bot.poll(None)
    assert offset == 9
    assert bot.chats.received == [(str(ME), "hi"), (str(ME), "there")]
    method, body = telegram.calls[0]
    assert method == "getUpdates" and body["allowed_updates"] == ["message"] and "offset" not in body


async def test_telegram_errors_carry_the_code_but_never_the_token(bot, telegram):
    telegram.fail_with = {"error_code": 401, "description": "Unauthorized"}
    with pytest.raises(TelegramError) as raised:
        await bot.run()
    assert raised.value.code == 401

    async def unreachable(request):
        raise httpx.ConnectError(f"can't reach {request.url}")

    offline = TelegramBot(
        TOKEN, allowed_user_ids={ME}, open_conversation=None, transport=httpx.MockTransport(unreachable)
    )
    with pytest.raises(TelegramError) as raised:
        await offline.typing(str(ME))
    assert raised.value.code == 0 and TOKEN not in str(raised.value)
    await offline.aclose()


# -- voice notes -----------------------------------------------------------------------------


def voice_note(duration=4) -> dict:
    return message(voice={"file_id": "AwAD", "duration": duration, "mime_type": "audio/ogg"})


def hearing(words: str, heard: list):
    async def transcribe(audio: bytes, mime_type: str) -> str:
        heard.append((audio, mime_type))
        return words

    return transcribe


async def test_a_voice_note_is_heard_shown_back_and_answered(bot, telegram):
    heard: list = []
    bot._transcribe = hearing("Table for two tomorrow at 8.", heard)
    await bot.handle(voice_note())
    assert heard == [(b"OggS-voice-note", "audio/ogg")]
    assert telegram.sent()[0]["text"] == 'I heard: "Table for two tomorrow at 8."'
    assert bot.chats.received == [(str(ME), "Table for two tomorrow at 8.")]
    download = next(body for method, body in telegram.calls if method == "download")
    assert download["path"].endswith("/voice/file_7.oga")


async def test_a_long_voice_note_is_turned_away_before_any_transcription(bot, telegram):
    heard: list = []
    bot._transcribe = hearing("anything", heard)
    await bot.handle(voice_note(duration=95))
    assert heard == [] and bot.chats.received == []
    assert "under 30 seconds" in telegram.sent()[0]["text"]


async def test_a_voice_note_with_no_words_asks_again(bot, telegram):
    bot._transcribe = hearing("", [])
    await bot.handle(voice_note())
    assert bot.chats.received == [] and "couldn't make out" in telegram.sent()[0]["text"]


async def test_a_failed_transcription_says_so_and_never_logs_the_token(bot, telegram, caplog):
    async def broken(audio, mime_type):
        raise httpx.ConnectError(f"can't reach https://api.telegram.org/file/bot{TOKEN}/voice")

    bot._transcribe = broken
    await bot.handle(voice_note())
    assert bot.chats.received == [] and "type it instead" in telegram.sent()[0]["text"]
    assert TOKEN not in caplog.text


async def test_without_a_transcriber_voice_notes_get_the_text_only_note(bot, telegram):
    bot._transcribe = None
    await bot.handle(voice_note())
    assert telegram.sent()[0]["text"] == TEXT_ONLY and bot.chats.received == []


async def test_voice_notes_go_to_deepgram_with_the_calls_settings():
    from agent.chat.voice_notes import VoiceNotes

    seen = []

    def deepgram(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        alternatives = [{"transcript": " Do you have Jain food? ", "confidence": 0.97}]
        return httpx.Response(200, json={"results": {"channels": [{"alternatives": alternatives}]}})

    notes = VoiceNotes(
        "dg-key",
        language="en-IN",
        keyterms=["Paneer Tikka", "Swiggy"],
        transport=httpx.MockTransport(deepgram),
    )
    assert await notes.transcribe(b"OggS", "audio/ogg") == "Do you have Jain food?"
    request = seen[0]
    assert (
        request.headers["authorization"] == "Token dg-key" and request.headers["content-type"] == "audio/ogg"
    )
    params = request.url.params
    assert params["model"] == "nova-3" and params["language"] == "en-IN"
    assert params.get_list("keyterm") == ["Paneer Tikka", "Swiggy"]
    await notes.aclose()
