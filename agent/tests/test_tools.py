from datetime import date

import pytest
from livekit.agents import StopResponse, ToolResult
from livekit.agents.llm import ChatContext

from agent.api_client.sample import RESTAURANT_ID
from agent.tools import (
    ANYTHING_ELSE,
    ASK_WHICH_DAY,
    DAY_TOO_FAR,
    NOT_CONFIRMED_YET,
    NOT_DONE_YET,
    NOTHING_TO_CHANGE,
    READ_BACK,
    Receptionist,
    real_name,
    resolve_day,
)

from .conftest import Speaker, turn


def spoke(result) -> None:
    """The tool said its line itself: no follow-up LLM request for this turn."""
    assert isinstance(result, ToolResult) and result.reply_required is False


async def test_a_free_time_is_announced_once_and_missing_details_asked_one_at_a_time(agent, make_state):
    state = make_state()
    first = turn(state, "s1")
    spoke(await agent.prepare_booking(first, 4, "2026-10-27", "19:30"))
    assert first.session.said == [
        "Good news, we have a table for 4 on Tuesday at 7:30 PM. What name should I put the booking under?"
    ]

    second = turn(state, "s2")
    spoke(await agent.prepare_booking(second, 4, "2026-10-27", "19:30", guest_name="Asha"))
    assert second.session.said == ["Thanks, Asha. What's the best phone number for the booking?"]
    assert state.pending is None

    third = turn(state, "s3")
    result = await agent.prepare_booking(
        third, 4, "2026-10-27", "19:30", guest_name="Asha", phone_number="98765 43210"
    )
    spoke(result)
    lead, details = third.session.said[0].split(" a table", 1)
    assert lead in READ_BACK
    assert details == (
        " for 4 under Asha, Tuesday the 27th at 7:30 PM, and your number is 9 8 7 6 5, 4 3 2 1 0. "
        "Shall I book it?"
    )
    assert "Not booked yet" in result.output and state.pending is not None


async def test_a_name_but_no_number_still_hears_the_time_is_free(agent, make_state):
    ctx = turn(make_state(), "s1")
    await agent.prepare_booking(ctx, 4, "2026-10-27", "19:30", guest_name="Asha")
    assert ctx.session.said == [
        "Good news, we have a table for 4 on Tuesday at 7:30 PM. What's the best phone number for the booking?"
    ]


@pytest.mark.parametrize("stand_in", ["Guest", "unknown", "N/A", "the caller", "  ", None])
async def test_a_stand_in_name_is_never_booked(agent, make_state, stand_in):
    state = make_state(caller_phone="+12025550199")
    ctx = turn(state, "s1")
    await agent.prepare_booking(ctx, 2, "2026-10-27", "20:00", guest_name=stand_in)
    assert ctx.session.said[0].endswith("What name should I put the booking under?")
    assert state.pending is None


def test_real_names_pass_through_tidied():
    assert real_name("  Asha   Rao ") == "Asha Rao"
    assert real_name("Mr Sharma") == "Mr Sharma"
    assert real_name("आशा") == "आशा"
    assert real_name("Mr.") is None


async def test_booking_is_read_back_and_only_saved_after_a_later_yes(agent, make_state, api):
    state = make_state()
    ctx = turn(state, "s1")
    await agent.prepare_booking(ctx, 4, "2026-10-27", "19:30", guest_name="Asha", phone_number="98765 43210")
    assert ctx.session.said[0].startswith("Good news, that time's free. Just to confirm: a table for 4")

    # Same turn as the prepare: the caller hasn't had a chance to say yes.
    assert await agent.confirm_action(turn(state, "s1")) == NOT_CONFIRMED_YET
    assert not (await api.find_reservations(RESTAURANT_ID, phone="+919876543210")).reservations

    yes = turn(state, "s2")
    spoke(await agent.confirm_action(yes))
    saved = (await api.find_reservations(RESTAURANT_ID, phone="+919876543210")).reservations
    assert len(saved) == 1 and saved[0].guest_name == "Asha" and saved[0].party_size == 4
    told = f"You're all set! Your booking code is {', '.join(saved[0].code)}. "
    said = yes.session.said[0]
    assert said.startswith(told) and said.removeprefix(told) in ANYTHING_ELSE
    assert state.pending is None and state.outcomes == ["booked"] and state.booked_on == date(2026, 10, 27)


