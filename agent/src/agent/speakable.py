"""Text written for the ear: times, days, phone numbers and booking codes as a voice should say them.

Text chats show the same times and days; only phone numbers and codes are written differently.
"""

from __future__ import annotations

import re
from collections.abc import AsyncIterable, AsyncIterator
from datetime import date, datetime, time, timedelta


def speak_time(t: datetime | time) -> str:
    """7:30 PM, 7 PM, 12 PM."""
    hour = t.hour % 12 or 12
    minutes = f":{t.minute:02d}" if t.minute else ""
    return f"{hour}{minutes} {'AM' if t.hour < 12 else 'PM'}"


def _ordinal(n: int) -> str:
    return f"{n}{'th' if 11 <= n % 100 <= 13 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def speak_day(d: date, today: date) -> str:
    """today, tomorrow, Saturday the 31st, or Friday the 25th of December more than two weeks out.

    Dates the way people say them on the phone, not "Saturday 31 October".
    """
    if d == today:
        return "today"
    if d == today + timedelta(days=1):
        return "tomorrow"
    day = f"{d:%A} the {_ordinal(d.day)}"
    return day if d - today < timedelta(days=14) else f"{day} of {d:%B}"


def on_day(d: date, today: date) -> str:
    """For running speech: "today", "tomorrow", "on Saturday", "on Friday the 25th of December"."""
    if d - today < timedelta(days=2):
        return speak_day(d, today)
    return f"on {d:%A}" if d - today < timedelta(days=7) else f"on {speak_day(d, today)}"


def join_or(items: list[str]) -> str:
    """a; a or b; a, b or c."""
    return items[0] if len(items) == 1 else f"{', '.join(items[:-1])} or {items[-1]}"


_DIGIT_WORDS = {
    "zero": "0", "oh": "0", "o": "0", "one": "1", "two": "2", "three": "3", "four": "4", "five": "5",
    "six": "6", "seven": "7", "eight": "8", "nine": "9", "ten": "10", "eleven": "11", "twelve": "12",
    "thirteen": "13", "fourteen": "14", "fifteen": "15", "sixteen": "16", "seventeen": "17",
    "eighteen": "18", "nineteen": "19",
}  # fmt: skip
_TENS = {
    "twenty": "2", "thirty": "3", "forty": "4", "fifty": "5", "sixty": "6", "seventy": "7",
    "eighty": "8", "ninety": "9",
}  # fmt: skip
_UNITS = {"one", "two", "three", "four", "five", "six", "seven", "eight", "nine"}
_REPEATS = {"double": 2, "triple": 3}


def spoken_digits(text: str) -> str:
    """The digits of a number however it arrived: "98765 43210", "nine eight seven", "double five",
    or in pairs, "ninety eight, seventy six" (how many Indian callers read a number out).

    Speech-to-text often writes a number read out as words, and the LLM doesn't always turn them
    into digits before passing them on.
    """
    digits: list[str] = []
    repeat = 1
    tokens = re.findall(r"\d+|[a-z]+", text.lower())
    i = 0
    while i < len(tokens):
        token = tokens[i]
        i += 1
        if token in _REPEATS:
            repeat = _REPEATS[token]
            continue
        if token in _TENS:  # "ninety eight" is 98; "ninety" alone is 90
            unit = tokens[i] if i < len(tokens) and tokens[i] in _UNITS else None
            found = _TENS[token] + (_DIGIT_WORDS[unit] if unit else "0")
            i += unit is not None
        else:
            found = token if token.isdigit() else _DIGIT_WORDS.get(token)
        if found is None or (token in ("oh", "o") and not digits):  # "Oh, it's..." isn't a zero
            repeat = 1
            continue
        digits.append(found[0] * repeat + found[1:])
        repeat = 1
    return "".join(digits)


def speak_digits(digits: str) -> str:
    """Digits in groups of three for a voice to read one by one: 1 2 3, 4 5 6, 7 8 9."""
    return ", ".join(" ".join(digits[i : i + 3]) for i in range(0, len(digits), 3))


def normalize_phone(raw: str, default_country_code: str = "91") -> str | None:
    """A spoken or typed number as E.164, assuming India when no country code is given."""
    digits = spoken_digits(raw)
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


def write_phone(e164: str) -> str:
    """For a chat, where speak_phone is for a voice: +91 98765 43210, +1 415 555 0123."""
    digits = e164.lstrip("+")
    if digits.startswith("91") and len(digits) == 12:
        return f"+91 {digits[2:7]} {digits[7:]}"
    if digits.startswith("1") and len(digits) == 11:
        return f"+1 {digits[1:4]} {digits[4:7]} {digits[7:]}"
    return e164


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


# Typography the LLM likes (gpt-oss writes "six PM" and "multi‑level") that can make a
# TTS pause oddly or skip a word: narrow and non-breaking spaces, special hyphens, curly quotes.
_PLAIN = str.maketrans(
    {
        " ": " ",
        " ": " ",
        " ": " ",
        "‐": "-",
        "‑": "-",
        "‒": "-",
        "‘": "'",
        "’": "'",
        "“": '"',
        "”": '"',
        "…": "...",
    }
)


_RANGE_DASH = re.compile(r"(\d)\s*[–—]\s*(\d)")  # "12" en-dash "3 PM" -> "12 to 3 PM"
_DASH = re.compile(r"\s*[–—]\s*")  # an aside -> a comma pause


def plain_punctuation(text: str) -> str:
    text = _RANGE_DASH.sub(r"\1 to \2", text)
    return _DASH.sub(", ", text).translate(_PLAIN)


async def speak_plain_punctuation(chunks: AsyncIterable[str]) -> AsyncIterator[str]:
    """TTS text transform: plain_punctuation on each streamed chunk (characters never split)."""
    async for chunk in chunks:
        yield plain_punctuation(chunk)
