from agent.api_client.sample import RESTAURANT_ID
from agent.tools import NOT_CONFIRMED_YET, Receptionist

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
    assert "allergens NOT LISTED" in reply


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
    ctx = turn(state, "s9")
    assert await agent.end_call(ctx) == "Now say a short, warm goodbye."
    assert ended == [ctx.speech_handle]