async def test_caller_id_wins_over_a_number_the_llm_passes(make_state, api):
    state = make_state(caller_phone="+12025550199")
    agent = Receptionist(state)
    ctx = turn(state, "s1")
    await agent.prepare_booking(ctx, 2, "2026-10-27", "20:00", guest_name="Ravi", phone_number="+911234567890")
    assert "number" not in ctx.session.said[0]
    await agent.confirm_action(turn(state, "s2"))
    assert (await api.find_reservations(RESTAURANT_ID, phone="+12025550199")).reservations
    assert not (await api.find_reservations(RESTAURANT_ID, phone="+911234567890")).reservations


async def test_full_slot_says_no_first_then_offers_alternatives_and_prepares_nothing(agent, make_state):
    state = make_state(caller_phone="+12025550199")
    ctx = turn(state, "s1")
    spoke(await agent.prepare_booking(ctx, 4, "2026-10-31", "19:30", guest_name="Ravi"))
    assert ctx.session.said == [
        "Sorry, 7:30 PM is taken. I can do 8:30 PM, 8:45 PM or 9 PM. Would one of those work?"
    ]
    assert state.pending is None


async def test_confirm_with_nothing_prepared_does_nothing(agent, make_state):
    assert "nothing to confirm" in await agent.confirm_action(turn(make_state(), "s1"))


async def test_change_and_cancel_an_existing_booking_by_code(agent, make_state, api):
    state = make_state()
    found = await agent.find_my_bookings(turn(state, "s1"), booking_code="k7q2")
    assert "a table for 2 under Asha Rao, Sunday the 1st at 1 PM, code K, 7, Q, 2" in found

    change = turn(state, "s1")
    spoke(await agent.prepare_change(change, "K7Q2", new_time="13:30", new_party_size=3))
    assert change.session.said[0].endswith(
        "your table for 2 on Sunday the 1st at 1 PM becomes a table for 3, Sunday the 1st at 1:30 PM. "
        "Is that right?"
    )
    changed = turn(state, "s2")
    await agent.confirm_action(changed)
    assert changed.session.said[0].startswith(
        "Done, it's now a table for 3 on Sunday the 1st at 1:30 PM. Your code is still K, 7, Q, 2."
    )

    cancel = turn(state, "s3")
    spoke(await agent.prepare_cancel(cancel, "K7Q2"))
    assert cancel.session.said == [
        "Just to confirm, you'd like to cancel your table for 3 on Sunday the 1st at 1:30 PM, under Asha Rao?"
    ]
    cancelled = turn(state, "s4")
    await agent.confirm_action(cancelled)
    assert cancelled.session.said[0].startswith("Done, that booking is cancelled.")
    assert not (await api.find_reservations(RESTAURANT_ID, code="K7Q2")).reservations
    assert state.outcomes == ["changed", "cancelled"]


async def test_a_change_that_changes_nothing_is_not_read_back(agent, make_state):
    state = make_state()
    assert await agent.prepare_change(turn(state, "s1"), "K7Q2", new_time="13:00") == NOTHING_TO_CHANGE
    assert state.pending is None


async def test_menu_details_flag_missing_allergen_data(agent, make_state):
    reply = await agent.search_menu(turn(make_state(), "s1"), query="aloo gobi")
    assert "Aloo Gobi, 320 rupees, mild spicy." in reply
    assert "NO allergen information" in reply


