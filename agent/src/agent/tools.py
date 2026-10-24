"""The receptionist agent and the function tools the LLM can call.

Every write (book, change, cancel) takes two steps. A prepare_* tool checks it and reads it back to
the caller; confirm_action carries it out, and refuses to run in the same turn as the prepare, so
the caller always gets a turn to say yes. When the phone line gives the caller's number, that
number is used and anything the LLM passes instead is ignored.

Lines that must be exact (read-backs, booking codes) or need no thought (asking for a missing
detail, goodbye) are spoken by the tool itself, and the turn ends there. That skips the LLM's
follow-up request: about a second sooner for the caller, and a request's worth of the free tier's
tokens saved.
"""

from __future__ import annotations

import asyncio
import random
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import date, datetime, time
from time import monotonic
from typing import Literal
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from livekit.agents import Agent, ModelSettings, RunContext, StopResponse, ToolResult, function_tool, llm
from livekit.agents.voice.speech_handle import SpeechHandle

from agent.api_client import ApiError, RestaurantAPI
from agent.api_client.models import (
    Availability,
    CancelReservationRequest,
    CreateMessageRequest,
    CreateReservationRequest,
    Reservation,
    RestaurantSettings,
    UpdateReservationRequest,
)
from agent.facts import Facts
from agent.prompts import LOOKUP_TOOLS, build_instructions
from agent.speakable import (
    join_or,
    normalize_phone,
    on_day,
    speak_day,
    speak_in_phrases,
    speak_phone,
    speak_time,
    spell_code,
)

Topic = Literal["hours", "location", "parking", "delivery", "specials", "policies"]
Dietary = Literal["vegetarian", "vegan", "gluten_free", "dairy_free", "nut_free", "jain"]
MessageTopic = Literal["large_party", "event", "catering", "callback", "other"]

# How long an availability answer the caller just heard can stand in for a fresh check when they
# go on to book. Safe: creating the booking re-checks the table atomically on the server.
AVAILABILITY_REUSE_SECONDS = 90
OUTCOME_FOR = {"book": "booked", "change": "changed", "cancel": "cancelled"}

# The conversation the LLM sees: the instructions and the latest items, not the whole call. Every
# request resends it, and the free tiers cap tokens per minute. A booking in progress lives in
# CallState, so it doesn't depend on old turns.
MAX_HISTORY_ITEMS = 24

# Said once per reply when an API call is still running after FILLER_AFTER_SECONDS, so a caller
# never sits in silence during a slow lookup. Fast lookups (most of them) say nothing.
FILLERS = ("One moment.", "Let me check.", "Just a second.")
FILLER_AFTER_SECONDS = 0.7

READ_BACK = ("Just to confirm:", "Let me read that back:")
ANYTHING_ELSE = ("Anything else I can help with?", "Is there anything else I can do for you?")

NOT_CONFIRMED_YET = "The caller hasn't confirmed yet. Read it back and wait for a clear yes."
NOT_DONE_YET = "The caller hasn't said goodbye, so don't hang up. Ask if there's anything else."
NOTHING_TO_CHANGE = "That's how the booking already is. Ask what they'd like to change."

# A caller winding the call up. end_call is refused unless their last words match this: hanging up
# on someone mid-conversation is far worse than staying on, and the silence timer in
# call_limits.py still ends a call that has gone quiet.
_GOODBYE = re.compile(
    r"\b(bye|goodbye|good night|see you|take care|cheers|thanks|thank you|no thanks|nothing (else|more)"
    r"|that'?s (all|it|everything|fine)|that is all|that'?ll be all|that will be all|all good"
    r"|i'?m (done|good|all set)|have a (good|nice|great))\b",
    re.IGNORECASE,
)

# What an LLM writes as guest_name when the caller hasn't given one.
_NOT_A_NAME = {
    "", "guest", "caller", "the caller", "customer", "client", "user", "unknown", "anonymous", "none",
    "n a", "na", "name", "not given", "not provided", "sir", "madam", "mr", "mrs", "ms",
}  # fmt: skip


def new_call_id() -> str:
    """A fresh id for one conversation. Every booking, message and the call log it creates carry it,
    so each record traces back to exactly one call, whatever the room or caller."""
    return f"call_{uuid4().hex}"


@dataclass
class PendingAction:
    kind: Literal["book", "change", "cancel"]
    request: CreateReservationRequest | UpdateReservationRequest | CancelReservationRequest
    prepared_in: str  # speech id of the turn that prepared it
    reservation_id: UUID | None = None


