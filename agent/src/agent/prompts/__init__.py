"""System prompt and greeting. One template file per language, filled per call."""

from __future__ import annotations

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


def build_instructions(restaurant: RestaurantSettings, *, caller_id_known: bool, language: str = "en") -> str:
    template = (_TEMPLATES / f"receptionist_{language}.md").read_text(encoding="utf-8")
    now = restaurant.now
    phone_rule = (
        ". You already have their number from the phone line, so don't ask for it."
        if caller_id_known
        else ", and their phone number."
    )
    return template.format(
        restaurant_name=restaurant.name,
        now=f"{now:%A} {now.day} {now:%B %Y}, {speak_time(now)}",
        calendar=_calendar_lines(restaurant),
        address=restaurant.address,
        hours=restaurant.hours_summary,
        party_limit=restaurant.phone_party_limit,
        phone_rule=phone_rule,
    )


def build_greeting(restaurant: RestaurantSettings) -> str:
    """Opening line: who we are, that this is an AI, how to reach staff, and the recording notice."""
    parts = [
        restaurant.greeting,
        # Staff can't take calls in this test build, so the route to a person is a message.
        "I'm the restaurant's AI assistant, and I can pass a message to our staff at any time.",
    ]
    if restaurant.recording_enabled:
        parts.append("This call is recorded to help us improve.")
    parts.append("How can I help?")
    return " ".join(parts)