async def test_large_party_is_steered_to_a_message(agent, make_state, api):
    state = make_state()
    assert "take your details" in await agent.check_availability(turn(state, "s1"), "2026-10-27", "20:00", 12)
    ctx = turn(state, "s2")
    spoke(
        await agent.take_message(
            ctx, "Rohan", "large_party", "Birthday for 12 on Tuesday at 8 PM.", "98765 43210"
        )
    )
    assert ctx.session.said[0].startswith("I've passed that to the manager, who will call you back. ")
    assert api.messages[0].caller_phone == "+919876543210"
    assert state.outcomes == ["message_taken"]


def with_caller_saying(ctx, words: str):
    """Give the stand-in RunContext a session history ending with the caller's words."""
    history = ChatContext()
    history.add_message(role="assistant", content="Anything else I can help with?")
    history.add_message(role="user", content=words)
    ctx.session.history = history
    return ctx


async def test_end_call_says_goodbye_and_hangs_up_after_it(agent, make_state):
    state = make_state()
    ended = []
    state.end_call = ended.append
    ctx = with_caller_saying(turn(state, "s9"), "No, that's all. Thanks, bye!")
    spoke(await agent.end_call(ctx))
    assert ctx.session.said == ["Thanks for calling The Saffron Table. Take care, goodbye!"]
    assert [handle.text for handle in ended] == ctx.session.said  # hangs up after that speech


async def test_the_goodbye_after_a_booking_mentions_the_day(agent, make_state):
    state = make_state()
    state.booked_on = date(2026, 10, 27)
    ctx = with_caller_saying(turn(state, "s9"), "Perfect, thank you!")
    await agent.end_call(ctx)
    assert ctx.session.said == ["Thanks for calling, and we'll see you on Tuesday! Goodbye."]


async def test_end_call_refuses_to_hang_up_on_a_caller_who_is_still_talking(agent, make_state):
    state = make_state()
    ended = []
    state.end_call = ended.append
    for words in ("What time do you open on Sunday?", "Okay. And is there parking?", "hello"):
        ctx = with_caller_saying(turn(state, "s9"), words)
        assert await agent.end_call(ctx) == NOT_DONE_YET
        assert ctx.session.said == []
    assert ended == []


async def test_a_line_the_caller_cut_into_is_not_said(agent, make_state):
    state = make_state()
    ctx = turn(state, "s1")
    ctx.speech_handle.interrupted = True
    result = await agent.prepare_booking(ctx, 2, "2026-10-27", "20:00")
    assert ctx.session.said == [] and "the caller interrupted" in result.output
    assert result.reply_required is False  # their new turn gets the reply


async def test_allergen_question_sent_as_a_diet_filter_still_finds_the_dish(agent, make_state):
    reply = await agent.search_menu(turn(make_state(), "s1"), query="aloo gobi", dietary=["nut_free"])
    assert reply.startswith("(These aren't tagged nut free; answer from the allergen details.)")
    assert "Aloo Gobi" in reply and "NO allergen information" in reply


def test_every_conversation_gets_its_own_id():
    from agent.tools import new_call_id

    ids = {new_call_id() for _ in range(1000)}
    assert len(ids) == 1000
    assert all(i.startswith("call_") and len(i) == 37 for i in ids)


async def test_two_callers_at_once_never_get_each_others_bookings(api, restaurant):
    """Interleave two calls step by step: each booking carries its own call's id, name and number."""
    from agent.tools import CallState, new_call_id

    sent = []
    create = api.create_reservation

    async def recording_create(request):
        sent.append(request)
        return await create(request)

    api.create_reservation = recording_create
    asha = CallState(api=api, restaurant=restaurant, call_id=new_call_id())
    ravi = CallState(api=api, restaurant=restaurant, call_id=new_call_id())
    asha_agent, ravi_agent = Receptionist(asha), Receptionist(ravi)

    await asha_agent.prepare_booking(
        turn(asha, "a1"), 2, "2026-10-27", "19:30", guest_name="Asha", phone_number="98765 11111"
    )
    await ravi_agent.prepare_booking(
        turn(ravi, "r1"), 4, "2026-10-27", "19:30", guest_name="Ravi", phone_number="98765 22222"
    )
    await ravi_agent.confirm_action(turn(ravi, "r2"))
    await asha_agent.confirm_action(turn(asha, "a2"))

    by_call = {r.call_id: (r.guest_name, r.guest_phone, r.party_size) for r in sent}
    assert by_call == {
        asha.call_id: ("Asha", "+919876511111", 2),
        ravi.call_id: ("Ravi", "+919876522222", 4),
    }
    asha_bookings = (await api.find_reservations(restaurant.id, phone="+919876511111")).reservations
    assert [(b.guest_name, b.party_size) for b in asha_bookings] == [("Asha", 2)]
    assert asha.outcomes == ["booked"] and ravi.outcomes == ["booked"]


