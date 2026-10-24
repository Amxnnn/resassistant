"""In-memory stand-in for the web tool API, used until web/ is deployed (DATA_SOURCE=sample).

It follows contracts/openapi.yaml: the same models, error codes and speakable summaries, and the
brief's booking rules (smallest free table, 15-minute slots, last seating, closures, phone party
limit, no double-booking). Bookings and messages are saved to a local JSON file so a booking made
in one test call can be changed or cancelled in the next. All data is fictional.
"""

from __future__ import annotations

import json
import random
from collections.abc import Callable
from datetime import date, datetime, time, timedelta
from pathlib import Path
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from ..speakable import speak_day, speak_time
from .client import ApiError
from .models import (
    Availability,
    CalendarDay,
    CallLogReceipt,
    CancelReservationRequest,
    CreateCallLogRequest,
    CreateMessageRequest,
    CreateReservationRequest,
    InfoAnswer,
    MenuItem,
    MenuSearchResult,
    MessageReceipt,
    Reservation,
    ReservationList,
    RestaurantSettings,
    Slot,
    UpdateReservationRequest,
)

RESTAURANT_ID = UUID("6f1c2a9e-3b7d-4c5a-9e2f-1a8b7c6d5e4f")
RESTAURANT_PHONE = "+14155550123"
TZ = ZoneInfo("Asia/Kolkata")
PHONE_PARTY_LIMIT = 8
SLOT_STEP = timedelta(minutes=15)
BOOKING_WINDOW_DAYS = 60
LARGE_PARTY_FROM = 7  # parties this big get a longer seating

# (opens, closes, last seating), Tuesday to Sunday. Monday is the weekly day off.
SERVICES = [(time(12), time(15), time(14, 15)), (time(18), time(23), time(21, 30))]
CLOSED_WEEKDAYS = {0}
TABLES = {"T1": 2, "T2": 2, "T3": 4, "T4": 4, "T5": 4, "T6": 6, "T7": 8}
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no 0/O or 1/I, which sound alike

SETTINGS = {
    "id": RESTAURANT_ID,
    "name": "The Saffron Table",
    "phone_number": RESTAURANT_PHONE,
    "timezone": "Asia/Kolkata",
    "currency": "INR",
    "languages": ["en"],
    "greeting": "Thanks for calling The Saffron Table.",
    "recording_enabled": True,
    "transfer_number": "+14155550199",
    "phone_party_limit": PHONE_PARTY_LIMIT,
    "seating_minutes": 90,
    "address": "12 Residency Road, near the Brigade Road junction.",
    "hours_summary": "Open Tuesday to Sunday, 12 to 3 PM and 6 to 11 PM. Closed on Mondays.",
    "policies": [
        "We hold tables for 15 minutes past the booking time.",
        "Parties of more than 8 are booked by the manager.",
    ],
}

INFO = {
    "location": "We're at 12 Residency Road, near the Brigade Road junction.",
    "parking": "There's free valet parking at the entrance from 6 PM, and a paid public lot two "
    "minutes' walk away on Museum Road.",
    "delivery": "You can order our food on Swiggy and Zomato.",
    "specials": "Today's special is Malai Kofta, 460 rupees, and mango lassi is two for one until 7 PM.",
}

