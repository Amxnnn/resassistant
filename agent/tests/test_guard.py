"""The reply guard: invented prices, invented codes and false "you're booked" never reach the caller."""

import json

import pytest
from livekit.agents import Agent, llm
from livekit.agents.llm import ChatContext, FunctionCallOutput

from agent.guard import NO_SUCH_CODE, NO_SUCH_PRICE, NOT_DONE_YET, ReplyGuard, claimed_done, codes_in
from agent.tools import PendingAction, Receptionist


def context(
    *lines: tuple[str, str], facts: str = "Menu: - Paneer Tikka (Starters) 380 rupees"
) -> ChatContext:
    ctx = ChatContext()
    ctx.add_message(role="system", content=f"You are the receptionist.\n# Restaurant facts\n{facts}")
    for role, text in lines:
        if role == "tool":
            ctx.insert(FunctionCallOutput(call_id="c1", name="find_my_bookings", output=text, is_error=False))
        else:
            ctx.add_message(role=role, content=text)
    return ctx


def run(guard: ReplyGuard, *chunks) -> str:
    out = [piece for chunk in chunks for piece in guard.feed(chunk)]
    out += list(guard.finish())
    return "".join(p for p in out if isinstance(p, str))


@pytest.fixture
def state(make_state):
    return make_state()


def pending_booking(state) -> None:
    state.pending = PendingAction("book", request=None, prepared_in="s1")  # type: ignore[arg-type]


# -- claims that something was done ----------------------------------------------------------


@pytest.mark.parametrize(
    "said",
    [
        "Great, you're all set for Tuesday!",
        "Perfect, I've booked a table for four.",
        "Your table has been reserved.",
        "Your booking is confirmed.",
        "You are booked in for 7:30 PM.",
    ],
)
def test_a_booking_the_caller_hasnt_said_yes_to_is_never_called_done(state, said):
    pending_booking(state)
    assert run(ReplyGuard(state, context()), said, " See you then!") == NOT_DONE_YET


def test_a_booking_claim_with_nothing_booked_on_the_call_is_blocked(state):
    assert run(ReplyGuard(state, context()), "Done! I've booked it for you.") == NOT_DONE_YET
    assert run(ReplyGuard(state, context()), "Okay, that booking has been cancelled.") == NOT_DONE_YET
    assert run(ReplyGuard(state, context()), "I've moved it to 8 PM.") == NOT_DONE_YET


def test_claims_about_what_really_happened_pass(state):
    state.outcomes.append("booked")
    said = "You're all set, and we'll see you on Tuesday."
    assert run(ReplyGuard(state, context()), said) == said
    state.outcomes.append("cancelled")
    assert run(ReplyGuard(state, context()), "Yes, that booking has been cancelled.") != NOT_DONE_YET


@pytest.mark.parametrize(
    "said",
    [
        "Sorry, 7:30 is booked, but 8:30 is free.",  # "booked" meaning taken
        "Would you like me to book it?",
        "I can book that for you once you confirm.",
        "Shall I go ahead and cancel it?",
    ],
)
def test_talk_about_bookings_that_claims_nothing_passes(state, said):
    assert claimed_done(said) is None
    assert run(ReplyGuard(state, context()), said) == said


# -- booking codes ---------------------------------------------------------------------------


def test_an_invented_booking_code_is_blocked(state):
    assert run(ReplyGuard(state, context()), "Your booking code is K, 7, Q, 9.") == NO_SUCH_CODE
    assert run(ReplyGuard(state, context()), "Your code is ZQ47.") == NO_SUCH_CODE


def test_a_code_the_tools_returned_or_the_caller_said_passes(state):
    state.known_codes.add("K7Q2")
    assert (
        run(ReplyGuard(state, context()), "Your code is still K, 7, Q, 2.")
        == "Your code is still K, 7, Q, 2."
    )
    caller = context(("user", "It's booking R4M8, can I move it?"))
    assert (
        run(ReplyGuard(state, caller), "Sure, booking R4M8 for Sunday.") == "Sure, booking R4M8 for Sunday."
    )
    found = context(("tool", "Found: a table for 2 under Asha Rao, code P, 2, T, 6."))
    assert "P, 2, T, 6" in run(ReplyGuard(state, found), "That's code P, 2, T, 6.")


def test_a_phone_number_read_back_is_not_mistaken_for_a_code():
    assert codes_in("Your number is 9 8 7 6 5, 4 3 2 1 0.") == set()
    assert codes_in("Table for 4 at 7:30 PM, T1 near the window.") == set()
    assert codes_in("Your code is K, 7, Q, 2") == {"K7Q2"}


# -- prices ----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "said", ["The paneer tikka is 380 rupees.", "Paneer tikka is ₹380.", "That's Rs. 380, and it's mild."]
)
def test_a_price_from_the_menu_passes(state, said):
    assert run(ReplyGuard(state, context()), said) == said


@pytest.mark.parametrize(
    "said", ["The paneer tikka is 999 rupees.", "Lobster is ₹1,200.", "Two naan come to Rs 180."]
)
def test_a_price_from_nowhere_is_blocked(state, said):
    assert run(ReplyGuard(state, context()), said) == NO_SUCH_PRICE