async def test_booking_reuses_the_availability_the_caller_just_heard(agent, make_state, api):
    calls = []
    check = api.check_availability

    async def counting_check(*args, **kwargs):
        calls.append(args)
        return await check(*args, **kwargs)

    api.check_availability = counting_check
    state = make_state(caller_phone="+12025550199")
    await agent.check_availability(turn(state, "s1"), "2026-10-27", "20:00", 2)
    ctx = turn(state, "s1")
    await agent.prepare_booking(ctx, 2, "2026-10-27", "20:00", guest_name="Ravi")
    assert len(calls) == 1  # one round trip, not two
    assert ctx.session.said[0].startswith(READ_BACK)  # already heard it's free: straight to the read-back
    await agent.prepare_booking(turn(state, "s1"), 3, "2026-10-27", "20:00", guest_name="Ravi")
    assert len(calls) == 2  # a different party size is a fresh check


async def test_call_outcome_reflects_what_the_call_achieved(make_state):
    state = make_state()
    assert state.outcome(caller_spoke=False) == "hung_up"
    assert state.outcome(caller_spoke=True) == "answered"
    state.outcomes += ["message_taken", "booked"]
    assert state.outcome(caller_spoke=True) == "booked"


@pytest.mark.parametrize(
    ("said", "expected"),
    [
        ("this Tuesday", "2026-10-27"),
        ("Tuesday", "2026-10-27"),
        ("tue", "2026-10-27"),
        ("today", "2026-10-24"),
        ("tonight", "2026-10-24"),
        ("tomorrow", "2026-10-25"),
        ("Saturday", "2026-10-24"),  # said on a Saturday: today
        ("next Saturday", "2026-10-31"),
        ("Monday", "2026-10-26"),
        ("27th", "2026-10-27"),
        ("the 1st of November", "2026-11-01"),
        ("2026-12-25", "2026-12-25"),
    ],
)
def test_days_are_resolved_from_the_callers_words_using_the_api_calendar(make_state, said, expected):
    """Today in the sample data is Saturday 24 October 2026."""
    assert resolve_day(make_state(), said) == date.fromisoformat(expected)


def test_unclear_or_far_off_days_become_a_question(make_state):
    assert resolve_day(make_state(), "sometime soon") == ASK_WHICH_DAY
    assert resolve_day(make_state(), "15th December") == DAY_TOO_FAR


async def test_this_tuesday_is_booked_on_tuesday(agent, make_state):
    """The LLM once turned "this Tuesday" into Sunday's date; now it only passes the words."""
    state = make_state(caller_phone="+12025550199")
    ctx = turn(state, "s1")
    await agent.prepare_booking(ctx, 2, "this Tuesday", "20:15", guest_name="Priya")
    assert "Tuesday the 27th at 8:15 PM" in ctx.session.said[0]
    assert f"{state.pending.request.start:%Y-%m-%d %H:%M}" == "2026-10-27 20:15"


async def test_changing_the_day_uses_the_callers_words_too(agent, make_state):
    state = make_state()
    ctx = turn(state, "s1")
    await agent.prepare_change(ctx, "K7Q2", new_day="Tuesday")
    assert ctx.session.said[0].endswith("becomes a table for 2, Tuesday the 27th at 1 PM. Is that right?")


