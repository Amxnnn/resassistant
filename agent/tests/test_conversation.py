"""One text chat through the real session, Receptionist and tools, with a scripted LLM."""

import json

from livekit.agents import DEFAULT_API_CONNECT_OPTIONS, llm

from agent.api_client import SAMPLE_RESTAURANT_PHONE
from agent.chat.conversation import MENU_SENT, Conversation, format_menu
from agent.prompts import build_chat_greeting

GUEST = "+919876543210"


class ScriptedLLM(llm.LLM):
    """Answers each request with the next scripted reply: some text, or a tool call (name, arguments)."""

    def __init__(self, *replies: str | tuple[str, dict]) -> None:
        super().__init__()
        self._replies = list(replies)
        self.requests: list[llm.ChatContext] = []

    @property
    def model(self) -> str:
        return "scripted"

    def chat(self, *, chat_ctx, tools=None, conn_options=DEFAULT_API_CONNECT_OPTIONS, **kwargs):
        self.requests.append(chat_ctx.copy())
        reply = self._replies.pop(0) if self._replies else "(the script has run out)"
        return _ScriptedStream(self, reply, chat_ctx=chat_ctx, tools=tools or [], conn_options=conn_options)


class _ScriptedStream(llm.LLMStream):
    def __init__(self, owner: ScriptedLLM, reply: str | tuple[str, dict], **kwargs) -> None:
        super().__init__(owner, **kwargs)
        self._reply = reply

    async def _run(self) -> None:
        if isinstance(self._reply, str):
            delta = llm.ChoiceDelta(role="assistant", content=self._reply)
        else:
            name, arguments = self._reply
            call = llm.FunctionToolCall(name=name, arguments=json.dumps(arguments), call_id=f"call_{name}")
            delta = llm.ChoiceDelta(role="assistant", tool_calls=[call])
        self._event_ch.send_nowait(llm.ChatChunk(id="scripted", delta=delta))


async def open_chat(api, *replies, phone=None) -> tuple[Conversation, ScriptedLLM]:
    scripted = ScriptedLLM(*replies)
    chat = await Conversation.open(
        api, SAMPLE_RESTAURANT_PHONE, channel="telegram", phone=phone, session_llm=scripted
    )
    return chat, scripted


def saved_logs(api) -> list:
    saved = []
    original = api.create_call_log

    async def recording(request):
        saved.append(request)
        return await original(request)

    api.create_call_log = recording
    return saved


async def test_a_new_chat_is_greeted_without_asking_the_llm(api, restaurant):
    chat, scripted = await open_chat(api)
    reply = await chat.reply("/start")
    assert reply.lines == [build_chat_greeting(restaurant)]
    assert "AI assistant" in reply.lines[0] and "staff" in reply.lines[0] and "saved" in reply.lines[0]
    assert scripted.requests == []
    await chat.close()


async def test_a_first_message_gets_the_greeting_then_the_answer(api, restaurant):
    chat, scripted = await open_chat(api, "Yes, free valet parking from 6 PM.")
    reply = await chat.reply("is there parking")
    assert reply.lines == [build_chat_greeting(restaurant), "Yes, free valet parking from 6 PM."]
    second = await chat.reply("/start")  # the greeting again on request, but not on every reply
    assert second.lines == [build_chat_greeting(restaurant)]
    # The chat prompt, with the menu and info in it, answers the question.
    prompt = scripted.requests[0].items[0].text_content
    assert "chatting with a guest by text message" in prompt and "Paneer Tikka" in prompt
    await chat.close()


async def test_a_booking_is_read_back_then_saved_and_the_code_is_written_out(api):
    chat, _ = await open_chat(
        api,
        ("prepare_booking", {"party_size": 4, "day": "2026-10-27", "time": "19:30", "guest_name": "Asha"}),
        ("confirm_action", {}),
        phone=GUEST,
    )
    read_back = await chat.reply("Table for 4 this Tuesday at 7:30 pm, name Asha")
    assert read_back.lines[-1].endswith(
        "a table for 4 under Asha, Tuesday the 27th at 7:30 PM. Shall I book it?"
    )
    assert "your number is" not in read_back.lines[-1]  # they shared it: no need to read it back

    booked = await chat.reply("yes")
    saved = (await api.find_reservations(chat._state.restaurant.id, phone=GUEST)).reservations
    assert len(saved) == 1 and saved[0].guest_name == "Asha"
    assert f"Your booking code is {saved[0].code}." in booked.lines[0]  # "K7Q2", not "K, 7, Q, 2"
    assert not booked.ended
    await chat.close()


