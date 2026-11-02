"""System prompt and greeting. One template file per language, filled per call.

Text chats have their own template per language (receptionist_chat_<language>.md): the same rules,
written for messages instead of speech.
"""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

from agent.api_client.models import RestaurantSettings
from agent.speakable import speak_time

_TEMPLATES = Path(__file__).parent
# Days of the API calendar put in the prompt: enough for "next Saturday", short enough to keep
# every request small (the free LLM tiers limit tokens per minute).
CALENDAR_DAYS = 8


def _calendar_lines(restaurant: RestaurantSettings) -> str:
    lines = []
    for i, day in enumerate(restaurant.calendar[:CALENDAR_DAYS]):
        label = " (today)" if i == 0 else " (tomorrow)" if i == 1 else ""
        status = f"open {day.hours}" if day.open else (day.note or "closed")
        lines.append(f"- {day.weekday} {day.date.isoformat()}{label}: {status}")
    return "\n".join(lines)


NO_FACTS_YET = "Not loaded yet."
# The tools that look up what the facts would hold. Once the facts are in the prompt they're dropped,
# unless the facts are incomplete (Receptionist.use_facts).
LOOKUP_TOOLS = ("get_restaurant_info", "search_menu")


def _lookup_rule(lookups: Sequence[str]) -> str:
    if not lookups:
        return "If they don't cover it, say you don't have that detail and offer to take a message."
    return f"If they don't cover it, use {' or '.join(lookups)} before saying you don't know."


def build_instructions(
    restaurant: RestaurantSettings,
    *,
    caller_id_known: bool,
    facts: str | None = None,
    lookups: Sequence[str] = LOOKUP_TOOLS,
    language: str = "en",
    chat: bool = False,
) -> str:
    name = f"receptionist_chat_{language}.md" if chat else f"receptionist_{language}.md"
    template = (_TEMPLATES / name).read_text(encoding="utf-8")
    now = restaurant.now
    phone_rule = ""
    if caller_id_known:
        source = "They shared their number with you" if chat else "You have their number from the phone line"
        phone_rule = f" {source}, so never ask for it."
    return template.format(
        restaurant_name=restaurant.name,
        now=f"{now:%A} {now.day} {now:%B %Y}, {speak_time(now)}",
        calendar=_calendar_lines(restaurant),
        address=restaurant.address,
        hours=restaurant.hours_summary,
        party_limit=restaurant.phone_party_limit,
        phone_rule=phone_rule,
        lookup=_lookup_rule(lookups),
        facts=facts or NO_FACTS_YET,
    )


def build_greeting(restaurant: RestaurantSettings) -> str:
    """Opening line: who we are, that this is an AI, how to reach staff, and the recording notice.

    As short as the required points allow: the caller waits through every word of it.
    """
    parts = [
        restaurant.greeting,
        # Staff can't take calls in this test build, so the route to a person is a message.
        "I'm the AI assistant, and I can pass a message to our staff anytime.",
    ]
    if restaurant.recording_enabled:
        parts.append("This call is recorded for quality.")
    parts.append("How can I help?")
    return " ".join(parts)


def build_chat_greeting(restaurant: RestaurantSettings) -> str:
    """A chat's first message: who we are, that this is an AI, how to reach staff, and that chats are kept.

    The restaurant's own greeting is written for a phone call ("Thanks for calling"), so a chat
    gets its own. The transcript is saved like a call's, so the notice is always given.
    """
    return (
        f"Hi, welcome to {restaurant.name}! I'm the AI assistant. I can book a table, answer questions "
        "about the menu and opening hours, or pass a message to our staff. Chats are saved so our team "
        "can follow up. How can I help?"
    )