async def test_a_slow_lookup_gets_one_short_filler_per_reply(agent, make_state, api, monkeypatch):
    import asyncio

    import agent.tools as tools

    monkeypatch.setattr(tools, "FILLER_AFTER_SECONDS", 0.05)
    real = api.check_availability

    async def slow(*args, **kwargs):
        await asyncio.sleep(0.2)
        return await real(*args, **kwargs)

    api.check_availability = slow
    state = make_state(caller_phone="+12025550199")
    speaker = Speaker()
    first = turn(state, "s1")
    first.session = speaker
    await agent.check_availability(first, "2026-10-27", "20:00", 2)
    await agent.check_availability(first, "2026-10-28", "20:00", 2)  # same reply: no second filler
    assert len(speaker.calls) == 1
    text, kwargs = speaker.calls[0]
    assert text in tools.FILLERS and kwargs == {"add_to_chat_ctx": False}

    api.check_availability = real  # a fast lookup in the next reply says nothing
    second = turn(state, "s2")
    second.session = speaker
    await agent.check_availability(second, "2026-10-29", "20:00", 2)
    assert len(speaker.calls) == 1


@pytest.mark.parametrize(
    "words",
    [
        "Nothing more, thanks.",
        "No, that's all.",
        "Okay, take care!",
        "I'm all set.",
        "That'll be all, cheers.",
    ],
)
async def test_common_ways_of_saying_goodbye_let_the_agent_hang_up(agent, make_state, words):
    state = make_state()
    ended = []
    state.end_call = ended.append
    spoke(await agent.end_call(with_caller_saying(turn(state, "s9"), words)))
    assert ended


async def test_until_the_settings_are_in_the_agent_lets_the_caller_talk_without_replying(make_state):
    waiting = Receptionist()
    with pytest.raises(StopResponse):
        await waiting.on_user_turn_completed(ChatContext(), None)
    state = make_state()
    await waiting.begin(state)
    await waiting.on_user_turn_completed(ChatContext(), None)  # answers from now on
    assert "The Saffron Table" in waiting.instructions


async def test_facts_in_the_prompt_retire_the_lookup_tools(make_state, api, restaurant):
    from agent.facts import load_facts

    state = make_state()
    agent = Receptionist(state)
    facts = await load_facts(api, restaurant)
    assert facts.all_info and facts.whole_menu  # 18 sample dishes, under one page of 20
    await agent.use_facts(state, facts)
    ids = {t.id for t in agent.tools}
    assert "get_restaurant_info" not in ids and "search_menu" not in ids
    assert {"prepare_booking", "confirm_action", "end_call"} <= ids
    assert "say you don't have that detail and offer to take a message" in agent.instructions
    assert "Paneer Tikka" in agent.instructions

    partial = Receptionist(state)
    facts.whole_menu = False  # a longer menu: dishes past the first page need search_menu
    await partial.use_facts(state, facts)
    assert "search_menu" in {t.id for t in partial.tools}
    assert "use search_menu before saying you don't know" in partial.instructions


async def test_the_llm_sees_only_the_recent_conversation(agent, monkeypatch):
    from livekit.agents import Agent

    import agent.tools as tools

    seen = []

    async def fake_llm_node(self, chat_ctx, tools_, model_settings):
        seen.append(chat_ctx)
        yield "Sure."

    monkeypatch.setattr(Agent.default, "llm_node", fake_llm_node)
    history = ChatContext()
    history.add_message(role="system", content="You are the receptionist.")
    for i in range(40):
        history.add_message(role="user" if i % 2 == 0 else "assistant", content=f"line {i}")
    async for _ in agent.llm_node(history, [], None):
        pass
    sent = seen[0].items
    assert sent[0].role == "system"  # the instructions always go
    assert len(sent) == tools.MAX_HISTORY_ITEMS + 1 and sent[-1].text_content == "line 39"
    assert len(history.items) == 41  # the session's own history is untouched
