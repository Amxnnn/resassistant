"""Checks on what the LLM writes, sentence by sentence, before the caller hears it.

The prompt tells the LLM never to invent prices or booking codes and never to say something was
booked, changed or cancelled when it wasn't. A prompt is a request, not a guarantee, so each
sentence of a reply is checked against what the conversation actually holds before it reaches the
voice (or the chat):
- a claim that a booking, change or cancellation went through, when it didn't on this call (or is
  still waiting for the caller's yes): the false "you're booked" that sends a guest away without a
  table;
- a booking code that no tool returned and the caller never said;
- a price in rupees that appears nowhere in the restaurant's data or the conversation.

The first sentence that fails is replaced with a safe line and the rest of that reply is dropped:
a reply that has gone wrong once can't be trusted further. Tool calls always pass, and the tools
say their own confirmations and codes (tools.py), so a correct reply never trips these checks.

The voice waits for a whole sentence before it starts speaking anyway, so checking sentence by
sentence costs no time.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Iterator
from typing import TYPE_CHECKING

from livekit.agents import llm

if TYPE_CHECKING:
    from agent.tools import CallState

logger = logging.getLogger("agent.guard")

# Safe lines, said in place of a sentence that failed a check.
NOT_DONE_YET = "Sorry, I haven't done that yet. Shall I go ahead?"
NO_SUCH_CODE = "Sorry, I don't have a booking code for that yet."
NO_SUCH_PRICE = "Sorry, I don't have that price."

# A sentence ends at . ! or ? followed by a space and a capital or a quote, so "Rs. 380" and "7.30"
# stay whole.
_SENTENCE_END = re.compile(r"[.!?]+[\"')\]]*\s+(?=[A-Z\"'(])")

# Claims that something was done, by kind. "Is booked" alone is left out: "Sorry, 7:30 is booked"
# means the time is taken.
_CLAIMS = {
    "book": re.compile(
        r"\b(?:you'?re|you are) (?:all )?(?:set|booked|confirmed)\b"
        r"|\b(?:i'?ve|i have|i) (?:just )?(?:booked|reserved)\b"
        r"|\b(?:has|have) been (?:booked|reserved)\b"
        r"|\b(?:booking|reservation|table) (?:is|has been) (?:now )?"
        r"(?:booked|confirmed|reserved|made|done)\b",
        re.IGNORECASE,
    ),
    "cancel": re.compile(
        r"\b(?:i'?ve|i have|i) (?:just )?cancell?ed\b|\b(?:has|have|is) been cancell?ed\b"
        r"|\b(?:booking|reservation) is (?:now )?cancell?ed\b",
        re.IGNORECASE,
    ),
    "change": re.compile(
        r"\b(?:i'?ve|i have|i) (?:just )?(?:changed|moved|updated)\b"
        r"|\b(?:has|have) been (?:changed|moved|updated)\b",
        re.IGNORECASE,
    ),
    # A bare "Done!" or "Perfect, all set." claims whatever was being done.
    "any": re.compile(
        r"^\W*(?:(?:great|perfect|okay|ok|sure|awesome|lovely|wonderful|brilliant|excellent)\W+)?"
        r"(?:all |it'?s |that'?s )?(?:done|set|sorted|booked|confirmed|reserved|cancell?ed)\W*$",
        re.IGNORECASE,
    ),
}
_DONE = {
    "book": ("booked", "changed"),
    "cancel": ("cancelled",),
    "change": ("changed",),
    "any": ("booked", "changed", "cancelled"),
}

# Booking codes: written ("K7Q2", letters and digits mixed), or spelled out for the voice ("K, 7,
# Q, 2"), which must hold a letter so a phone number read digit by digit isn't taken for one.
_WRITTEN_CODE = re.compile(r"\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{4,6}\b")
_SPELLED_CODE = re.compile(r"\b[A-Za-z0-9](?:[\s,.-]+[A-Za-z0-9]\b){3,5}")
_TIME = re.compile(r"^\d{1,4}(?:AM|PM)$")  # "11PM" and "1130AM" are times, not codes
_PRICE = re.compile(
    r"(?:₹|\brs\.?|\binr)\s?(\d[\d,]*)|(\d[\d,]*)\s?(?:rupees?|rs\b|inr\b)",
    re.IGNORECASE,
)
_NUMBER = re.compile(r"\d[\d,]*")


def codes_in(text: str) -> set[str]:
    codes = {c for c in _WRITTEN_CODE.findall(text) if not _TIME.match(c)}
    for match in _SPELLED_CODE.finditer(text):
        code = re.sub(r"[\s,.-]+", "", match.group(0)).upper()
        if any(c.isalpha() for c in code) and 4 <= len(code) <= 6:
            codes.add(code)
    return codes


def prices_in(text: str) -> set[int]:
    return {int((a or b).replace(",", "")) for a, b in _PRICE.findall(text)}


def numbers_in(text: str) -> set[int]:
    return {int(n.replace(",", "")) for n in _NUMBER.findall(text) if n.replace(",", "")}


def claimed_done(sentence: str) -> str | None:
    """The kind of action a sentence says was done ("book", "cancel" or "change"), if any."""
    for kind, pattern in _CLAIMS.items():
        if pattern.search(sentence):
            return kind
    return None


class ReplyGuard:
    """Checks one reply as it streams out of the LLM. Feed it each chunk; it yields what may pass."""

    def __init__(self, state: CallState, chat_ctx: llm.ChatContext) -> None:
        self._state = state
        self._codes = set(state.known_codes)
        self._amounts: set[int] = set()
        for item in chat_ctx.items:
            text = _text_of(item)
            caller = item.type == "message" and item.role == "user"
            data = item.type == "function_call_output" or (
                item.type == "message" and item.role in ("system", "developer")
            )
            # Prices come only from the restaurant's data and the tools: "it's 1 rupee, right?" makes
            # nothing true. Codes may also come from the caller: their own booking's code.
            if data:
                self._amounts |= numbers_in(text)
            if data or caller:
                self._codes |= codes_in(text)
        self._buffer = ""
        self._blocked = False

    @property
    def blocked(self) -> bool:
        return self._blocked

    def feed(self, chunk: str | llm.ChatChunk) -> Iterator[str | llm.ChatChunk]:
        if isinstance(chunk, str):
            yield from self._text(chunk)
            return
        if not isinstance(chunk, llm.ChatChunk) or chunk.delta is None:
            yield chunk  # usage and anything else passes untouched
            return
        if chunk.delta.content:
            yield from self._text(chunk.delta.content)
        if chunk.delta.tool_calls:
            yield from self.finish()  # the text before a tool call goes first
            yield llm.ChatChunk(
                id=chunk.id,
                delta=llm.ChoiceDelta(role="assistant", tool_calls=chunk.delta.tool_calls),
                usage=chunk.usage,
            )

    def finish(self) -> Iterator[str]:
        """The end of the reply (or a tool call): check and release whatever is left."""
        rest, self._buffer = self._buffer, ""
        if rest.strip() and not self._blocked:
            yield from self._checked(rest)

    def _text(self, text: str) -> Iterator[str]:
        if self._blocked:
            return
        self._buffer += text
        while (end := _SENTENCE_END.search(self._buffer)) is not None:
            sentence, self._buffer = self._buffer[: end.end()], self._buffer[end.end() :]
            yield from self._checked(sentence)
            if self._blocked:
                return

    def _checked(self, sentence: str) -> Iterator[str]:
        problem = self._problem(sentence)
        if problem is None:
            yield sentence
            return
        reason, safe = problem
        logger.warning("reply guard: %s | blocked %r | said %r instead", reason, sentence.strip(), safe)
        self._blocked = True
        self._buffer = ""
        yield safe

    def _done(self, kind: str) -> bool:
        """Whether a claim of this kind is true: it happened on this call, and nothing awaits a yes."""
        s = self._state
        if s.pending is not None:
            return False
        if any(outcome in s.outcomes for outcome in _DONE[kind]):
            return True
        # "You're all set for Sunday" about a booking the tools found is a fact, not a claim.
        return kind in ("book", "any") and bool(s.known_codes)

    def _problem(self, sentence: str) -> tuple[str, str] | None:
        kind = claimed_done(sentence)
        if kind is not None and not self._done(kind):
            return (f"claims a {kind} that didn't happen", NOT_DONE_YET)
        if unknown := codes_in(sentence) - self._codes:
            return (f"booking code {sorted(unknown)} from nowhere", NO_SUCH_CODE)
        if unknown := prices_in(sentence) - self._amounts:
            return (f"price {sorted(unknown)} not in the restaurant's data", NO_SUCH_PRICE)
        return None


def _text_of(item: llm.ChatItem) -> str:
    if item.type == "message":
        return item.text_content or ""
    if item.type == "function_call_output":
        return item.output or ""
    return ""