@dataclass
class CallState:
    """Everything one call needs, shared by all tools through `context.userdata`."""

    api: RestaurantAPI
    restaurant: RestaurantSettings
    call_id: str
    caller_phone: str | None = None  # from the phone line: trusted
    given_phone: str | None = None  # said by the caller: read back before use
    pending: PendingAction | None = None
    end_call: Callable[[SpeechHandle], None] | None = None  # hangs up after that speech
    outcomes: list[str] = field(default_factory=list)  # what this call achieved, for the call log
    filler_spoken_in: str | None = None  # speech id of the reply that already said a filler
    told_free: tuple[date, str, int] | None = None  # the request the caller last heard is free
    booked_on: date | None = None  # the day of the booking made on this call, for the goodbye
    _availability: dict[tuple[date, str, int], tuple[float, Availability]] = field(
        default_factory=dict, repr=False
    )

    @property
    def phone(self) -> str | None:
        return self.caller_phone or self.given_phone

    @property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.restaurant.timezone)

    def today(self) -> date:
        # The API's clock, fetched at call start, so "today" matches the calendar in the prompt.
        return self.restaurant.now.astimezone(self.tz).date()

    def remember_availability(
        self, day: date, hhmm: str, party_size: int, availability: Availability
    ) -> None:
        self._availability[(day, hhmm, party_size)] = (monotonic(), availability)

    def recent_availability(self, day: date, hhmm: str, party_size: int) -> Availability | None:
        checked_at, availability = self._availability.get((day, hhmm, party_size), (0.0, None))
        return availability if monotonic() - checked_at < AVAILABILITY_REUSE_SECONDS else None

    def outcome(self, *, caller_spoke: bool) -> str:
        """The call's main result for the call log, most significant first."""
        for outcome in ("booked", "changed", "cancelled", "message_taken"):
            if outcome in self.outcomes:
                return outcome
        return "answered" if caller_spoke else "hung_up"

    def describe(self, res: Reservation) -> str:
        start = res.start.astimezone(self.tz)
        day = speak_day(start.date(), self.today())
        return f"a table for {res.party_size} under {res.guest_name}, {day} at {speak_time(start)}"

    def when(self, start: datetime) -> str:
        """ "on Tuesday at 8 PM": for running speech; read-backs use the full date."""
        start = start.astimezone(self.tz)
        return f"{on_day(start.date(), self.today())} at {speak_time(start)}"


def _parse_time(value: str) -> time | None:
    try:
        return time.fromisoformat(value)
    except ValueError:
        return None


_WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
_MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
ASK_WHICH_DAY = "Ask the caller which day they mean."
DAY_TOO_FAR = "That date is beyond the next two weeks. Ask for the full date and pass it as YYYY-MM-DD."


def resolve_day(s: CallState, said: str) -> date | str:
    """The date the caller means, looked up in the API's calendar; or a question to ask instead.

    The LLM only passes the caller's words. Turning "this Tuesday" into a date is done here, from the
    calendar the API sent at call start, because the LLM picks the wrong calendar line too often.
    """
    raw = said.strip().lower()
    try:
        return date.fromisoformat(raw)
    except ValueError:
        pass
    words = re.sub(r"[^a-z0-9 ]", " ", raw).split()
    calendar = [d.date for d in s.restaurant.calendar]  # starts today
    if not words or not calendar:
        return ASK_WHICH_DAY
    if "today" in words or "tonight" in words:
        return calendar[0]
    if "tomorrow" in words:
        return calendar[1]
    for name in _WEEKDAYS:
        if any(w in (name, name[:3]) for w in words):
            matches = [d for d in calendar if f"{d:%A}".lower() == name]
            # "next Saturday" said on a Saturday means a week from today, not today.
            if "next" in words and matches and matches[0] == calendar[0]:
                matches = matches[1:]
            return matches[0] if matches else DAY_TOO_FAR
    number = next(
        (int(m.group(1)) for w in words if (m := re.fullmatch(r"(\d{1,2})(st|nd|rd|th)?", w))), None
    )
    month = next((i for i, m in enumerate(_MONTHS, 1) for w in words if w.startswith(m)), None)
    if number:
        for d in calendar:
            if d.day == number and (month is None or d.month == month):
                return d
        return DAY_TOO_FAR
    return ASK_WHICH_DAY


