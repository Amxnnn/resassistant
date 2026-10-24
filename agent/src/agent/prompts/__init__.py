"""System prompt and greeting. One template file per language, filled per call."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

_TEMPLATES = Path(__file__).parent


def build_instructions(restaurant: dict, now: datetime, language: str = "en") -> str:
    template = (_TEMPLATES / f"receptionist_{language}.md").read_text(encoding="utf-8")
    return template.format(
        restaurant_name=restaurant["name"],
        today=f"{now:%A}, {now.day} {now:%B %Y}",
        time_now=f"{now:%I:%M %p}".lstrip("0"),
        address=restaurant["address"],
        hours=restaurant["hours_summary"],
        policies=" ".join(restaurant["policies"]),
    )


def build_greeting(restaurant: dict) -> str:
    """Opening line: who we are, that this is an AI, how to reach staff, and the recording notice."""
    parts = [
        restaurant["greeting"],
        "I'm the restaurant's AI assistant, and you can ask for a staff member at any time.",
    ]
    if restaurant["recording_enabled"]:
        parts.append("This call is recorded to help us improve.")
    parts.append("How can I help?")
    return " ".join(parts)
