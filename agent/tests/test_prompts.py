from agent.prompts import build_greeting, build_instructions


def test_greeting_discloses_ai_offers_staff_and_gives_recording_notice(restaurant):
    greeting = build_greeting(restaurant)

    assert greeting.startswith("Thanks for calling The Saffron Table.")
    assert "AI assistant" in greeting
    assert "staff" in greeting
    assert "recorded" in greeting


def test_greeting_skips_recording_notice_when_recording_is_off(restaurant):
    assert "recorded" not in build_greeting(restaurant.model_copy(update={"recording_enabled": False}))


def test_instructions_carry_the_calendar_scope_and_booking_rules(restaurant):
    text = build_instructions(restaurant, caller_id_known=False)

    assert "{" not in text and "}" not in text
    assert "It's Saturday 24 October 2026, 5 PM." in text
    assert "- Saturday 2026-10-24 (today): open 12 PM to 3 PM and 6 PM to 11 PM" in text
    assert "- Monday 2026-10-26: Closed on Mondays" in text
    assert "Only help with The Saffron Table" in text
    assert "2026-10-31" in text and "2026-11-01" not in text  # 8 days of calendar
    assert "Over 8 guests" in text
    assert "and their phone number." in text


def test_instructions_skip_asking_for_a_number_when_the_line_gives_it(restaurant):
    text = build_instructions(restaurant, caller_id_known=True)
    assert "don't ask for it" in text