def real_name(guest_name: str | None) -> str | None:
    """The caller's name, or None for the stand-ins an LLM writes when it doesn't have one."""
    name = " ".join((guest_name or "").split())
    return None if re.sub(r"[\W_]+", " ", name.lower()).strip() in _NOT_A_NAME else name


def _availability_reply(availability: Availability) -> str:
    if availability.requested_time_available:
        return availability.summary
    # Small models tend to jump straight to the alternatives; the caller needs to hear "no" first.
    return f"{availability.summary} (First tell the caller their time is taken, then offer these.)"


def _taken_line(s: CallState, day: date, at: time, availability: Availability) -> str:
    """The requested time is gone: say so first, then the nearest free times."""
    if not availability.slots:
        return f"Sorry, we're fully booked {on_day(day, s.today())}. Would another day work?"
    times = []
    for slot in availability.slots:
        start = slot.start.astimezone(s.tz)
        times.append(speak_time(start) if start.date() == day else s.when(start))
    return f"Sorry, {speak_time(at)} is taken. I can do {join_or(times)}. Would one of those work?"


def _goodbye(s: CallState) -> str:
    if s.booked_on:
        return f"Thanks for calling, and we'll see you {on_day(s.booked_on, s.today())}! Goodbye."
    return f"Thanks for calling {s.restaurant.name}. Take care, goodbye!"


def _last_caller_words(context: RunContext[CallState]) -> str:
    for item in reversed(context.session.history.items):
        if item.type == "message" and item.role == "user":
            return item.text_content or ""
    return ""


def _instructions(state: CallState, **kwargs) -> str:
    return build_instructions(state.restaurant, caller_id_known=state.caller_phone is not None, **kwargs)


