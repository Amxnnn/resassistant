# Generated from contracts/openapi.yaml by datamodel-codegen. Do not edit; regenerate (see docs/agent.md).

from __future__ import annotations

from datetime import date as date_aliased
from enum import StrEnum
from uuid import UUID

from pydantic import AnyUrl, AwareDatetime, BaseModel, Field


class Error1(BaseModel):
    code: str
    """
    Machine-readable code; see the table in the API description.
    """
    say: str
    """
    A sentence the agent can speak as-is.
    """


class Error(BaseModel):
    error: Error1


class CalendarDay(BaseModel):
    date: date_aliased
    weekday: str
    """
    English weekday name, e.g. Saturday.
    """
    open: bool
    hours: str | None
    """
    Speakable hours for that day; null when closed.
    """
    last_seating: str | None = Field(..., pattern="^([01][0-9]|2[0-3]):[0-5][0-9]$")
    """
    Last bookable start time (HH:MM); null when closed.
    """
    note: str | None
    """
    Closure reason or other note for that day.
    """


class InfoAnswer(BaseModel):
    topic: str
    """
    The topic asked about: hours, location, parking, delivery, specials or policies.
    """
    summary: str
    """
    The speakable answer.
    """


class MenuItem(BaseModel):
    id: UUID
    name: str
    category: str
    description: str | None
    price: float = Field(..., ge=0.0)
    """
    Price in major currency units, e.g. 350 for ₹350.
    """
    currency: str
    dietary_tags: list[str]
    """
    Known values: vegetarian, vegan, gluten_free, dairy_free, nut_free, jain.
    """
    spice_level: str | None
    """
    Known values: none, mild, medium, hot. Null when not set.
    """
    allergens_listed: bool
    """
    False means the restaurant hasn't entered allergen data for this dish. The agent must say "not listed", never guess.
    """
    allergens: list[str]
    """
    Allergens present, from the restaurant's data. Only meaningful when allergens_listed is true.
    """
    available_today: bool


class MenuSearchResult(BaseModel):
    items: list[MenuItem]
    summary: str


class Slot(BaseModel):
    start: AwareDatetime
    label: str
    """
    Speakable form of the time, e.g. "Saturday, November 7 at 7:30 PM".
    """


class Availability(BaseModel):
    date: date_aliased
    time: str = Field(..., examples=["19:30"], pattern="^([01][0-9]|2[0-3]):[0-5][0-9]$")
    """
    Restaurant-local time, 24-hour HH:MM.
    """
    party_size: int
    requested_time_available: bool
    slots: list[Slot] = Field(..., max_length=3)
    summary: str


class CreateReservationRequest(BaseModel):
    restaurant_id: UUID
    idempotency_key: UUID
    guest_name: str = Field(..., max_length=100, min_length=1)
    guest_phone: str = Field(..., examples=["+14155550123"], pattern="^\\+[1-9][0-9]{6,14}$")
    """
    E.164 phone number.
    """
    party_size: int = Field(..., ge=1, le=50)
    start: AwareDatetime
    notes: str | None = Field(None, max_length=500)
    call_id: str | None = Field(None, max_length=100)


class Reservation(BaseModel):
    id: UUID
    code: str = Field(..., examples=["K7Q2"], pattern="^[A-Z0-9]{4,6}$")
    """
    Short booking code, easy to say aloud.
    """
    restaurant_id: UUID
    guest_name: str
    guest_phone: str = Field(..., examples=["+14155550123"], pattern="^\\+[1-9][0-9]{6,14}$")
    """
    E.164 phone number.
    """
    party_size: int
    start: AwareDatetime
    end: AwareDatetime
    status: str
    """
    Known values: confirmed, cancelled.
    """
    notes: str | None
    summary: str


class ReservationList(BaseModel):
    reservations: list[Reservation]
    summary: str


class UpdateReservationRequest(BaseModel):
    """
    Send guest_phone or code to prove ownership, plus at least one of start, party_size or notes.
    """

    guest_phone: str | None = Field(None, pattern="^\\+[1-9][0-9]{6,14}$")
    code: str | None = Field(None, pattern="^[A-Z0-9]{4,6}$")
    start: AwareDatetime | None = None
    party_size: int | None = Field(None, ge=1, le=50)
    notes: str | None = Field(None, max_length=500)


class CancelReservationRequest(BaseModel):
    """
    Send guest_phone or code to prove ownership.
    """

    idempotency_key: UUID
    guest_phone: str | None = Field(None, pattern="^\\+[1-9][0-9]{6,14}$")
    code: str | None = Field(None, pattern="^[A-Z0-9]{4,6}$")
    reason: str | None = Field(None, max_length=500)