# name, category, price, dietary tags, spice, allergens (None = not listed), available today, description
MENU = [
    ("Paneer Tikka", "Starters", 380, ["vegetarian", "gluten_free"], "mild", ["dairy"], True,
     "Chargrilled cottage cheese with peppers."),
    ("Hara Bhara Kebab", "Starters", 320, ["vegetarian", "vegan"], "mild", [], True,
     "Spinach, pea and potato patties."),
    ("Chicken 65", "Starters", 420, ["gluten_free"], "hot", [], True,
     "Crispy fried chicken with curry leaves."),
    ("Samosa", "Starters", 180, ["vegetarian", "vegan"], "mild", ["gluten"], True,
     "Two pastries filled with spiced potato."),
    ("Butter Chicken", "Mains", 520, ["gluten_free"], "mild", ["dairy", "nuts"], True,
     "Tandoori chicken in a creamy tomato sauce."),
    ("Navratan Korma", "Mains", 450, ["vegetarian", "gluten_free"], "mild", ["dairy", "nuts"], True,
     "Mixed vegetables in a cashew cream sauce."),
    ("Chana Masala", "Mains", 350, ["vegetarian", "vegan", "gluten_free"], "medium", [], True,
     "Chickpeas in an onion and tomato gravy."),
    ("Aloo Gobi", "Mains", 320, ["vegetarian", "vegan"], "mild", None, True,
     "Potato and cauliflower with cumin and turmeric."),
    ("Dal Makhani", "Mains", 380, ["vegetarian", "gluten_free"], "mild", ["dairy"], True,
     "Black lentils slow-cooked with butter and cream."),
    ("Palak Paneer", "Mains", 420, ["vegetarian", "gluten_free"], "mild", ["dairy"], True,
     "Cottage cheese in a spinach gravy."),
    ("Baingan Bharta", "Mains", 360, ["vegetarian", "vegan", "gluten_free"], "medium", None, True,
     "Smoky mashed aubergine with onion and tomato."),
    ("Lamb Rogan Josh", "Mains", 620, ["gluten_free"], "hot", ["dairy"], False,
     "Kashmiri lamb curry with yoghurt and red chilli."),
    ("Butter Naan", "Breads", 90, ["vegetarian"], None, ["gluten", "dairy"], True,
     "Tandoor-baked flatbread."),
    ("Tandoori Roti", "Breads", 60, ["vegetarian", "vegan"], None, ["gluten"], True, "Wholewheat flatbread."),
    ("Jeera Rice", "Rice", 220, ["vegetarian", "vegan", "gluten_free"], None, [], True,
     "Basmati rice with cumin."),
    ("Veg Biryani", "Rice", 420, ["vegetarian", "gluten_free"], "medium", ["dairy", "nuts"], True,
     "Layered basmati rice with vegetables and saffron."),
    ("Gulab Jamun", "Desserts", 180, ["vegetarian"], None, ["dairy", "gluten"], True,
     "Milk dumplings in rose syrup."),
    ("Mango Kulfi", "Desserts", 200, ["vegetarian", "gluten_free"], None, ["dairy", "nuts"], True,
     "Frozen mango and pistachio cream."),
]  # fmt: skip


def _join(items: list[str]) -> str:
    return items[0] if len(items) == 1 else f"{', '.join(items[:-1])} or {items[-1]}"


def _menu_items() -> list[MenuItem]:
    items = []
    for i, (name, category, price, tags, spice, allergens, available, description) in enumerate(MENU):
        items.append(
            MenuItem(
                id=UUID(int=i + 1),
                name=name,
                category=category,
                description=description,
                price=price,
                currency="INR",
                dietary_tags=tags,
                spice_level=spice,
                allergens_listed=allergens is not None,
                allergens=allergens or [],
                available_today=available,
            )
        )
    return items


