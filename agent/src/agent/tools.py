"""The receptionist agent and the function tools the LLM can call.

Every write (book, change, cancel) takes two steps. A prepare_* tool checks it and returns a
read-back; confirm_action carries it out, and refuses to run in the same turn as the prepare, so
the caller always gets a turn to say yes. When the phone line gives the caller's number, that
number is used and anything the LLM passes instead is ignored.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, datetime, time
from time import monotonic
from typing import Literal
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from livekit.agents import Agent, ModelSettings, RunContext, function_tool, llm
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
from agent.prompts import build_instructions
from agent.speakable import (
    normalize_phone,
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

NOT_CONFIRMED_YET = "The caller hasn't confirmed yet. Read it back and wait for a clear yes."
NOT_DONE_YET = "The caller hasn't said goodbye, so don't hang up. Ask if there's anything else."

# A caller winding the call up. end_call is refused unless their last words match this: hanging up
# on someone mid-conversation is far worse than staying on, and the silence timer in
# call_limits.py still ends a call that has gone quiet.
_GOODBYE = re.compile(
    r"\b(bye|goodbye|good night|see you|thanks|thank you|no thanks|nothing else|that'?s (all|it|everything)"
    r"|that will be all|i'?m (done|good|all set)|have a (good|nice|great))\b",
    re.IGNORECASE,
)


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


def _availability_reply(availability: Availability) -> str:
    if availability.requested_time_available:
        return availability.summary
    # Small models tend to jump straight to the alternatives; the caller needs to hear "no" first.
    return f"{availability.summary} (First tell the caller their time is taken, then offer these.)"


def _last_caller_words(context: RunContext[CallState]) -> str:
    for item in reversed(context.session.history.items):
        if item.type == "message" and item.role == "user":
            return item.text_content or ""
    return ""


class Receptionist(Agent):
    def __init__(self, state: CallState) -> None:
        super().__init__(
            instructions=build_instructions(state.restaurant, caller_id_known=state.caller_phone is not None),
        )

    async def llm_node(self, chat_ctx: llm.ChatContext, tools: list[llm.Tool], model_settings: ModelSettings):
        """The default LLM step, split into short spoken phrases so the voice starts sooner."""
        async for chunk in speak_in_phrases(Agent.default.llm_node(self, chat_ctx, tools, model_settings)):
            yield chunk

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
            return (await s.api.get_info(s.restaurant.id, topic)).summary
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
            result = await s.api.search_menu(s.restaurant.id, query=query, dietary=dietary)
            if not result.items and query and dietary:
                # "Does the aloo gobi have nuts?" often arrives as query + a nut_free filter. An empty
                # result would read as "not on the menu", so answer about the dish itself.
                result = await s.api.search_menu(s.restaurant.id, query=query)
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
        """Check if a table is free.

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
            availability = await s.api.check_availability(s.restaurant.id, day, time, party_size)
        except ApiError as e:
            return e.say
        s.remember_availability(day, time, party_size, availability)
        return _availability_reply(availability)

    @function_tool()
    async def prepare_booking(
        self,
        context: RunContext[CallState],
        guest_name: str,
        party_size: int,
        day: str,
        time: str,
        phone_number: str | None = None,
        notes: str | None = None,
    ) -> str:
        """Validate a new booking and get the read-back. Books nothing.

        Args:
            day: The day as the caller said it: "Tuesday", "tomorrow", "27th", or YYYY-MM-DD.
            time: 24-hour HH:MM.
            phone_number: Only if there's no caller ID.
            notes: Special requests.
        """
        s = context.userdata
        if _parse_time(time) is None:
            return "Use time as 24-hour HH:MM."
        if isinstance(found := resolve_day(s, day), str):
            return found
        day = found
        # Availability first: if the time is taken, the caller should hear that before giving details.
        # Reuse the check the caller just heard instead of a second round trip to the database.
        availability = s.recent_availability(day, time, party_size)
        if availability is None:
            try:
                availability = await s.api.check_availability(s.restaurant.id, day, time, party_size)
            except ApiError as e:
                return e.say
            s.remember_availability(day, time, party_size, availability)
        if not availability.requested_time_available:
            return _availability_reply(availability)
        phone = self._accept_phone(s, phone_number)
        if phone is None:
            return "That time is free. Ask the caller for their full phone number, then prepare it again."
        slot = availability.slots[0]
        request = CreateReservationRequest(
            restaurant_id=s.restaurant.id,
            idempotency_key=uuid4(),
            guest_name=guest_name,
            guest_phone=phone,
            party_size=party_size,
            start=slot.start,
            notes=notes,
            call_id=s.call_id,
        )
        s.pending = PendingAction("book", request, prepared_in=context.speech_handle.id)
        phone_part = "" if s.caller_phone else f", phone {speak_phone(phone)}"
        return (
            "Not booked yet. Read this back and ask the caller to confirm: "
            f"a table for {party_size} under {guest_name}, {slot.label}{phone_part}."
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
            result = await s.api.find_reservations(s.restaurant.id, phone=phone, code=booking_code)
        except ApiError as e:
            return e.say
        if not result.reservations:
            return result.summary
        found = "; ".join(f"{s.describe(r)}, code {spell_code(r.code)}" for r in result.reservations)
        return f"Found: {found}."

    async def _find_one(self, s: CallState, booking_code: str) -> Reservation | str:
        try:
            result = await s.api.find_reservations(s.restaurant.id, code=booking_code)
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
    ) -> str:
        """Validate a change to a booking and get the read-back. Changes nothing.

        Args:
            new_day: The new day as the caller said it: "Tuesday", "tomorrow", "27th", or YYYY-MM-DD.
            new_time: 24-hour HH:MM.
        """
        s = context.userdata
        res = await self._find_one(s, booking_code)
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
        request = UpdateReservationRequest(
            guest_phone=s.phone, code=res.code, start=start, party_size=party_size
        )
        s.pending = PendingAction(
            "change", request, prepared_in=context.speech_handle.id, reservation_id=res.id
        )
        return (
            "Not changed yet. Read this back and ask the caller to confirm: change "
            f"{s.describe(res)} to a table for {party_size}, "
            f"{speak_day(day, s.today())} at {speak_time(start)}."
        )

    @function_tool()
    async def prepare_cancel(self, context: RunContext[CallState], booking_code: str) -> str:
        """Get the read-back for cancelling a booking. Cancels nothing."""
        s = context.userdata
        res = await self._find_one(s, booking_code)
        if isinstance(res, str):
            return res
        request = CancelReservationRequest(idempotency_key=uuid4(), guest_phone=s.phone, code=res.code)
        s.pending = PendingAction(
            "cancel", request, prepared_in=context.speech_handle.id, reservation_id=res.id
        )
        return f"Not cancelled yet. Read this back and ask the caller to confirm: cancel {s.describe(res)}."

    @function_tool()
    async def confirm_action(self, context: RunContext[CallState]) -> str:
        """Carry out the prepared booking, change or cancellation, only after a clear yes."""
        s = context.userdata
        pending = s.pending
        if pending is None:
            return "There's nothing to confirm. Prepare the booking, change or cancellation first."
        if pending.prepared_in == context.speech_handle.id:
            return NOT_CONFIRMED_YET
        try:
            if pending.kind == "book":
                res = await s.api.create_reservation(pending.request)  # type: ignore[arg-type]
            elif pending.kind == "change":
                res = await s.api.update_reservation(pending.reservation_id, pending.request)  # type: ignore[arg-type]
            else:
                res = await s.api.cancel_reservation(pending.reservation_id, pending.request)  # type: ignore[arg-type]
        except ApiError as e:
            s.pending = None
            return e.say
        s.pending = None
        s.outcomes.append(OUTCOME_FOR[pending.kind])
        if pending.kind == "cancel":
            return f"Done. {res.summary}"
        return f"Done. {res.summary} Tell the caller the code slowly: {spell_code(res.code)}."

    @function_tool()
    async def take_message(
        self,
        context: RunContext[CallState],
        caller_name: str,
        topic: MessageTopic,
        details: str,
        phone_number: str | None = None,
    ) -> str:
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
            receipt = await s.api.create_message(request)
        except ApiError as e:
            return e.say
        s.outcomes.append("message_taken")
        return receipt.summary

    @function_tool()
    async def end_call(self, context: RunContext[CallState]) -> str:
        """Hang up, only once the caller has said goodbye or that they're done. Call before your goodbye."""
        if not _GOODBYE.search(_last_caller_words(context)):
            return NOT_DONE_YET
        if context.userdata.end_call:
            context.userdata.end_call(context.speech_handle)
        return "Now say a short, warm goodbye."
