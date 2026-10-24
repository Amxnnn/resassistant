from datetime import date

import pytest

from agent.api_client.sample import RESTAURANT_ID
from agent.tools import ASK_WHICH_DAY, DAY_TOO_FAR, NOT_CONFIRMED_YET, NOT_DONE_YET, Receptionist, resolve_day

from .conftest import turn


async def test_booking_needs_a_phone_number_when_there_is_no_caller_id(agent, make_state):
    state = make_state()
    reply = await agent.prepare_booking(turn(state, "s1"), "Asha", 4, "2026-10-27", "19:30")
    assert reply == "That time is free. Ask the caller for their full phone number, then prepare it again."
    assert state.pending is None


async def test_booking_is_read_back_and_only_saved_after_a_later_yes(agent, make_state, api):
    state = make_state()
    reply = await agent.prepare_booking(
        turn(state, "s1"), "Asha", 4, "2026-10-27", "19:30", phone_number="98765 43210"
    )
    assert reply == (
        "Not booked yet. Read this back and ask the caller to confirm: a table for 4 under Asha, "
        "Tuesday 27 October at 7:30 PM, phone 9 8 7 6 5, 4 3 2 1 0."
    )

    # Same turn as the prepare: the caller hasn't had a chance to say yes.
    assert await agent.confirm_action(turn(state, "s1")) == NOT_CONFIRMED_YET
    assert not (await api.find_reservations(RESTAURANT_ID, phone="+919876543210")).reservations

    done = await agent.confirm_action(turn(state, "s2"))
    saved = (await api.find_reservations(RESTAURANT_ID, phone="+919876543210")).reservations
    assert len(saved) == 1 and saved[0].guest_name == "Asha" and saved[0].party_size == 4
    assert done.startswith("Done. Table for 4, Tuesday 27 October at 7:30 PM")
    assert ", ".join(saved[0].code) in done
    assert state.pending is None


async def test_caller_id_wins_over_a_number_the_llm_passes(make_state, api):
    state = make_state(caller_phone="+12025550199")
    agent = Receptionist(state)
    reply = await agent.prepare_booking(
        turn(state, "s1"), "Ravi", 2, "2026-10-27", "20:00", phone_number="+911234567890"
    )
    assert "phone" not in reply
    await agent.confirm_action(turn(state, "s2"))
    assert (await api.find_reservations(RESTAURANT_ID, phone="+12025550199")).reservations
    assert not (await api.find_reservations(RESTAURANT_ID, phone="+911234567890")).reservations


async def test_full_slot_offers_alternatives_and_prepares_nothing(agent, make_state):
    state = make_state(caller_phone="+12025550199")
    reply = await agent.prepare_booking(turn(state, "s1"), "Ravi", 4, "2026-10-31", "19:30")
    assert reply.startswith("Sorry, 7:30 PM is taken for 4. I can do 8:30 PM, 8:45 PM or 9 PM.")
    assert "First tell the caller their time is taken" in reply
    assert state.pending is None


async def test_confirm_with_nothing_prepared_does_nothing(agent, make_state):
    assert "nothing to confirm" in await agent.confirm_action(turn(make_state(), "s1"))


async def test_change_and_cancel_an_existing_booking_by_code(agent, make_state, api):
    state = make_state()
    found = await agent.find_my_bookings(turn(state, "s1"), booking_code="k7q2")
    assert "a table for 2 under Asha Rao, Sunday 1 November at 1 PM, code K, 7, Q, 2" in found

    reply = await agent.prepare_change(turn(state, "s1"), "K7Q2", new_time="13:30", new_party_size=3)
    assert reply.endswith("to a table for 3, Sunday 1 November at 1:30 PM.")
    assert "Table for 3, Sunday 1 November at 1:30 PM, code K7Q2." in await agent.confirm_action(
        turn(state, "s2")
    )

    assert "Not cancelled yet" in await agent.prepare_cancel(turn(state, "s3"), "K7Q2")
    assert "is cancelled" in await agent.confirm_action(turn(state, "s4"))
    assert not (await api.find_reservations(RESTAURANT_ID, code="K7Q2")).reservations


async def test_menu_details_flag_missing_allergen_data(agent, make_state):
    reply = await agent.search_menu(turn(make_state(), "s1"), query="aloo gobi")
    assert "Aloo Gobi, 320 rupees, mild spicy." in reply
    assert "NO allergen information" in reply


async def test_large_party_is_steered_to_a_message(agent, make_state, api):
    state = make_state()
    assert "take your details" in await agent.check_availability(turn(state, "s1"), "2026-10-27", "20:00", 12)
    reply = await agent.take_message(
        turn(state, "s2"), "Rohan", "large_party", "Birthday for 12 on Tuesday at 8 PM.", "98765 43210"
    )
    assert reply == "I've passed that to the manager, who will call you back."
    assert api.messages[0].caller_phone == "+919876543210"


async def test_end_call_hands_the_goodbye_speech_to_the_hang_up_logic(agent, make_state):
    state = make_state()
    ended = []
    state.end_call = ended.append
    ctx = with_caller_saying(turn(state, "s9"), "No, that's all. Thanks, bye!")
    assert await agent.end_call(ctx) == "Now say a short, warm goodbye."
    assert ended == [ctx.speech_handle]


async def test_end_call_refuses_to_hang_up_on_a_caller_who_is_still_talking(agent, make_state):
    state = make_state()
    ended = []
    state.end_call = ended.append
    for words in ("What time do you open on Sunday?", "Okay. And is there parking?", "hello"):
        ctx = with_caller_saying(turn(state, "s9"), words)
        assert await agent.end_call(ctx) == NOT_DONE_YET
    assert ended == []


def with_caller_saying(ctx, words: str):
    """Give the stand-in RunContext a session history ending with the caller's words."""
    from types import SimpleNamespace

    from livekit.agents.llm import ChatContext

    history = ChatContext()
    history.add_message(role="assistant", content="Anything else I can help with?")
    history.add_message(role="user", content=words)
    ctx.session = SimpleNamespace(history=history)
    return ctx


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
        turn(asha, "a1"), "Asha", 2, "2026-10-27", "19:30", phone_number="98765 11111"
    )
    await ravi_agent.prepare_booking(
        turn(ravi, "r1"), "Ravi", 4, "2026-10-27", "19:30", phone_number="98765 22222"
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
    await agent.prepare_booking(turn(state, "s1"), "Ravi", 2, "2026-10-27", "20:00")
    assert len(calls) == 1  # one round trip, not two
    await agent.prepare_booking(turn(state, "s1"), "Ravi", 3, "2026-10-27", "20:00")
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
    reply = await agent.prepare_booking(turn(state, "s1"), "Priya", 2, "this Tuesday", "20:15")
    assert reply.startswith("Not booked yet") and "Tuesday 27 October at 8:15 PM" in reply
    assert f"{state.pending.request.start:%Y-%m-%d %H:%M}" == "2026-10-27 20:15"


async def test_changing_the_day_uses_the_callers_words_too(agent, make_state):
    state = make_state()
    reply = await agent.prepare_change(turn(state, "s1"), "K7Q2", new_day="Tuesday")
    assert reply.endswith("to a table for 2, Tuesday 27 October at 1 PM.")