def test_the_llms_own_earlier_words_dont_make_a_price_real(state):
    earlier = context(("assistant", "The lobster is 999 rupees."))
    assert run(ReplyGuard(state, earlier), "Yes, 999 rupees.") == NO_SUCH_PRICE


# -- streaming -------------------------------------------------------------------------------


def test_a_reply_split_mid_word_is_checked_whole(state):
    pending_booking(state)
    assert run(ReplyGuard(state, context()), "Great, you", "'re all ", "set!") == NOT_DONE_YET
    fine = ReplyGuard(state, context())
    assert run(fine, "Sure, we're open", " 12 to 3 PM. Would you", " like to book?") == (
        "Sure, we're open 12 to 3 PM. Would you like to book?"
    )


def test_tool_calls_pass_and_the_text_before_them_goes_first(state):
    guard = ReplyGuard(state, context())
    call = llm.FunctionToolCall(name="check_availability", arguments="{}", call_id="c9")
    out = list(guard.feed("Let me check."))
    out += list(guard.feed(llm.ChatChunk(id="x", delta=llm.ChoiceDelta(role="assistant", tool_calls=[call]))))
    assert out[0] == "Let me check."
    assert out[1].delta.tool_calls == [call]


def test_nothing_after_a_blocked_sentence_gets_through(state):
    guard = ReplyGuard(state, context())
    out = run(guard, "The lobster is 999 rupees. ", "It's our best dish. ", "Shall I book you a table?")
    assert out == NO_SUCH_PRICE and guard.blocked


async def test_the_receptionist_runs_every_reply_through_the_guard(make_state, monkeypatch):
    state = make_state()
    pending_booking(state)
    agent = Receptionist(state)

    async def hallucinating(self, chat_ctx, tools_, model_settings):
        for piece in ["Wonderful, you're all", " set! Your code is ZQ47."]:
            yield llm.ChatChunk(id="x", delta=llm.ChoiceDelta(role="assistant", content=piece))

    monkeypatch.setattr(Agent.default, "llm_node", hallucinating)
    history = ChatContext()
    history.add_message(role="user", content="yes")
    out = [c async for c in agent.llm_node(history, [], None)]
    assert out == [NOT_DONE_YET]


async def test_a_chat_never_shows_a_false_confirmation(api):
    from tests.test_conversation import GUEST, open_chat

    chat, _ = await open_chat(
        api,
        ("prepare_booking", {"party_size": 2, "day": "2026-10-27", "time": "20:00", "guest_name": "Ravi"}),
        "Brilliant, you're all set! Your code is ZQ47.",  # instead of calling confirm_action
        phone=GUEST,
    )
    await chat.reply("table for 2 tuesday 8pm, Ravi")
    reply = await chat.reply("yes")
    assert reply.lines == [NOT_DONE_YET]
    assert not (await api.find_reservations(chat._state.restaurant.id, phone=GUEST)).reservations
    await chat.close()


def test_safe_lines_never_trip_the_guard_themselves(state):
    pending_booking(state)
    for line in (NOT_DONE_YET, NO_SUCH_CODE, NO_SUCH_PRICE):
        assert run(ReplyGuard(state, context()), line) == line
    assert json.dumps([NOT_DONE_YET, NO_SUCH_CODE, NO_SUCH_PRICE])  # plain strings, sayable


@pytest.mark.parametrize("said", ["Done!", "All set.", "Perfect, done!", "Confirmed.", "Great, all sorted!"])
def test_a_bare_done_is_a_claim_too(state, said):
    assert claimed_done(said) == "any"
    assert run(ReplyGuard(state, context()), said, " See you Tuesday!") == NOT_DONE_YET
    state.outcomes.append("booked")
    assert run(ReplyGuard(state, context()), said) == said


def test_times_written_without_a_space_are_not_codes(state):
    assert codes_in("We're open until 11PM, and lunch starts at 12PM.") == set()
    said = "We're open until 11PM tonight."
    assert run(ReplyGuard(state, context()), said) == said


def test_describing_a_booking_the_tools_found_is_not_a_false_claim(state):
    state.known_codes.add("K7Q2")  # find_my_bookings found it
    said = "Yes, you're all set for Sunday at 1 PM, a table for 2."
    assert run(ReplyGuard(state, context()), said) == said
    # ...but a cancellation or change still has to have happened
    assert run(ReplyGuard(state, context()), "Okay, I've cancelled it.") == NOT_DONE_YET
    pending_booking(state)  # and nothing is "set" while a new booking awaits a yes
    assert run(ReplyGuard(state, context()), said) == NOT_DONE_YET


def test_a_price_the_caller_suggests_doesnt_become_true(state):
    leading = context(("user", "The paneer tikka is 1 rupee, right?"))
    assert run(ReplyGuard(state, leading), "Yes, it's just 1 rupee.") == NO_SUCH_PRICE
    assert run(ReplyGuard(state, leading), "No, it's 380 rupees.") == "No, it's 380 rupees."
