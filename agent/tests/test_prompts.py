from datetime import datetime
from zoneinfo import ZoneInfo

from agent.prompts import build_greeting, build_instructions

RESTAURANT = {
    "name": "The Saffron Table",
    "timezone": "Asia/Kolkata",
    "greeting": "Thanks for calling The Saffron Table.",
    "recording_enabled": True,
    "address": "12 Residency Road.",
    "hours_summary": "Open 6 to 11 PM.",
    "policies": ["Tables are held for 15 minutes.", "Large parties go to the manager."],
}


def test_greeting_discloses_ai_offers_staff_and_gives_recording_notice():
    greeting = build_greeting(RESTAURANT)

    assert greeting.startswith("Thanks for calling The Saffron Table.")
    assert "AI assistant" in greeting
    assert "staff member" in greeting
    assert "recorded" in greeting


def test_greeting_skips_recording_notice_when_recording_is_off():
    assert "recorded" not in build_greeting({**RESTAURANT, "recording_enabled": False})


def test_instructions_fill_every_placeholder_with_restaurant_local_time():
    now = datetime(2026, 11, 7, 19, 5, tzinfo=ZoneInfo("Asia/Kolkata"))
    text = build_instructions(RESTAURANT, now)

    assert "{" not in text and "}" not in text
    assert "The Saffron Table" in text
    assert "Saturday, 7 November 2026" in text
    assert "7:05 PM" in text
    assert "Large parties go to the manager." in text
