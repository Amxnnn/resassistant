"""Turn-taking tuned to what the agent just asked.

Callers pause while reading out a phone number ("98765 ... 43210"). After the agent asks for a
number, the session waits longer before deciding the caller has finished; once the caller has
answered, it goes back to the quick default, so every other reply stays fast.
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
TAKING_DIGITS = EndpointingOptions(min_delay=1.0, max_delay=4.0)

_ASKS_FOR_NUMBER = re.compile(r"\b(phone )?number\b", re.IGNORECASE)
_HAS_DIGITS = re.compile(r"\d(?:\D?\d){4}")  # a read-back already holds the number
_SENTENCE_END = re.compile(r"(?<=[.!?])\s+")


def asks_for_a_number(agent_text: str) -> bool:
    # The last sentence is the question. "I only caught 1 2 3, 4 5 6. Could you say the whole number
    # again?" asks for one; "...your number is 9 8 7 6 5, 4 3 2 1 0. Shall I book it?" doesn't.
    question = _SENTENCE_END.split(agent_text.strip())[-1]
    return bool(_ASKS_FOR_NUMBER.search(question)) and not _HAS_DIGITS.search(question)


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
            self._use(TAKING_DIGITS if asks_for_a_number(item.text_content or "") else QUICK)
        elif item.role == "user":
            self._use(QUICK)

    def _use(self, options: EndpointingOptions) -> None:
        if options != self._current:
            self._session.update_options(endpointing_opts=options)
            self._current = options
            logger.debug("endpointing now %s", options)