async def test_a_typed_number_is_read_back_written_out(api):
    chat, _ = await open_chat(
        api,
        (
            "prepare_booking",
            {
                "party_size": 2,
                "day": "2026-10-27",
                "time": "20:00",
                "guest_name": "Ravi",
                "phone_number": "98765 43210",
            },
        ),
    )
    reply = await chat.reply("table for 2 tuesday 8pm, Ravi, 98765 43210")
    assert "your number is +91 98765 43210. Shall I book it?" in reply.lines[-1]
    await chat.close()


async def test_sharing_a_number_mid_chat_stops_the_agent_asking_for_it(api):
    chat, _ = await open_chat(api)
    assert "never ask for it" not in chat._agent.instructions
    await chat.know_phone(GUEST)
    assert chat.phone == GUEST
    assert "They shared their number with you, so never ask for it." in chat._agent.instructions
    assert "Paneer Tikka" in chat._agent.instructions  # the facts stay in the rebuilt prompt
    await chat.close()


async def test_goodbye_ends_the_chat_and_saves_its_log(api):
    saved = saved_logs(api)
    chat, scripted = await open_chat(api, "Yes, free valet parking from 6 PM.", phone=GUEST)
    await chat.reply("is there parking")
    bye = await chat.reply("Thanks, bye!")
    assert bye.ended and bye.lines == ["Thanks for chatting with The Saffron Table. Take care!"]
    assert len(scripted.requests) == 1  # a plain goodbye goes straight to end_call
    await chat.close()
    await chat.close()  # safe twice: one log

    [log] = saved
    assert log.channel == "telegram" and log.call_id == chat.call_id
    assert log.caller_number == GUEST and log.dialed_number is None
    assert log.outcome == "answered"
    assert [t.speaker for t in log.turns] == ["agent", "caller", "agent", "caller", "agent"]
    assert log.turns[2].latency.llm_model == "scripted" and log.turns[2].latency.total_ms is None


async def test_a_chat_the_guest_never_wrote_in_saves_no_log(api):
    saved = saved_logs(api)
    chat, _ = await open_chat(api)
    await chat.reply("/start")
    await chat.close()
    assert saved == []


async def test_menu_comes_whole_from_the_data_without_the_llm(api):
    saved = saved_logs(api)
    chat, scripted = await open_chat(api)
    reply = await chat.reply("/menu")
    menu = reply.lines[-1]
    assert menu.startswith("The Saffron Table menu")
    assert "- Paneer Tikka, ₹380 (vegetarian, gluten free, mild spicy). Contains dairy." in menu
    # Unknown allergens and known-none are both spelled out, so neither reads as the other.
    assert "- Aloo Gobi, ₹320 (vegetarian, vegan, mild spicy). Allergen details not listed." in menu
    assert "- Chicken 65, ₹420 (gluten free, hot spicy). No listed allergens." in menu
    assert "- Lamb Rogan Josh, ₹620 (gluten free, hot spicy). Contains dairy. Not available today." in menu
    assert "confirm with our staff" in menu
    assert scripted.requests == []
    # The LLM's history gets a short stand-in; the transcript gets the menu as sent.
    assert chat._agent.chat_ctx.items[-1].text_content == MENU_SENT
    await chat.close()
    assert saved[0].turns[-1].text == menu and saved[0].turns[-1].latency is None


def test_a_menu_without_dishes_says_so(restaurant):
    assert "couldn't load the menu" in format_menu(restaurant, [])


async def test_a_failed_turn_apologises_instead_of_going_silent(api):
    chat, _ = await open_chat(api)

    async def broken(**_kwargs):
        raise RuntimeError("LLM down")

    chat._session.run = lambda **kwargs: broken(**kwargs)
    reply = await chat.reply("hello?")
    assert reply.lines[-1] == "Sorry, something went wrong on my side. Could you send that again?"
    await chat.close()
