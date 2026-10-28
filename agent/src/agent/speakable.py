"""Text written for the ear: times, days, phone numbers and booking codes as a voice should say them."""

from __future__ import annotations

import re
from collections.abc import AsyncIterable, AsyncIterator
from datetime import date, datetime, time, timedelta
from typing import Any

from livekit.agents import FlushSentinel


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
    "six": "6", "seven": "7", "eight": "8", "nine": "9", "ten": "10",
}  # fmt: skip
_REPEATS = {"double": 2, "triple": 3}


def spoken_digits(text: str) -> str:
    """The digits of a number however it arrived: "98765 43210", "nine eight seven", "double five".

    Speech-to-text often writes a number read out digit by digit as words, and the LLM doesn't always
    turn them into digits before passing them on.
    """
    digits: list[str] = []
    repeat = 1
    for token in re.findall(r"\d+|[a-z]+", text.lower()):
        if token in _REPEATS:
            repeat = _REPEATS[token]
            continue
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


_PHRASE_END = re.compile(r"[.!?;:,](?=\s|$)")


async def speak_in_phrases(
    chunks: AsyncIterable[Any], *, first_words: int = 3, later_words: int = 8
) -> AsyncIterator[Any]:
    """Split an LLM reply into short spoken segments so the voice starts early.

    Without this the TTS gets the whole reply as one segment, and Deepgram only starts on a full
    sentence. A FlushSentinel after the first phrase (at the first comma or full stop once there are
    a few words) lets it start speaking right away; after that, segments end at sentence ends.
    LiveKit synthesises the next segment while the previous one plays, so there are no gaps.
    """
    words, first = 0, True
    async for chunk in chunks:
        text = chunk if isinstance(chunk, str) else _content(chunk)
        if not text:
            yield chunk  # tool calls, usage and other non-text chunks pass through untouched
            continue
        start = counted = 0
        for match in _PHRASE_END.finditer(text):
            words += len(text[counted : match.end()].split())
            counted = match.end()
            if words >= (first_words if first else later_words) and (first or match.group(0) in ".!?"):
                yield text[start : match.end()]
                yield FlushSentinel()
                start, words, first = match.end(), 0, False
        words += len(text[counted:].split())
        if text[start:]:
            yield text[start:]


def _content(chunk: Any) -> str | None:
    """Text of a ChatChunk that carries only text; None for tool calls or usage-only chunks."""
    delta = getattr(chunk, "delta", None)
    if delta is None or delta.tool_calls:
        return None
    return delta.content


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
