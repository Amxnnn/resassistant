from livekit.agents.llm import ChatMessage

from agent.turn_taking import QUICK, TAKING_DIGITS, TurnTaking, asks_for_a_number


class FakeSession:
    def __init__(self) -> None:
        self.handlers = {}
        self.options = []

    def on(self, event, handler):
        self.handlers[event] = handler

    def update_options(self, **kwargs):
        self.options.append(kwargs["endpointing_opts"])

    def say_and_hear(self, role: str, text: str) -> None:
        from types import SimpleNamespace

        self.handlers["conversation_item_added"](SimpleNamespace(item=ChatMessage(role=role, content=[text])))


def test_asking_for_a_number_is_told_apart_from_reading_one_back():
    assert asks_for_a_number("Could I get your name and phone number, please?")
    assert asks_for_a_number("What's the best number to reach you on?")
    assert not asks_for_a_number("A table for 2 under Ravi, phone 9 8 7 6 5, 4 3 2 1 0. Is that right?")
    assert not asks_for_a_number("We're open six to eleven tonight. Anything else?")
    # Asking again after a short number: the digits heard come first, the question last.
    assert asks_for_a_number(
        "Sorry, I only caught 9 digits: 1 2 3, 4 5 6, 7 8 9. Could you say the whole number again?"
    )


def test_the_agent_waits_longer_only_while_the_caller_reads_out_a_number():
    session = FakeSession()
    TurnTaking(session).attach()

    session.say_and_hear("assistant", "We're open until eleven. Anything else?")
    assert session.options == []  # already quick: nothing to change

    session.say_and_hear("assistant", "Can I get your phone number?")
    assert session.options == [TAKING_DIGITS]

    session.say_and_hear("user", "Sure, it's 98765 43210.")
    assert session.options == [TAKING_DIGITS, QUICK]

    session.say_and_hear("assistant", "Phone 9 8 7 6 5, 4 3 2 1 0, is that right?")
    assert session.options == [TAKING_DIGITS, QUICK]


def test_a_name_day_time_or_party_size_gets_a_little_longer_than_a_quick_reply():
    from agent.tools import ASK
    from agent.turn_taking import TAKING_DETAIL, endpointing_after

    for detail in ("party_size", "day_and_time", "day", "name"):
        for line in ASK[detail]:
            assert endpointing_after(line) == TAKING_DETAIL, line
    assert endpointing_after(ASK["time"][0].format(day="on Tuesday")) == TAKING_DETAIL
    assert (
        endpointing_after("Good news, it's free. What name should I put the booking under?") == TAKING_DETAIL
    )
    assert endpointing_after("When would you like to come in?") == TAKING_DETAIL
    # The number still waits longest; anything else stays quick.
    assert endpointing_after(ASK["phone"][0]) == TAKING_DIGITS
    assert endpointing_after("We're open six to eleven tonight. Anything else?") == QUICK
    # A read-back mentions the name and the time, but its question is a yes or no.
    assert (
        endpointing_after("Just to confirm: a table for 4 under Asha, Tuesday at 7:30 PM. Shall I book it?")
        == QUICK
    )
    assert QUICK["min_delay"] < TAKING_DETAIL["min_delay"] < TAKING_DIGITS["min_delay"]