class SampleRestaurantAPI:
    def __init__(
        self,
        *,
        now: Callable[[], datetime] | None = None,
        state_file: str | Path | None = None,
    ) -> None:
        self._now = now or (lambda: datetime.now(TZ))
        self._state_file = Path(state_file) if state_file else None
        self._menu = _menu_items()
        today = self._today()
        self._closures = {today + timedelta(days=10): "for a private event"}
        self._reservations: dict[UUID, Reservation] = {}
        self._tables: dict[UUID, str] = {}
        self._messages: list[CreateMessageRequest] = []
        self._calls: list[CreateCallLogRequest] = []
        self._replays: dict[UUID, Reservation | MessageReceipt | CallLogReceipt] = {}
        if not self._load():
            self._seed(today)

    # -- state -------------------------------------------------------------------------------

    def _today(self) -> date:
        return self._now().astimezone(TZ).date()

    def _seed(self, today: date) -> None:
        """A full Saturday dinner for parties of 3+, and one booking callers can test changes on."""
        saturday = today + timedelta(days=(5 - today.weekday()) % 7 or 7)
        start = datetime.combine(saturday, time(19), TZ)
        for label in ("T3", "T4", "T5", "T6", "T7"):
            self._store(
                Reservation(
                    id=uuid4(),
                    code=self._new_code(),
                    restaurant_id=RESTAURANT_ID,
                    guest_name="Walk-in group",
                    guest_phone="+12025550100",
                    party_size=TABLES[label],
                    start=start,
                    end=start + self._seating(TABLES[label]),
                    status="confirmed",
                    notes=None,
                    summary="Sample booking",
                ),
                label,
            )
        sunday_lunch = datetime.combine(saturday + timedelta(days=1), time(13), TZ)
        self._store(
            Reservation(
                id=uuid4(),
                code="K7Q2",
                restaurant_id=RESTAURANT_ID,
                guest_name="Asha Rao",
                guest_phone="+12025550147",
                party_size=2,
                start=sunday_lunch,
                end=sunday_lunch + self._seating(2),
                status="confirmed",
                notes=None,
                summary=f"Table for 2, {self._label(sunday_lunch)}, code K7Q2.",
            ),
            "T1",
        )

    def _store(self, res: Reservation, table: str) -> None:
        self._reservations[res.id] = res
        self._tables[res.id] = table
        self._save()

    def _load(self) -> bool:
        if not self._state_file or not self._state_file.exists():
            return False
        data = json.loads(self._state_file.read_text(encoding="utf-8"))
        for row in data["reservations"]:
            res = Reservation.model_validate(row["reservation"])
            self._reservations[res.id] = res
            self._tables[res.id] = row["table"]
        self._messages = [CreateMessageRequest.model_validate(m) for m in data.get("messages", [])]
        return True

    def _save(self) -> None:
        if not self._state_file:
            return
        data = {
            "reservations": [
                {"reservation": r.model_dump(mode="json"), "table": self._tables[r.id]}
                for r in self._reservations.values()
            ],
            "messages": [m.model_dump(mode="json") for m in self._messages],
        }
        self._state_file.write_text(json.dumps(data, indent=2), encoding="utf-8")

    def _new_code(self) -> str:
        taken = {r.code for r in self._reservations.values()}
        while (code := "".join(random.choices(CODE_ALPHABET, k=4))) in taken:
            pass
        return code

    # -- booking rules -----------------------------------------------------------------------

    def _services(self, day: date) -> list[tuple[datetime, datetime, datetime]]:
        if day.weekday() in CLOSED_WEEKDAYS or day in self._closures:
            return []
        return [
            (datetime.combine(day, o, TZ), datetime.combine(day, c, TZ), datetime.combine(day, last, TZ))
            for o, c, last in SERVICES
        ]

    def _slot_starts(self, day: date) -> list[datetime]:
        starts = []
        for opens, _closes, last in self._services(day):
            t = opens
            while t <= last:
                starts.append(t)
                t += SLOT_STEP
        return starts

    @staticmethod
    def _seating(party_size: int) -> timedelta:
        return timedelta(minutes=120 if party_size >= LARGE_PARTY_FROM else 90)

    def _free_table(self, start: datetime, party_size: int, *, ignore: UUID | None = None) -> str | None:
        """Smallest table that fits and has no overlapping confirmed booking."""
        end = start + self._seating(party_size)
        busy = {
            self._tables[r.id]
            for r in self._reservations.values()
            if r.status == "confirmed" and r.id != ignore and r.start < end and start < r.end
        }
        for label, capacity in sorted(TABLES.items(), key=lambda kv: kv[1]):
            if capacity >= party_size and label not in busy:
                return label
        return None

    def _label(self, start: datetime) -> str:
        return f"{speak_day(start.date(), self._today())} at {speak_time(start)}"

    def _check_rules(self, start: datetime, party_size: int) -> None:
        """Raise the contract's 422 errors for a requested start time."""
        today = self._today()
        if party_size > PHONE_PARTY_LIMIT:
            raise ApiError(
                "party_too_large",
                f"For more than {PHONE_PARTY_LIMIT} guests the manager arranges the booking. "
                "I can take your details and have them call you back.",
                422,
            )
        if start < self._now():
            raise ApiError(
                "in_the_past", "That time has already passed. What other time would suit you?", 422
            )
        if start.date() > today + timedelta(days=BOOKING_WINDOW_DAYS):
            raise ApiError("too_far_ahead", f"We take bookings up to {BOOKING_WINDOW_DAYS} days ahead.", 422)
        if not self._services(start.date()):
            reason = self._closures.get(start.date())
            closed = f"closed on {speak_day(start.date(), today)} {reason}" if reason else "closed on Mondays"
            raise ApiError("closed", f"Sorry, we're {closed}. Would another day work?", 422)
        if start not in self._slot_starts(start.date()):
            raise ApiError(
                "outside_hours",
                "We take bookings from 12 to 2:15 PM and from 6 to 9:30 PM, every 15 minutes.",
                422,
            )

    def _alternatives(
        self, start: datetime, party_size: int, *, ignore: UUID | None = None
    ) -> list[datetime]:
        now = self._now()
        free = [
            s
            for s in self._slot_starts(start.date())
            if s > now and s != start and self._free_table(s, party_size, ignore=ignore)
        ]
        return sorted(sorted(free, key=lambda s: abs(s - start))[:3])

    def _full_say(self, start: datetime, party_size: int, alternatives: list[datetime]) -> str:
        if not alternatives:
            day = speak_day(start.date(), self._today())
            return f"Sorry, we're fully booked for {party_size} {day}. Would another day work?"
        times = _join([speak_time(s) for s in alternatives])
        return f"Sorry, {speak_time(start)} is taken for {party_size}. I can do {times}."

    def _require_restaurant(self, restaurant_id: UUID) -> None:
        if restaurant_id != RESTAURANT_ID:
            raise ApiError("not_found", "Sorry, I couldn't find that restaurant.", 404)

    def _require_owner(self, res: Reservation, phone: str | None, code: str | None) -> None:
        if (phone and phone == res.guest_phone) or (code and code.upper() == res.code):
            return
        raise ApiError(
            "not_your_reservation",
            "I can only change bookings made with this phone number or its booking code.",
            403,
        )

    # -- endpoints ---------------------------------------------------------------------------

    async def get_restaurant_by_number(self, phone: str) -> RestaurantSettings:
        if phone.replace(" ", "") != RESTAURANT_PHONE:
            raise ApiError("not_found", "Sorry, this number isn't set up yet.", 404)
        now = self._now().astimezone(TZ)
        today = now.date()
        calendar = []
        for offset in range(14):
            day = today + timedelta(days=offset)
            services = self._services(day)
            note = None
            if not services:
                reason = self._closures.get(day)
                note = f"Closed {reason}" if reason else "Closed on Mondays"
            calendar.append(
                CalendarDay(
                    date=day,
                    weekday=f"{day:%A}",
                    open=bool(services),
                    hours=" and ".join(f"{speak_time(o)} to {speak_time(c)}" for o, c, _ in services) or None,
                    last_seating=f"{services[-1][2]:%H:%M}" if services else None,
                    note=note,
                )
            )
        open_now = any(o <= now < c for o, c, _ in self._services(today))
        upcoming = [o for o, _c, _l in self._services(today) if o > now]
        if open_now:
            summary = f"{SETTINGS['name']} is open now."
        elif upcoming:
            summary = f"{SETTINGS['name']} is closed right now and opens at {speak_time(upcoming[0])} today."
        else:
            summary = f"{SETTINGS['name']} is closed for the rest of today."
        return RestaurantSettings(**SETTINGS, open_now=open_now, now=now, calendar=calendar, summary=summary)

    async def get_info(self, restaurant_id: UUID, topic: str, language: str = "en") -> InfoAnswer:
        self._require_restaurant(restaurant_id)
        answers = {**INFO, "hours": SETTINGS["hours_summary"], "policies": " ".join(SETTINGS["policies"])}
        if topic not in answers:
            raise ApiError("invalid_request", "Sorry, I don't have information on that.", 400)
        return InfoAnswer(topic=topic, summary=answers[topic])

    async def search_menu(
        self,
        restaurant_id: UUID,
        query: str | None = None,
        dietary: list[str] | None = None,
        limit: int = 5,
    ) -> MenuSearchResult:
        self._require_restaurant(restaurant_id)
        words = [w for w in (query or "").lower().replace(",", " ").split() if len(w) > 2]
        matches = []
        for item in self._menu:
            text = f"{item.name} {item.category} {item.description}".lower()
            if words and not any(w.rstrip("s") in text for w in words):
                continue
            if dietary and not all(tag in item.dietary_tags for tag in dietary):
                continue
            matches.append(item)
        matches = matches[:limit]
        if not matches:
            return MenuSearchResult(items=[], summary="I couldn't find anything like that on our menu.")
        parts = []
        for item in matches:
            spice = f", {item.spice_level} spicy" if item.spice_level and item.spice_level != "none" else ""
            unavailable = " (not available today)" if not item.available_today else ""
            parts.append(f"{item.name}, {item.price:g} rupees{spice}{unavailable}")
        return MenuSearchResult(items=matches, summary=". ".join(parts) + ".")

    async def check_availability(
        self, restaurant_id: UUID, day: date, time: str, party_size: int
    ) -> Availability:
        self._require_restaurant(restaurant_id)
        start = _parse_start(day, time)
        self._check_rules(start, party_size)
        if self._free_table(start, party_size):
            slots = [Slot(start=start, label=self._label(start))]
            summary = f"{self._label(start)} is available for {party_size}."
            return Availability(
                date=day,
                time=time,
                party_size=party_size,
                requested_time_available=True,
                slots=slots,
                summary=summary,
            )
        alternatives = self._alternatives(start, party_size)
        return Availability(
            date=day,
            time=time,
            party_size=party_size,
            requested_time_available=False,
            slots=[Slot(start=s, label=self._label(s)) for s in alternatives],
            summary=self._full_say(start, party_size, alternatives),
        )

    async def create_reservation(self, req: CreateReservationRequest) -> Reservation:
        if req.idempotency_key in self._replays:
            return self._replays[req.idempotency_key]  # type: ignore[return-value]
        self._require_restaurant(req.restaurant_id)
        start = req.start.astimezone(TZ)
        self._check_rules(start, req.party_size)
        table = self._free_table(start, req.party_size)
        if table is None:
            raise ApiError(
                "slot_taken",
                self._full_say(start, req.party_size, self._alternatives(start, req.party_size)),
                409,
            )
        code = self._new_code()
        res = Reservation(
            id=uuid4(),
            code=code,
            restaurant_id=req.restaurant_id,
            guest_name=req.guest_name,
            guest_phone=req.guest_phone,
            party_size=req.party_size,
            start=start,
            end=start + self._seating(req.party_size),
            status="confirmed",
            notes=req.notes,
            summary=f"Table for {req.party_size}, {self._label(start)}, code {code}.",
        )
        self._store(res, table)
        self._replays[req.idempotency_key] = res
        return res

    async def find_reservations(
        self, restaurant_id: UUID, phone: str | None = None, code: str | None = None
    ) -> ReservationList:
        self._require_restaurant(restaurant_id)
        if not phone and not code:
            raise ApiError("invalid_request", "Could you give me the booking code or the phone number?", 400)
        now = self._now()
        found = [
            r
            for r in sorted(self._reservations.values(), key=lambda r: r.start)
            if r.status == "confirmed"
            and r.start >= now
            and ((phone and r.guest_phone == phone) or (code and r.code == code.upper()))
        ]
        if not found:
            summary = "I couldn't find any upcoming bookings for that."
        elif len(found) == 1:
            summary = f"You have one booking: {found[0].summary}"
        else:
            summary = f"You have {len(found)} bookings: " + " ".join(r.summary for r in found)
        return ReservationList(reservations=found, summary=summary)

    async def update_reservation(self, reservation_id: UUID, req: UpdateReservationRequest) -> Reservation:
        res = self._get(reservation_id)
        self._require_owner(res, req.guest_phone, req.code)
        if res.status != "confirmed":
            raise ApiError("already_cancelled", "That booking was cancelled, so I can't change it.", 409)
        start = (req.start or res.start).astimezone(TZ)
        party_size = req.party_size or res.party_size
        self._check_rules(start, party_size)
        table = self._free_table(start, party_size, ignore=res.id)
        if table is None:
            alternatives = self._alternatives(start, party_size, ignore=res.id)
            raise ApiError("slot_taken", self._full_say(start, party_size, alternatives), 409)
        updated = res.model_copy(
            update={
                "start": start,
                "end": start + self._seating(party_size),
                "party_size": party_size,
                "notes": req.notes if req.notes is not None else res.notes,
                "summary": f"Table for {party_size}, {self._label(start)}, code {res.code}.",
            }
        )
        self._store(updated, table)
        return updated

    async def cancel_reservation(self, reservation_id: UUID, req: CancelReservationRequest) -> Reservation:
        if req.idempotency_key in self._replays:
            return self._replays[req.idempotency_key]  # type: ignore[return-value]
        res = self._get(reservation_id)
        self._require_owner(res, req.guest_phone, req.code)
        if res.status != "confirmed":
            raise ApiError("already_cancelled", "That booking was already cancelled.", 409)
        cancelled = res.model_copy(
            update={
                "status": "cancelled",
                "summary": f"Your table for {res.party_size} {self._label(res.start)} is cancelled.",
            }
        )
        self._store(cancelled, self._tables[res.id])
        self._replays[req.idempotency_key] = cancelled
        return cancelled

    async def create_message(self, req: CreateMessageRequest) -> MessageReceipt:
        if req.idempotency_key in self._replays:
            return self._replays[req.idempotency_key]  # type: ignore[return-value]
        self._require_restaurant(req.restaurant_id)
        self._messages.append(req)
        self._save()
        receipt = MessageReceipt(
            id=uuid4(), summary="I've passed that to the manager, who will call you back."
        )
        self._replays[req.idempotency_key] = receipt
        return receipt

    async def create_call_log(self, req: CreateCallLogRequest) -> CallLogReceipt:
        if req.idempotency_key in self._replays:
            return self._replays[req.idempotency_key]  # type: ignore[return-value]
        self._calls.append(req)
        receipt = CallLogReceipt(id=uuid4(), summary="Call saved.")
        self._replays[req.idempotency_key] = receipt
        return receipt

    async def aclose(self) -> None:
        pass

    def _get(self, reservation_id: UUID) -> Reservation:
        if reservation_id not in self._reservations:
            raise ApiError("not_found", "I couldn't find that booking. Do you have the booking code?", 404)
        return self._reservations[reservation_id]

    @property
    def messages(self) -> list[CreateMessageRequest]:
        return list(self._messages)


def _parse_start(day: date, hhmm: str) -> datetime:
    try:
        return datetime.combine(day, time.fromisoformat(hhmm), TZ)
    except ValueError:
        raise ApiError(
            "invalid_request", "Sorry, I didn't catch the time. Could you say it again?", 400
        ) from None
