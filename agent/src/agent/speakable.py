"""Text written for the ear: times, days, phone numbers and booking codes as a voice should say them."""

from __future__ import annotations

import re
from collections.abc import AsyncIterable, AsyncIterator
from datetime import date, datetime, time, timedelta


def speak_time(t: datetime | time) -> str:
    """7:30 PM, 7 PM, 12 PM."""
    hour = t.hour % 12 or 12
    minutes = f":{t.minute:02d}" if t.minute else ""
    return f"{hour}{minutes} {'AM' if t.hour < 12 else 'PM'}"


def speak_day(d: date, today: date) -> str:
    """today, tomorrow, or Saturday 7 November."""
    if d == today:
        return "today"
    if d == today + timedelta(days=1):
        return "tomorrow"
    return f"{d:%A} {d.day} {d:%B}"


def normalize_phone(raw: str, default_country_code: str = "91") -> str | None:
    """A spoken or typed number as E.164, assuming India when no country code is given."""
    digits = re.sub(r"\D", "", raw)
    if raw.strip().startswith("+"):
        return f"+{digits}" if 8 <= len(digits) <= 15 else None
    if len(digits) == 10:
        return f"+{default_country_code}{digits}"
    if len(digits) == 11 and digits.startswith("0"):
        return f"+{default_country_code}{digits[1:]}"
    if 11 <= len(digits) <= 15:
        return f"+{digits}"
    return None


def speak_phone(e164: str) -> str:
    """Digits spaced out in small groups, so TTS reads them one by one: 9 8 7 6 5, 4 3 2 1 0."""
    digits = e164.lstrip("+")
    if digits.startswith("91") and len(digits) == 12:
        groups = [digits[2:7], digits[7:]]
    elif digits.startswith("1") and len(digits) == 11:
        groups = [digits[1:4], digits[4:7], digits[7:]]
    else:
        groups = [digits[i : i + 3] for i in range(0, len(digits), 3)]
    return ", ".join(" ".join(g) for g in groups)


def spell_code(code: str) -> str:
    """K7Q2 -> K, 7, Q, 2."""
    return ", ".join(code.upper())


_LONG_NUMBER = re.compile(r"\+?\d[\d \-]{5,}\d")
_PENDING_NUMBER = re.compile(r"\+?[\d \-]*$")


def _spaced(match: re.Match[str]) -> str:
    text = match.group(0)
    groups = [g for g in re.split(r"[ \-]+", text.lstrip("+")) if g]
    digits = "".join(groups)
    if len(digits) < 7:  # prices, times, years: leave alone
        return text
    if len(groups) == 1 and len(digits) == 10:  # 9876543210 -> 98765 43210
        groups = [digits[:5], digits[5:]]
    return ", ".join(" ".join(g) for g in groups)


def space_out_long_numbers(text: str) -> str:
    """Phone numbers digit by digit, whatever form the LLM wrote them in."""
    return _LONG_NUMBER.sub(_spaced, text)


async def speak_numbers_digit_by_digit(chunks: AsyncIterable[str]) -> AsyncIterator[str]:
    """TTS text transform: like space_out_long_numbers, for text that arrives in streamed chunks.

    A number split across chunks ("98765" then " 43210") is held back until it's complete.
    """
    buffer = ""
    async for chunk in chunks:
        buffer += chunk
        pending = _PENDING_NUMBER.search(buffer)
        cut = pending.start() if pending and pending.group(0).strip() else len(buffer)
        if cut:
            yield space_out_long_numbers(buffer[:cut])
            buffer = buffer[cut:]
    if buffer:
        yield space_out_long_numbers(buffer)
