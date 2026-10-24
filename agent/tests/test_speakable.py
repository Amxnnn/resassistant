from datetime import date, time

import pytest

from agent.speakable import (
    normalize_phone,
    space_out_long_numbers,
    speak_day,
    speak_numbers_digit_by_digit,
    speak_phone,
    speak_time,
    spell_code,
)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("98765 43210", "+919876543210"),
        ("098765-43210", "+919876543210"),
        ("+91 98765 43210", "+919876543210"),
        ("+1 202 555 0147", "+12025550147"),
        ("12345", None),
    ],
)
def test_normalize_phone_assumes_india_without_a_country_code(raw, expected):
    assert normalize_phone(raw) == expected


def test_phone_numbers_are_spaced_so_tts_reads_single_digits():
    assert speak_phone("+919876543210") == "9 8 7 6 5, 4 3 2 1 0"
    assert speak_phone("+12025550147") == "2 0 2, 5 5 5, 0 1 4 7"


def test_times_days_and_codes_read_naturally():
    assert speak_time(time(19, 30)) == "7:30 PM"
    assert speak_time(time(12)) == "12 PM"
    today = date(2026, 10, 24)
    assert speak_day(today, today) == "today"
    assert speak_day(date(2026, 10, 25), today) == "tomorrow"
    assert speak_day(date(2026, 10, 31), today) == "Saturday 31 October"
    assert spell_code("k7q2") == "K, 7, Q, 2"


@pytest.mark.parametrize(
    ("text", "spoken"),
    [
        ("phone 9876543210. Is that right?", "phone 9 8 7 6 5, 4 3 2 1 0. Is that right?"),
        ("phone 98765 33333?", "phone 9 8 7 6 5, 3 3 3 3 3?"),
        ("call +1 202-555-0147", "call 1, 2 0 2, 5 5 5, 0 1 4 7"),
        ("That's 350 rupees at 8:15 PM in 2026.", "That's 350 rupees at 8:15 PM in 2026."),
    ],
)
def test_long_numbers_are_spaced_for_the_voice(text, spoken):
    assert space_out_long_numbers(text) == spoken


async def test_numbers_split_across_streamed_chunks_are_still_spaced():
    async def chunks():
        for c in ["Your number is 987", "65 4", "3210, right?"]:
            yield c

    out = "".join([c async for c in speak_numbers_digit_by_digit(chunks())])
    assert out == "Your number is 9 8 7 6 5, 4 3 2 1 0, right?"
