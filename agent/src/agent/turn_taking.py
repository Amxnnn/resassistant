"""Turn-taking tuned to what the agent just asked.

Callers pause while reading out a phone number ("98765 ... 43210"), and while they think of a name,
a day or how many are coming ("It's... Priyanka"). After the agent asks for one of those, the
session waits longer before deciding the caller has finished, longest for a number; once the caller
has answered, it goes back to the quick default, so every other reply stays fast.
"""

from __future__ import annotations

import logging
import re

from livekit.agents import AgentSession, ConversationItemAddedEvent, EndpointingOptions
from livekit.agents.llm import ChatMessage

logger = logging.getLogger("agent.turn_taking")

# Seconds of silence after the caller's last word before their turn can end, and the most the
# agent waits when the turn detector thinks they haven't finished.
QUICK = EndpointingOptions(min_delay=0.3, max_delay=2.5)
TAKING_DETAIL = EndpointingOptions(min_delay=0.6, max_delay=3.0)
TAKING_DIGITS = EndpointingOptions(min_delay=1.0, max_delay=4.0)

_ASKS_FOR_NUMBER = re.compile(r"\b(phone )?number\b", re.IGNORECASE)
# The booking details prepare_booking asks for (tools.ASK), and the same questions in the LLM's words.
_ASKS_FOR_DETAIL = re.compile(
    r"\b(name|booking under|how many|which day|what day|what date|which date|what time|day and time"
    r"|when would)\b",
    re.IGNORECASE,
)
_HAS_DIGITS = re.compile(r"\d(?:\D?\d){4}")  # a read-back already holds the number
_SENTENCE_END = re.compile(r"(?<=[.!?])\s+")


def _question(agent_text: str) -> str:
    """The last sentence, which is the question: "I only caught 1 2 3. Could you say it again?"."""
    return _SENTENCE_END.split(agent_text.strip())[-1]


def asks_for_a_number(agent_text: str) -> bool:
    # "Could you say the whole number again?" asks for one; "...your number is 9 8 7 6 5, 4 3 2 1 0.
    # Shall I book it?" doesn't.
    question = _question(agent_text)
    return bool(_ASKS_FOR_NUMBER.search(question)) and not _HAS_DIGITS.search(question)


def asks_for_a_detail(agent_text: str) -> bool:
    """A name, a day or time, or how many people: answers callers often pause in the middle of."""
    return bool(_ASKS_FOR_DETAIL.search(_question(agent_text)))


def endpointing_after(agent_text: str) -> EndpointingOptions:
    if asks_for_a_number(agent_text):
        return TAKING_DIGITS
    return TAKING_DETAIL if asks_for_a_detail(agent_text) else QUICK


class TurnTaking:
    def __init__(self, session: AgentSession) -> None:
        self._session = session
        self._current = QUICK

    def attach(self) -> None:
        self._session.on("conversation_item_added", self._on_item_added)

    def _on_item_added(self, ev: ConversationItemAddedEvent) -> None:
        item = ev.item
        if not isinstance(item, ChatMessage):
            return
        if item.role == "assistant":
            self._use(endpointing_after(item.text_content or ""))
        elif item.role == "user":
            self._use(QUICK)

    def _use(self, options: EndpointingOptions) -> None:
        if options != self._current:
            self._session.update_options(endpointing_opts=options)
            self._current = options
            logger.debug("endpointing now %s", options)
