"""Add fictional bookings, manager messages and call logs to the web app, through the contract API.

Everything goes through the same endpoints the agent uses, so table assignment, booking rules and
the double-booking constraint all apply. All of it is fictional: invented names, 555-01xx phone
numbers, and "Dummy data" in the notes, so it can never be mistaken for a real guest.

From agent/, with the web app running and DATA_SOURCE/API_BASE_URL/AGENT_API_KEY set in agent/.env:
    uv run python scripts/add_dummy_data.py           # add
    uv run python scripts/add_dummy_data.py --remove  # cancel every dummy booking again
"""

from __future__ import annotations

import argparse
import asyncio
import os
from datetime import date, datetime, time, timedelta
from uuid import uuid4
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

from agent.api_client import ApiError, HttpRestaurantAPI
from agent.api_client.models import (
    CallTurn,
    CancelReservationRequest,
    CreateCallLogRequest,
    CreateMessageRequest,
    CreateReservationRequest,
    RestaurantSettings,
)
from agent.speakable import speak_time
from agent.tools import new_call_id

NOTE = "Dummy data"

# (name, fictional phone, party size). One phone number per guest, so --remove can find them.
GUESTS = [
    ("Meera Iyer", "+12025550101", 2),
    ("Arjun Nair", "+12025550102", 4),
    ("Kavya Reddy", "+12025550103", 3),
    ("Rahul Menon", "+12025550104", 2),
    ("Sneha Kulkarni", "+12025550105", 5),
    ("Vikram Shetty", "+12025550106", 2),
    ("Ananya Rao", "+12025550107", 6),
    ("Farhan Qureshi", "+12025550108", 4),
    ("Divya Pillai", "+12025550109", 2),
    ("Karthik Bhat", "+12025550110", 3),
]
# Parties for next Saturday at 7 PM that fill every table for 3 or more, so callers asking for a
# Saturday dinner table hear the "taken, here are the nearest times" path.
FULL_SATURDAY = [
    ("Rohit Joshi", "+12025550111", 4),
    ("Pooja Desai", "+12025550112", 4),
    ("Nikhil Gupta", "+12025550113", 6),
    ("Ishita Sen", "+12025550114", 8),
]
DUMMY_PHONES = [phone for _, phone, _ in GUESTS + FULL_SATURDAY]
TIMES = ["12:30", "13:15", "19:00", "19:45", "20:30"]


def open_days(restaurant: RestaurantSettings) -> list[date]:
    """Open days from tomorrow on, from the API's own calendar."""
    return [d.date for d in restaurant.calendar[1:] if d.open]


async def book(api, restaurant, name, phone, party, start, call_id) -> str:
    request = CreateReservationRequest(
        restaurant_id=restaurant.id,
        idempotency_key=uuid4(),
        guest_name=name,
        guest_phone=phone,
        party_size=party,
        start=start,
        notes=NOTE,
        call_id=call_id,
    )
    try:
        res = await api.create_reservation(request)
    except ApiError as e:
        return f"  skipped {name}: {e.code} ({e.say})"
    return f"  booked  {name:<15} {party} people, {start:%a %d %b %H:%M}, code {res.code}"


async def add(api: HttpRestaurantAPI, restaurant: RestaurantSettings) -> None:
    tz = ZoneInfo(restaurant.timezone)
    days = open_days(restaurant)
    print("Bookings across the coming week:")
    calls = []
    for i, (name, phone, party) in enumerate(GUESTS):
        day = days[i % len(days)]
        start = datetime.combine(day, time.fromisoformat(TIMES[i % len(TIMES)]), tz)
        call_id = new_call_id()
        print(await book(api, restaurant, name, phone, party, start, call_id))
        if i < 3:
            calls.append((call_id, name, party, start))

    saturday = next(d for d in days if d.weekday() == 5)
    print(f"Saturday {saturday:%d %b} 7 PM, full for parties of 3 or more:")
    for name, phone, party in FULL_SATURDAY:
        start = datetime.combine(saturday, time(19), tz)
        print(await book(api, restaurant, name, phone, party, start, new_call_id()))

    print("Manager messages:")
    for name, phone, topic, details in [
        (
            "Aditya Verma",
            "+12025550115",
            "large_party",
            "Office dinner for 18 next Friday around 8 PM; wants a set menu.",
        ),
        ("Neha Kapoor", "+12025550116", "catering", "Catering for 40 at a home event on Sunday afternoon."),
        (
            "Siddharth Jain",
            "+12025550117",
            "event",
            "Asked about booking the whole restaurant for an anniversary.",
        ),
    ]:
        receipt = await api.create_message(
            CreateMessageRequest(
                restaurant_id=restaurant.id,
                idempotency_key=uuid4(),
                caller_name=name,
                caller_phone=phone,
                topic=topic,
                details=f"{details} ({NOTE})",
                call_id=new_call_id(),
            )
        )
        print(f"  message from {name}: {receipt.summary}")

    print("Call logs for the first three bookings (same call_id as the booking):")
    now = datetime.now(tz)
    for call_id, name, party, start in calls:
        when = f"{start:%A} at {speak_time(start)}"
        lines = [
            (
                "agent",
                f"Thanks for calling {restaurant.name}. I'm the restaurant's AI assistant. How can I help?",
            ),
            ("caller", f"Hi, I'd like a table for {party} on {when}."),
            ("agent", f"That's free. Can I take a name? ({NOTE})"),
            ("caller", f"It's {name}."),
            ("agent", "You're booked. Thanks for calling, goodbye!"),
        ]
        turns = [
            CallTurn(
                index=i,
                speaker=s,
                text=t,
                at=now - timedelta(minutes=5) + timedelta(seconds=10 * i),
                interrupted=False,
                latency=None,
            )
            for i, (s, t) in enumerate(lines)
        ]
        receipt = await api.create_call_log(
            CreateCallLogRequest(
                restaurant_id=restaurant.id,
                call_id=call_id,
                idempotency_key=uuid4(),
                channel="browser",
                caller_number=None,
                dialed_number=None,
                started_at=now - timedelta(minutes=5),
                ended_at=now - timedelta(minutes=4),
                language="en",
                outcome="booked",
                recording_url=None,
                turns=turns,
            )
        )
        print(f"  call {call_id} ({name}): {receipt.summary}")


async def remove(api: HttpRestaurantAPI, restaurant: RestaurantSettings) -> None:
    cancelled = 0
    for phone in DUMMY_PHONES:
        found = await api.find_reservations(restaurant.id, phone=phone)
        for res in found.reservations:
            await api.cancel_reservation(
                res.id, CancelReservationRequest(idempotency_key=uuid4(), guest_phone=phone)
            )
            cancelled += 1
    print(f"Cancelled {cancelled} dummy bookings. Messages and call logs stay; they're marked '{NOTE}'.")


async def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--remove", action="store_true", help="cancel every dummy booking")
    args = parser.parse_args()
    load_dotenv()
    api = HttpRestaurantAPI(os.environ["API_BASE_URL"], os.environ["AGENT_API_KEY"], timeout=30)
    try:
        restaurant = await api.get_restaurant_by_number(os.getenv("DEFAULT_RESTAURANT_PHONE", "+14155550123"))
        await (remove if args.remove else add)(api, restaurant)
    finally:
        await api.aclose()


if __name__ == "__main__":
    asyncio.run(main())
