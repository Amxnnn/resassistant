"""One text chat with a guest, from the first message to goodbye.

It's the phone receptionist in a text-only AgentSession: the same Receptionist, tools, booking
rules and facts, with the chat prompt and CallState.chat set. Lines the tools say become messages,
so a read-back or a booking code reaches the guest exactly as the tool wrote it. When the chat ends
it's logged like a call, under its own call id.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

from livekit.agents import AgentSession, ConversationItemAddedEvent, llm
from livekit.agents.voice.run_result import RunResult
from livekit.agents.voice.speech_handle import SpeechHandle

from agent.api_client import ApiError, RestaurantAPI
from agent.api_client.models import MenuItem, RestaurantSettings
from agent.call_log import build_call_log, save_call_log
from agent.facts import MENU_LIMIT, load_facts
from agent.main import build_llm
from agent.metrics import LatencyTracker
from agent.prompts import build_chat_greeting
from agent.tools import CallState, Receptionist, new_call_id

logger = logging.getLogger("agent.chat")

SORRY = "Sorry, something went wrong on my side. Could you send that again?"

# A tapped bot command, in the guest's words: the LLM takes it from there. /start and /menu are
# answered without the LLM.
COMMANDS = {
    "/mybookings": "What bookings do I have?",
    "/staff": "I'd like to leave a message for the staff.",
}
MENU_ASKED = "Can I see the menu?"
# What the LLM sees in place of the menu it sent: the whole menu is already in its prompt, and
# every request resends the history.
MENU_SENT = "Here's our full menu."
CURRENCY = {"INR": "₹", "USD": "$", "EUR": "€", "GBP": "£"}


@dataclass
class Reply:
    lines: list[str]  # messages for the guest, in order
    ended: bool = False  # the guest said goodbye: this conversation is over


class Conversation:
    """Create with Conversation.open(); one reply() at a time; close() when the chat is over."""

    def __init__(
        self,
        session: AgentSession[CallState],
        agent: Receptionist,
        state: CallState,
        latency: LatencyTracker,
        session_llm: llm.LLM,
        *,
        channel: Literal["telegram"] | None,
    ) -> None:
        self._session = session
        self._agent = agent
        self._state = state
        self._latency = latency
        self._llm = session_llm
        self._channel = channel
        self._started_at = datetime.now(UTC)
        self._unsent: list[str] = []  # the greeting, until the first reply carries it
        self._ended = False
        self._closed = False
        self.last_run: RunResult | None = None  # the latest LLM turn, for tests to inspect
        state.end_call = self._goodbye_said

    @classmethod
    async def open(
        cls,
        api: RestaurantAPI,
        restaurant_phone: str,
        *,
        channel: Literal["telegram"] | None,
        phone: str | None = None,
        session_llm: llm.LLM | None = None,
    ) -> Conversation:
        """Load the restaurant, start the session and greet. Raises ApiError if the restaurant can't
        be loaded.

        `phone` is the guest's own number, if their chat app shared it. `channel` None (the terminal)
        saves no log.
        """
        restaurant = await api.get_restaurant_by_number(restaurant_phone)
        state = CallState(
            api=api, restaurant=restaurant, call_id=new_call_id(), caller_phone=phone, chat=True
        )
        if session_llm is None:
            session_llm, label = build_llm()
        else:
            label = session_llm.model
        # No audio, so nothing to time out on: a chat that goes quiet is closed by Chats instead.
        session = AgentSession[CallState](
            llm=session_llm, userdata=state, max_tool_steps=3, user_away_timeout=None
        )
        agent = Receptionist(state)
        latency = LatencyTracker(llm_model=label)
        latency.attach(session)
        await session.start(agent)
        # Before the first reply: unlike a call, there's no greeting playing to load them behind.
        if facts := await load_facts(api, restaurant):
            await agent.use_facts(state, facts)
        conversation = cls(session, agent, state, latency, session_llm, channel=channel)
        await session.say(conversation.greeting)  # into the history and the transcript
        conversation._unsent = [conversation.greeting]
        logger.info("chat started | %s | %s", state.call_id, restaurant.name)
        return conversation

    @property
    def greeting(self) -> str:
        return build_chat_greeting(self._state.restaurant)

    @property
    def call_id(self) -> str:
        return self._state.call_id

    @property
    def phone(self) -> str | None:
        return self._state.caller_phone

    async def know_phone(self, phone: str) -> None:
        """The guest shared their own number: bookings use it, and nobody asks for it again."""
        if self._state.caller_phone == phone:
            return
        self._state.caller_phone = phone
        await self._agent.refresh_instructions(self._state)

    async def reply(self, text: str) -> Reply:
        """The messages that answer the guest's text, after the greeting if it hasn't gone out yet."""
        unsent, self._unsent = self._unsent, []
        text = text.strip()
        if text in ("", "/start"):
            return Reply(unsent or [self.greeting])
        if text == "/menu":
            return Reply([*unsent, await self._menu()])
        said: list[str] = []

        def collect(ev: ConversationItemAddedEvent) -> None:
            if isinstance(ev.item, llm.ChatMessage) and ev.item.role == "assistant" and ev.item.text_content:
                said.append(ev.item.text_content)

        self._session.on("conversation_item_added", collect)
        try:
            self.last_run = await self._session.run(user_input=COMMANDS.get(text, text))
        except Exception:
            logger.exception("chat turn failed | %s", self.call_id)
            if not said:
                said.append(SORRY)
        finally:
            self._session.off("conversation_item_added", collect)
        return Reply([*unsent, *said], ended=self._ended)

    async def _menu(self) -> str:
        s = self._state
        try:
            result = await s.api.search_menu(s.restaurant.id, limit=MENU_LIMIT)
        except ApiError as e:
            return e.say
        menu = format_menu(s.restaurant, result.items, more=len(result.items) >= MENU_LIMIT)
        self._latency.add_unmeasured(llm.ChatMessage(role="user", content=[MENU_ASKED]))
        self._latency.add_unmeasured(llm.ChatMessage(role="assistant", content=[menu]))
        history = self._agent.chat_ctx.copy()
        history.add_message(role="user", content=MENU_ASKED)
        history.add_message(role="assistant", content=MENU_SENT)
        await self._agent.update_chat_ctx(history)
        return menu

    def _goodbye_said(self, _speech: SpeechHandle) -> None:
        """end_call's hang-up, for a chat: the conversation ends once its goodbye is sent."""
        self._ended = True

    async def close(self) -> None:
        """End the chat and save its log, if the guest wrote anything. Safe to call twice."""
        if self._closed:
            return
        self._closed = True
        try:
            await self._session.aclose()
        finally:
            await self._llm.aclose()
        s = self._state
        caller_spoke = any(t.speaker == "caller" for t in self._latency.turns)
        logger.info("chat ended | %s | %s", s.call_id, s.outcome(caller_spoke=caller_spoke))
        for usage in self._session.usage.model_usage:
            if getattr(usage, "type", "") == "llm_usage":
                logger.info(
                    "llm usage | %s %s | input %d tokens, output %d tokens",
                    usage.provider,
                    usage.model,
                    usage.input_tokens,
                    usage.output_tokens,
                )
        if self._channel is None or not caller_spoke:  # the terminal, or a chat opened and left at once
            return
        log = build_call_log(
            s,
            self._latency,
            channel=self._channel,
            dialed_number=None,
            started_at=self._started_at,
            ended_at=datetime.now(UTC),
        )
        await save_call_log(s, log)


