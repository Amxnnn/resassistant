"""Every contract endpoint, called the way the agent calls it, against the real web/ API."""

import contextlib
from datetime import datetime, time
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest

from agent.api_client import ApiError, HttpRestaurantAPI
from agent.api_client.models import (
    CallTurn,
    CancelReservationRequest,
    CreateCallLogRequest,
    CreateMessageRequest,
    CreateReservationRequest,
    UpdateReservationRequest,
)

from .conftest import BASE_URL

TEST_PHONE = "+12025550188"  # fictional 555-01xx number used only by these tests


def at(day, hhmm: str, tz: str):
    return datetime.combine(day, time.fromisoformat(hhmm), ZoneInfo(tz))


def booking(restaurant, day, hhmm: str, party_size: int, key=None) -> CreateReservationRequest:
    return CreateReservationRequest(
        restaurant_id=restaurant.id,
        idempotency_key=key or uuid4(),
        guest_name="Integration Test",
        guest_phone=TEST_PHONE,
        party_size=party_size,
        start=at(day, hhmm, restaurant.timezone),
        notes="Created by agent/integration tests",
        call_id="integration-test",
    )


async def cancel_quietly(api, res) -> None:
    with contextlib.suppress(ApiError):
        await api.cancel_reservation(res.id, CancelReservationRequest(idempotency_key=uuid4(), code=res.code))


async def test_wrong_key_is_rejected_in_the_contract_error_shape():
    client = HttpRestaurantAPI(BASE_URL, "wrong-key")
    with pytest.raises(ApiError) as err:
        await client.get_restaurant_by_number("+14155550123")
    await client.aclose()
    assert (err.value.code, err.value.status) == ("unauthorized", 401)
    assert err.value.say


async def test_settings_match_what_the_agent_needs(restaurant):
    assert restaurant.name and restaurant.greeting and restaurant.timezone
    assert len(restaurant.calendar) == 14
    assert restaurant.now.utcoffset() is not None
    monday = next(d for d in restaurant.calendar if d.weekday == "Monday")
    assert not monday.open and monday.note


async def test_unknown_number_is_not_found(api):
    with pytest.raises(ApiError) as err:
        await api.get_restaurant_by_number("+10000000000")
    assert (err.value.code, err.value.status) == ("not_found", 404)


@pytest.mark.parametrize("topic", ["hours", "location", "parking", "delivery", "specials", "policies"])
async def test_every_info_topic_has_a_spoken_answer(api, restaurant, topic):
    answer = await api.get_info(restaurant.id, topic)
    assert answer.topic == topic and answer.summary


async def test_menu_search_and_dietary_filters(api, restaurant):
    vegan = await api.search_menu(restaurant.id, dietary=["vegan"], limit=20)
    assert vegan.items and all("vegan" in i.dietary_tags for i in vegan.items)
    by_name = await api.search_menu(restaurant.id, query=vegan.items[0].name)
    assert vegan.items[0].name in [i.name for i in by_name.items]
    assert by_name.summary


async def test_availability_rules(api, restaurant, open_day, closed_day):
    free = await api.check_availability(restaurant.id, open_day, "19:30", 2)
    assert free.requested_time_available
    assert free.slots[0].start == at(open_day, "19:30", restaurant.timezone)

    for day, hhmm, party, code in [
        (open_day, "19:30", restaurant.phone_party_limit + 1, "party_too_large"),
        (closed_day, "19:30", 2, "closed"),
        (open_day, "16:00", 2, "outside_hours"),
    ]:
        with pytest.raises(ApiError) as err:
            await api.check_availability(restaurant.id, day, hhmm, party)
        assert (err.value.code, err.value.status) == (code, 422), (day, hhmm, party)
        assert err.value.say


async def test_booking_lifecycle_across_routes(api, restaurant, open_day):
    """Create, replay, find, change, cancel: each step is a different route on the web side."""
    request = booking(restaurant, open_day, "19:00", 2)
    created = await api.create_reservation(request)
    try:
        assert created.status == "confirmed" and created.summary
        assert created.start == request.start

        replay = await api.create_reservation(request)
        assert replay.id == created.id  # idempotent: no second booking

        by_phone = await api.find_reservations(restaurant.id, phone=TEST_PHONE)
        assert created.id in [r.id for r in by_phone.reservations]
        by_code = await api.find_reservations(restaurant.id, code=created.code)
        assert [r.id for r in by_code.reservations] == [created.id]

        with pytest.raises(ApiError) as err:
            await api.update_reservation(
                created.id, UpdateReservationRequest(guest_phone="+12025550199", party_size=3)
            )
        assert err.value.code == "not_your_reservation"

        moved = await api.update_reservation(
            created.id,
            UpdateReservationRequest(
                code=created.code, start=at(open_day, "20:00", restaurant.timezone), party_size=3
            ),
        )
        assert moved.id == created.id and moved.party_size == 3
        assert moved.start == at(open_day, "20:00", restaurant.timezone)

        cancel = CancelReservationRequest(idempotency_key=uuid4(), guest_phone=TEST_PHONE)
        cancelled = await api.cancel_reservation(created.id, cancel)
        assert cancelled.status == "cancelled"
        assert (await api.cancel_reservation(created.id, cancel)).status == "cancelled"  # replay
        with pytest.raises(ApiError) as err:
            await api.cancel_reservation(
                created.id, CancelReservationRequest(idempotency_key=uuid4(), code=created.code)
            )
        assert err.value.code == "already_cancelled"

        after = await api.find_reservations(restaurant.id, code=created.code)
        assert created.id not in [r.id for r in after.reservations]
    finally:
        await cancel_quietly(api, created)


async def test_the_same_table_cannot_be_double_booked(api, restaurant, open_day):
    """Book every table that fits the largest party, then one more must be refused with slot_taken."""
    party = restaurant.phone_party_limit
    made = []
    try:
        with pytest.raises(ApiError) as err:
            for _ in range(10):
                made.append(await api.create_reservation(booking(restaurant, open_day, "20:30", party)))
        assert (err.value.code, err.value.status) == ("slot_taken", 409)
        assert err.value.say
        assert made, "expected at least one table big enough for the phone party limit"
    finally:
        for res in made:
            await cancel_quietly(api, res)


async def test_message_and_call_log_are_saved_idempotently(api, restaurant):
    message = CreateMessageRequest(
        restaurant_id=restaurant.id,
        idempotency_key=uuid4(),
        caller_name="Integration Test",
        caller_phone=TEST_PHONE,
        topic="large_party",
        details="Integration test message: party of 12 next Friday.",
        call_id="integration-test",
    )
    first = await api.create_message(message)
    assert first.summary and (await api.create_message(message)).id == first.id

    now = datetime.now(ZoneInfo(restaurant.timezone))
    log = CreateCallLogRequest(
        restaurant_id=restaurant.id,
        call_id=f"integration-{uuid4().hex[:8]}",
        idempotency_key=uuid4(),
        channel="browser",
        caller_number=None,
        dialed_number=None,
        started_at=now,
        ended_at=now,
        language="en",
        outcome="answered",
        recording_url=None,
        turns=[
            CallTurn(
                index=0,
                speaker="agent",
                text="Integration test greeting.",
                at=now,
                interrupted=False,
                latency=None,
            )
        ],
    )
    receipt = await api.create_call_log(log)
    assert receipt.summary and (await api.create_call_log(log)).id == receipt.id