class Topic(StrEnum):
    large_party = "large_party"
    event = "event"
    catering = "catering"
    callback = "callback"
    other = "other"


class CreateMessageRequest(BaseModel):
    restaurant_id: UUID
    idempotency_key: UUID
    caller_name: str = Field(..., max_length=100, min_length=1)
    caller_phone: str = Field(..., examples=["+14155550123"], pattern="^\\+[1-9][0-9]{6,14}$")
    """
    E.164 phone number.
    """
    topic: Topic
    details: str = Field(..., max_length=2000, min_length=1)
    call_id: str | None = Field(None, max_length=100)


class MessageReceipt(BaseModel):
    id: UUID
    summary: str


class Channel(StrEnum):
    phone = "phone"
    browser = "browser"


class Outcome(StrEnum):
    """
    The call's main result, used for booking and transfer rates.
    """

    booked = "booked"
    changed = "changed"
    cancelled = "cancelled"
    answered = "answered"
    message_taken = "message_taken"
    transferred = "transferred"
    hung_up = "hung_up"
    failed = "failed"


class Speaker(StrEnum):
    caller = "caller"
    agent = "agent"


class TurnLatency(BaseModel):
    """
    Per-stage timings in milliseconds. A stage is null when it wasn't measured.
    """

    eou_ms: int | None
    """
    End of caller speech to end-of-turn decision.
    """
    stt_ms: int | None
    """
    End of caller speech to final transcript.
    """
    llm_ttft_ms: int | None
    """
    LLM time to first token.
    """
    tts_ttfb_ms: int | None
    """
    TTS time to first audio byte.
    """
    total_ms: int | None
    """
    Voice-to-voice, approximately eou_ms + llm_ttft_ms + tts_ttfb_ms.
    """
    llm_model: str | None


class CallLogReceipt(BaseModel):
    id: UUID
    summary: str


class RestaurantSettings(BaseModel):
    id: UUID
    name: str
    phone_number: str = Field(..., examples=["+14155550123"], pattern="^\\+[1-9][0-9]{6,14}$")
    """
    E.164 phone number.
    """
    timezone: str = Field(..., examples=["Asia/Kolkata"])
    """
    IANA timezone.
    """
    currency: str = Field(..., examples=["INR"])
    """
    ISO 4217 code used for menu prices.
    """
    languages: list[str] = Field(..., min_length=1)
    """
    BCP 47 languages the agent may speak, in order of preference.
    """
    greeting: str
    """
    The restaurant's welcome line. The agent adds the AI-assistant disclosure and recording notice itself.
    """
    recording_enabled: bool
    """
    When true the agent tells the caller the call is recorded.
    """
    transfer_number: str | None = Field(..., pattern="^\\+[1-9][0-9]{6,14}$")
    """
    Staff number for transfers. Null means transfers are off and the agent takes a message.
    """
    phone_party_limit: int = Field(..., ge=1)
    """
    Largest party the agent may book. Above it, the agent takes a message for the manager.
    """
    seating_minutes: int = Field(..., ge=15)
    address: str
    """
    Speakable address with a landmark.
    """
    hours_summary: str
    """
    Speakable weekly opening hours.
    """
    policies: list[str]
    """
    Short speakable policy lines.
    """
    open_now: bool
    now: AwareDatetime
    """
    Current time in the restaurant's timezone, with offset.
    """
    calendar: list[CalendarDay]
    """
    The next 14 days starting today, with closures applied. The agent uses it to turn "Saturday" into a date.
    """
    summary: str


class CallTurn(BaseModel):
    index: int = Field(..., ge=0)
    speaker: Speaker
    text: str
    """
    For an interrupted agent turn, only what was actually spoken.
    """
    at: AwareDatetime
    interrupted: bool
    """
    True when the caller talked over this agent turn.
    """
    latency: TurnLatency | None
    """
    Agent turns only; null for caller turns and the greeting.
    """


class CreateCallLogRequest(BaseModel):
    restaurant_id: UUID
    call_id: str = Field(..., max_length=100)
    idempotency_key: UUID
    channel: Channel
    caller_number: str | None = Field(..., pattern="^\\+[1-9][0-9]{6,14}$")
    """
    Null for browser test calls or withheld caller ID.
    """
    dialed_number: str | None = Field(..., pattern="^\\+[1-9][0-9]{6,14}$")
    """
    Null for browser test calls.
    """
    started_at: AwareDatetime
    ended_at: AwareDatetime
    language: str
    """
    BCP 47 language the call was mostly in.
    """
    outcome: Outcome
    """
    The call's main result, used for booking and transfer rates.
    """
    recording_url: AnyUrl | None = None
    turns: list[CallTurn]
