from datetime import datetime
from types import SimpleNamespace

import pytest

from agent.api_client import SAMPLE_RESTAURANT_PHONE, SampleRestaurantAPI
from agent.api_client.sample import TZ
from agent.tools import CallState, Receptionist

# Saturday 24 October 2026, 5 PM: between lunch and dinner. The sample data then has
# Monday the 26th closed, a closure on Tuesday 3 November, and next Saturday's dinner (31st)
# full for parties of 3 or more from 7 PM.
NOW = datetime(2026, 10, 24, 17, 0, tzinfo=TZ)


@pytest.fixture
def api() -> SampleRestaurantAPI:
    return SampleRestaurantAPI(now=lambda: NOW)


@pytest.fixture
async def restaurant(api):
    return await api.get_restaurant_by_number(SAMPLE_RESTAURANT_PHONE)


@pytest.fixture
def make_state(api, restaurant):
    def make(caller_phone: str | None = None) -> CallState:
        return CallState(api=api, restaurant=restaurant, call_id="test-call", caller_phone=caller_phone)

    return make


@pytest.fixture
def agent(make_state) -> Receptionist:
    return Receptionist(make_state())


def turn(state: CallState, speech_id: str) -> SimpleNamespace:
    """A stand-in for RunContext: the tools only use userdata and the speech handle's id."""
    return SimpleNamespace(userdata=state, speech_handle=SimpleNamespace(id=speech_id))