class Receptionist(Agent):
    def __init__(self, state: CallState | None = None) -> None:
        """Without a state, the agent stays silent until begin(), so a call can set up its audio
        while the restaurant's settings are still loading."""
        super().__init__(
            instructions=_instructions(state) if state else "The call is still connecting. Say nothing."
        )
        self._ready = state is not None

    async def begin(self, state: CallState) -> None:
        """The restaurant's settings are in: take on its instructions and start answering."""
        await self.update_instructions(_instructions(state))
        self._ready = True

    async def use_facts(self, state: CallState, facts: Facts) -> None:
        """Put the menu and info in the prompt, and drop the lookup tools the facts make redundant.

        Each tool's description is resent with every request, and a lookup the facts already answer
        costs an API round trip plus a second LLM request.
        """
        redundant = set()
        if facts.all_info:
            redundant.add("get_restaurant_info")
        if facts.whole_menu:
            redundant.add("search_menu")
        lookups = [t for t in LOOKUP_TOOLS if t not in redundant]
        await self.update_instructions(_instructions(state, facts=facts.text, lookups=lookups))
        await self.update_tools([t for t in self.tools if t.id not in redundant])

    async def on_user_turn_completed(self, turn_ctx: llm.ChatContext, new_message: llm.ChatMessage) -> None:
        if not self._ready:  # the caller spoke before the greeting; the greeting answers them
            raise StopResponse()

    async def llm_node(self, chat_ctx: llm.ChatContext, tools: list[llm.Tool], model_settings: ModelSettings):
        """The default LLM step on the recent history, split into short spoken phrases so the voice
        starts sooner."""
        chat_ctx = chat_ctx.copy()
        chat_ctx.truncate(max_items=MAX_HISTORY_ITEMS)
        async for chunk in speak_in_phrases(Agent.default.llm_node(self, chat_ctx, tools, model_settings)):
            yield chunk

    async def _waiting[T](self, context: RunContext[CallState], call: Awaitable[T]) -> T:
        """Await an API call; if it's slow, say a short filler so the caller isn't left in silence."""
        s = context.userdata
        say = getattr(getattr(context, "session", None), "say", None)
        speech_id = context.speech_handle.id
        if say is None or s.filler_spoken_in == speech_id:
            return await call

        async def filler() -> None:
            await asyncio.sleep(FILLER_AFTER_SECONDS)
            s.filler_spoken_in = speech_id
            say(random.choice(FILLERS), add_to_chat_ctx=False)

        task = asyncio.create_task(filler())
        try:
            return await call
        finally:
            task.cancel()

    def _say(self, context: RunContext[CallState], line: str, note: str) -> ToolResult:
        """Say a fixed line to the caller and end the turn there, with no follow-up LLM request.

        `note` is the result the LLM sees in later turns; the line itself joins its history as speech.
        """
        if context.speech_handle.interrupted:  # the caller cut in: their new turn takes over
            return ToolResult(f"{note} (Not said: the caller interrupted.)", reply_required=False)
        context.session.say(line)
        return ToolResult(note, reply_required=False)

    def _accept_phone(self, s: CallState, phone_number: str | None) -> str | None:
        """The caller ID if there is one; otherwise the number the caller said, if it's valid."""
        if s.caller_phone:
            return s.caller_phone
        if phone_number and (normalized := normalize_phone(phone_number)):
            s.given_phone = normalized
        return s.given_phone

    @function_tool()
    async def get_restaurant_info(self, context: RunContext[CallState], topic: Topic) -> str:
        """If the restaurant facts don't cover it: hours, location, parking, delivery, specials, policies."""
        s = context.userdata
        try:
            return (await self._waiting(context, s.api.get_info(s.restaurant.id, topic))).summary
        except ApiError as e:
            return e.say

    @function_tool()
    async def search_menu(
        self,
        context: RunContext[CallState],
        query: str | None = None,
        dietary: list[Dietary] | None = None,
    ) -> str:
        """Only for a dish or detail not in the restaurant facts: prices, spice, diet tags, allergens.

        Args:
            query: Dish or keyword, e.g. "korma". Empty to browse.
        """
        s = context.userdata
        note = ""
        try:
            result = await self._waiting(
                context, s.api.search_menu(s.restaurant.id, query=query, dietary=dietary)
            )
            if not result.items and query and dietary:
                # "Does the aloo gobi have nuts?" often arrives as query + a nut_free filter. An empty
                # result would read as "not on the menu", so answer about the dish itself.
                result = await self._waiting(context, s.api.search_menu(s.restaurant.id, query=query))
                if result.items:
                    tags = " or ".join(d.replace("_", " ") for d in dietary)
                    note = f"(These aren't tagged {tags}; answer from the allergen details.) "
        except ApiError as e:
            return e.say
        details = []
        for item in result.items:
            tags = ", ".join(t.replace("_", " ") for t in item.dietary_tags) or "no dietary tags"
            if not item.allergens_listed:
                # "Not listed" gets misheard as "none listed", so spell out what to say.
                allergens = (
                    "NO allergen information: say you don't have allergen details for it and suggest "
                    "checking with staff; never imply it's free of anything"
                )
            elif item.allergens:
                allergens = "contains " + ", ".join(item.allergens)
            else:
                allergens = "no listed allergens"
            details.append(f"{item.name}: {tags}; {allergens}.")
        return note + result.summary + ("\nDetails: " + " ".join(details) if details else "")

    @function_tool()
    async def check_availability(
        self, context: RunContext[CallState], day: str, time: str, party_size: int
    ) -> str:
        """Only when the caller asks whether a time is free without booking yet.

        Args:
            day: The day as the caller said it: "Tuesday", "tomorrow", "27th", or YYYY-MM-DD.
            time: 24-hour HH:MM.
        """
        s = context.userdata
        if _parse_time(time) is None:
            return "Use time as 24-hour HH:MM."
        if isinstance(found := resolve_day(s, day), str):
            return found
        day = found
        try:
            availability = await self._waiting(
                context, s.api.check_availability(s.restaurant.id, day, time, party_size)
            )
        except ApiError as e:
            return e.say
        s.remember_availability(day, time, party_size, availability)
        if availability.requested_time_available:
            s.told_free = (day, time, party_size)
        return _availability_reply(availability)

    @function_tool()
    async def prepare_booking(
        self,
        context: RunContext[CallState],
        party_size: int,
        day: str,
        time: str,
        guest_name: str | None = None,
        phone_number: str | None = None,
        notes: str | None = None,
    ) -> str | ToolResult:
        """Check the table, ask the caller for anything missing, then read the booking back. Books nothing.

        Args:
            day: The day as the caller said it: "Tuesday", "tomorrow", "27th", or YYYY-MM-DD.
            time: 24-hour HH:MM.
            guest_name: Only once the caller has said it.
            phone_number: Only if there's no caller ID.
            notes: Special requests.
        """
        s = context.userdata
        if (at := _parse_time(time)) is None:
            return "Use time as 24-hour HH:MM."
        if isinstance(found := resolve_day(s, day), str):
            return found
        day = found
        # Reuse the check the caller just heard instead of a second round trip to the database.
        availability = s.recent_availability(day, time, party_size)
        if availability is None:
            try:
                availability = await self._waiting(
                    context, s.api.check_availability(s.restaurant.id, day, time, party_size)
                )
            except ApiError as e:
                return e.say
            s.remember_availability(day, time, party_size, availability)
        if not availability.requested_time_available:
            return self._say(
                context,
                _taken_line(s, day, at, availability),
                "Told the caller that time is taken and offered the nearest free times.",
            )
        start = availability.slots[0].start.astimezone(s.tz)
        heard_free = s.told_free == (day, time, party_size)
        s.told_free = (day, time, party_size)
        name = real_name(guest_name)
        if name is None:
            news = "" if heard_free else f"Good news, we have a table for {party_size} {s.when(start)}. "
            return self._say(
                context, f"{news}What name should I put the booking under?", "It's free. Asked for the name."
            )
        phone = self._accept_phone(s, phone_number)
        if phone is None:
            lead = (
                f"Thanks, {name}."
                if heard_free
                else f"Good news, we have a table for {party_size} {s.when(start)}."
            )
            return self._say(
                context,
                f"{lead} What's the best phone number for the booking?",
                "It's free. Asked for a phone number.",
            )
        request = CreateReservationRequest(
            restaurant_id=s.restaurant.id,
            idempotency_key=uuid4(),
            guest_name=name,
            guest_phone=phone,
            party_size=party_size,
            start=start,
            notes=notes,
            call_id=s.call_id,
        )
        s.pending = PendingAction("book", request, prepared_in=context.speech_handle.id)
        day_and_time = f"{speak_day(start.date(), s.today())} at {speak_time(start)}"
        details = f"a table for {party_size} under {name}, {day_and_time}"
        if not s.caller_phone:
            details += f", and your number is {speak_phone(phone)}"
        if notes:
            details += f", with the note: {notes}"
        lead = random.choice(READ_BACK) if heard_free else "Good news, that time's free. Just to confirm:"
        return self._say(
            context,
            f"{lead} {details}. Shall I book it?",
            f"Read back {details}. Not booked yet: wait for a clear yes.",
        )

    @function_tool()
    async def find_my_bookings(
        self,
        context: RunContext[CallState],
        booking_code: str | None = None,
        phone_number: str | None = None,
    ) -> str:
        """Find the caller's upcoming bookings by code or phone number.

        Args:
            phone_number: Only if there's no caller ID.
        """
        s = context.userdata
        phone = None if booking_code else self._accept_phone(s, phone_number)
        if not booking_code and not phone:
            return "Ask for the booking code or the phone number the booking was made with."
        try:
            result = await self._waiting(
                context, s.api.find_reservations(s.restaurant.id, phone=phone, code=booking_code)
            )
        except ApiError as e:
            return e.say
        if not result.reservations:
            return result.summary
        found = "; ".join(f"{s.describe(r)}, code {spell_code(r.code)}" for r in result.reservations)
        return f"Found: {found}."

    async def _find_one(self, context: RunContext[CallState], booking_code: str) -> Reservation | str:
        s = context.userdata
        try:
            result = await self._waiting(context, s.api.find_reservations(s.restaurant.id, code=booking_code))
        except ApiError as e:
            return e.say
        if not result.reservations:
            return "I couldn't find an upcoming booking with that code. Could you check it?"
        return result.reservations[0]

    @function_tool()
    async def prepare_change(
        self,
        context: RunContext[CallState],
        booking_code: str,
        new_day: str | None = None,
        new_time: str | None = None,
        new_party_size: int | None = None,
    ) -> str | ToolResult:
        """Read back a change to a booking. Changes nothing.

        Args:
            new_day: The new day as the caller said it: "Tuesday", "tomorrow", "27th", or YYYY-MM-DD.
            new_time: 24-hour HH:MM.
        """
        s = context.userdata
        res = await self._find_one(context, booking_code)
        if isinstance(res, str):
            return res
        current = res.start.astimezone(s.tz)
        day = resolve_day(s, new_day) if new_day else current.date()
        if isinstance(day, str):
            return day
        at = _parse_time(new_time) if new_time else current.time()
        if at is None:
            return "Use time as 24-hour HH:MM."
        start = datetime.combine(day, at, s.tz)
        party_size = new_party_size or res.party_size
        if start == current and party_size == res.party_size:
            return NOTHING_TO_CHANGE
        request = UpdateReservationRequest(
            guest_phone=s.phone, code=res.code, start=start, party_size=party_size
        )
        s.pending = PendingAction(
            "change", request, prepared_in=context.speech_handle.id, reservation_id=res.id
        )
        change = (
            f"your table for {res.party_size} {s.when(current)} becomes a table for {party_size}, "
            f"{speak_day(day, s.today())} at {speak_time(start)}"
        )
        return self._say(
            context,
            f"{random.choice(READ_BACK)} {change}. Is that right?",
            f"Read back: {change}. Not changed yet: wait for a clear yes.",
        )

    @function_tool()
    async def prepare_cancel(self, context: RunContext[CallState], booking_code: str) -> str | ToolResult:
        """Read back the cancellation of a booking. Cancels nothing."""
        s = context.userdata
        res = await self._find_one(context, booking_code)
        if isinstance(res, str):
            return res
        request = CancelReservationRequest(idempotency_key=uuid4(), guest_phone=s.phone, code=res.code)
        s.pending = PendingAction(
            "cancel", request, prepared_in=context.speech_handle.id, reservation_id=res.id
        )
        booking = f"your table for {res.party_size} {s.when(res.start)}, under {res.guest_name}"
        return self._say(
            context,
            f"Just to confirm, you'd like to cancel {booking}?",
            f"Read back the cancellation of {s.describe(res)}. Not cancelled yet: wait for a clear yes.",
        )

    @function_tool()
    async def confirm_action(self, context: RunContext[CallState]) -> str | ToolResult:
        """Carry out the prepared booking, change or cancellation, only after a clear yes."""
        s = context.userdata
        pending = s.pending
        if pending is None:
            return "There's nothing to confirm. Prepare the booking, change or cancellation first."
        if pending.prepared_in == context.speech_handle.id:
            return NOT_CONFIRMED_YET
        try:
            if pending.kind == "book":
                res = await self._waiting(context, s.api.create_reservation(pending.request))  # type: ignore[arg-type]
            elif pending.kind == "change":
                res = await self._waiting(
                    context,
                    s.api.update_reservation(pending.reservation_id, pending.request),  # type: ignore[arg-type]
                )
            else:
                res = await self._waiting(
                    context,
                    s.api.cancel_reservation(pending.reservation_id, pending.request),  # type: ignore[arg-type]
                )
        except ApiError as e:
            s.pending = None
            return e.say
        s.pending = None
        s.outcomes.append(OUTCOME_FOR[pending.kind])
        if pending.kind == "book":
            s.booked_on = res.start.astimezone(s.tz).date()
            line = f"You're all set! Your booking code is {spell_code(res.code)}."
        elif pending.kind == "change":
            line = (
                f"Done, it's now a table for {res.party_size} {s.when(res.start)}. "
                f"Your code is still {spell_code(res.code)}."
            )
        else:
            s.booked_on = None
            line = "Done, that booking is cancelled."
        return self._say(
            context,
            f"{line} {random.choice(ANYTHING_ELSE)}",
            f"Done and told the caller. {res.summary}",
        )

    @function_tool()
    async def take_message(
        self,
        context: RunContext[CallState],
        caller_name: str,
        topic: MessageTopic,
        details: str,
        phone_number: str | None = None,
    ) -> str | ToolResult:
        """Leave a message for the manager: large parties, events, catering, or to reach a person.

        Args:
            phone_number: Only if there's no caller ID.
        """
        s = context.userdata
        phone = self._accept_phone(s, phone_number)
        if phone is None:
            return "Ask the caller for a callback number first."
        request = CreateMessageRequest(
            restaurant_id=s.restaurant.id,
            idempotency_key=uuid4(),
            caller_name=caller_name,
            caller_phone=phone,
            topic=topic,
            details=details,
            call_id=s.call_id,
        )
        try:
            receipt = await self._waiting(context, s.api.create_message(request))
        except ApiError as e:
            return e.say
        s.outcomes.append("message_taken")
        return self._say(
            context,
            f"{receipt.summary} {random.choice(ANYTHING_ELSE)}",
            f"Message saved and the caller told: {receipt.summary}",
        )

    @function_tool()
    async def end_call(self, context: RunContext[CallState]) -> str | ToolResult:
        """Say goodbye and hang up, only once the caller has said goodbye or that they're done."""
        if not _GOODBYE.search(_last_caller_words(context)):
            return NOT_DONE_YET
        s = context.userdata
        goodbye = context.session.say(_goodbye(s))
        if s.end_call:
            s.end_call(goodbye)
        return ToolResult("Said goodbye. The call is ending.", reply_required=False)