def _price(item: MenuItem) -> str:
    symbol = CURRENCY.get(item.currency)
    return f"{symbol}{item.price:g}" if symbol else f"{item.price:g} {item.currency}"


def _dish_line(item: MenuItem) -> str:
    about = [t.replace("_", " ") for t in item.dietary_tags]
    if item.spice_level and item.spice_level != "none":
        about.append(f"{item.spice_level} spicy")
    line = f"- {item.name}, {_price(item)}" + (f" ({', '.join(about)})" if about else "")
    # Spelled out either way: a dish that says nothing about allergens reads the same as one whose
    # allergens nobody has entered.
    if not item.allergens_listed:
        line += ". Allergen details not listed"
    elif item.allergens:
        line += f". Contains {', '.join(item.allergens)}"
    else:
        line += ". No listed allergens"
    return line + (". Not available today." if not item.available_today else ".")


def format_menu(restaurant: RestaurantSettings, items: list[MenuItem], *, more: bool = False) -> str:
    """The whole menu as one message, by category, straight from the restaurant's data.

    Allergens are listed as the kitchen entered them, and "not listed" where it hasn't: the same
    rule as the agent, which never fills a gap with a guess.
    """
    if not items:
        return "Sorry, I couldn't load the menu just now. Ask me about any dish instead."
    by_category: dict[str, list[MenuItem]] = {}
    for item in items:
        by_category.setdefault(item.category, []).append(item)
    lines = [f"{restaurant.name} menu"]
    for category, dishes in by_category.items():
        lines += ["", category, *(_dish_line(d) for d in dishes)]
    if more:
        lines += ["", "There's more: ask me about any dish."]
    lines += ["", "With a serious allergy, please confirm with our staff when you arrive."]
    return "\n".join(lines)
