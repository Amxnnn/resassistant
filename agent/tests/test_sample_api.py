from datetime import date, datetime
from uuid import uuid4

import pytest

from agent.api_client import ApiError, SampleRestaurantAPI
from agent.api_client.models import (
    CancelReservationRequest,
    CreateReservationRequest,
    UpdateReservationRequest,
)
from agent.api_client.sample import RESTAURANT_ID, TZ

from .conftest import NOW

TUESDAY = date(2026, 10, 27)
FULL_SATURDAY = date(2026, 10, 31)


def booking(day: date, hhmm: str, party_size: int, phone: str = "+919876543210") -> CreateReservationRequest:
    hour, minute = map(int, hhmm.split(":"))
    return CreateReservationRequest(
        restaurant_id=RESTAURANT_ID,
        idempotency_key=uuid4(),
        guest_name="Test Guest",
        guest_phone=phone,
        party_size=party_size,
        start=datetime(day.year, day.month, day.day, hour, minute, tzinfo=TZ),
    )


async def test_settings_calendar_shows_closures_and_today(restaurant):
    days = {d.date: d for d in restaurant.calendar}
    assert len(restaurant.calendar) == 14
    assert restaurant.calendar[0].date == NOW.date()
    assert not days[date(2026, 10, 26)].open and days[date(2026, 10, 26)].note == "Closed on Mondays"
    assert not days[date(2026, 11, 3)].open and "private event" in days[date(2026, 11, 3)].note
    assert days[TUESDAY].hours == "12 PM to 3 PM and 6 PM to 11 PM"
    assert restaurant.summary.endswith("opens at 6 PM today.")


async def test_free_time_is_offered_back_as_the_only_slot(api):
    result = await api.check_availability(RESTAURANT_ID, TUESDAY, "19:30", 4)
    assert result.requested_time_available
    assert [s.label for s in result.slots] == ["Tuesday 27 October at 7:30 PM"]


async def test_full_time_offers_the_three_closest_open_times(api):
    result = await api.check_availability(RESTAURANT_ID, FULL_SATURDAY, "19:30", 4)
    assert not result.requested_time_available
    assert [f"{s.start:%H:%M}" for s in result.slots] == ["20:30", "20:45", "21:00"]
    assert result.summary == "Sorry, 7:30 PM is taken for 4. I can do 8:30 PM, 8:45 PM or 9 PM."


async def test_small_party_still_fits_on_the_full_evening(api):
    result = await api.check_availability(RESTAURANT_ID, FULL_SATURDAY, "19:30", 2)
    assert result.requested_time_available


@pytest.mark.parametrize(
    ("day", "hhmm", "party", "code"),
    [
        (TUESDAY, "19:30", 9, "party_too_large"),
        (date(2026, 10, 26), "19:30", 2, "closed"),
        (date(2026, 11, 3), "19:30", 2, "closed"),
        (TUESDAY, "16:00", 2, "outside_hours"),
        (TUESDAY, "21:45", 2, "outside_hours"),
        (NOW.date(), "12:00", 2, "in_the_past"),
        (date(2027, 3, 1), "19:30", 2, "too_far_ahead"),
    ],
)
async def test_booking_rules_return_the_contract_error_codes(api, day, hhmm, party, code):
    with pytest.raises(ApiError) as err:
        await api.check_availability(RESTAURANT_ID, day, hhmm, party)
    assert err.value.code == code
    assert err.value.status == 422
    assert err.value.say


async def test_booking_takes_the_smallest_table_and_blocks_double_booking(api):
    first = await api.create_reservation(booking(TUESDAY, "19:30", 8))
    assert first.status == "confirmed"
    assert first.summary == f"Table for 8, Tuesday 27 October at 7:30 PM, code {first.code}."
    with pytest.raises(ApiError) as err:
        await api.create_reservation(booking(TUESDAY, "20:00", 7))  # the only 8-top is taken
    assert err.value.code == "slot_taken" and err.value.status == 409


async def test_replaying_an_idempotency_key_returns_the_same_booking(api):
    request = booking(TUESDAY, "19:30", 2)
    assert (await api.create_reservation(request)).id == (await api.create_reservation(request)).id


async def test_find_change_and_cancel_check_ownership(api):
    res = await api.create_reservation(booking(TUESDAY, "19:30", 2, phone="+919876543210"))
    found = await api.find_reservations(RESTAURANT_ID, phone="+919876543210")
    assert [r.id for r in found.reservations] == [res.id]
    assert (await api.find_reservations(RESTAURANT_ID, code=res.code.lower())).reservations

    with pytest.raises(ApiError) as err:
        await api.update_reservation(
            res.id, UpdateReservationRequest(guest_phone="+911111111111", party_size=3)
        )
    assert err.value.code == "not_your_reservation"

    moved = await api.update_reservation(
        res.id, UpdateReservationRequest(code=res.code, start=datetime(2026, 10, 27, 20, 0, tzinfo=TZ))
    )
    assert f"{moved.start:%H:%M}" == "20:00" and moved.code == res.code

    cancel = CancelReservationRequest(idempotency_key=uuid4(), guest_phone="+919876543210")
    assert (await api.cancel_reservation(res.id, cancel)).status == "cancelled"
    assert (await api.cancel_reservation(res.id, cancel)).status == "cancelled"  # replay
    with pytest.raises(ApiError) as err:
        await api.cancel_reservation(res.id, CancelReservationRequest(idempotency_key=uuid4(), code=res.code))
    assert err.value.code == "already_cancelled"


async def test_menu_search_marks_missing_allergen_data(api):
    korma = await api.search_menu(RESTAURANT_ID, query="korma")
    assert [i.name for i in korma.items] == ["Navratan Korma"]
    assert korma.items[0].allergens == ["dairy", "nuts"]

    vegan = await api.search_menu(RESTAURANT_ID, dietary=["vegan"], limit=20)
    aloo = next(i for i in vegan.items if i.name == "Aloo Gobi")
    assert not aloo.allergens_listed

    assert not (await api.search_menu(RESTAURANT_ID, query="sushi")).items


async def test_bookings_survive_a_restart_through_the_state_file(tmp_path):
    state_file = tmp_path / "state.json"
    res = await SampleRestaurantAPI(now=lambda: NOW, state_file=state_file).create_reservation(
        booking(TUESDAY, "19:30", 2)
    )
    reloaded = SampleRestaurantAPI(now=lambda: NOW, state_file=state_file)
    assert (await reloaded.find_reservations(RESTAURANT_ID, code=res.code)).reservations[0].id == res.id
