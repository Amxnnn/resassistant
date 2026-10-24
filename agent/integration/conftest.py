"""Checks the agent's HTTP client against a running web/ tool API (the integration point).

Opt-in: start web/ first (`cd web && pnpm dev`), make sure AGENT_API_KEY matches in agent/.env and
web/.env.local, then from agent/:  uv run pytest integration -v
API_BASE_URL defaults to http://localhost:3000. Every response is parsed with the models generated
from contracts/openapi.yaml, so any drift from the contract fails here.
Writes go to the web app's data with fictional "Integration Test" bookings, which the tests cancel.
"""

import os
from datetime import date, timedelta

import httpx
import pytest
from dotenv import load_dotenv

from agent.api_client import SAMPLE_RESTAURANT_PHONE, HttpRestaurantAPI

load_dotenv()

BASE_URL = os.getenv("INTEGRATION_API_URL", "http://localhost:3000")


def pytest_collection_modifyitems(config, items):
    reason = None
    if not os.getenv("AGENT_API_KEY"):
        reason = "AGENT_API_KEY not set in agent/.env"
    else:
        try:
            httpx.get(f"{BASE_URL}/api/agent/restaurants/by-number/{SAMPLE_RESTAURANT_PHONE}", timeout=10)
        except httpx.HTTPError:
            reason = f"web API not reachable at {BASE_URL} (cd web && pnpm dev)"
    if reason:
        for item in items:
            item.add_marker(pytest.mark.skip(reason=reason))


@pytest.fixture
async def api():
    client = HttpRestaurantAPI(BASE_URL, os.environ["AGENT_API_KEY"], timeout=15)
    yield client
    await client.aclose()


@pytest.fixture
async def restaurant(api):
    return await api.get_restaurant_by_number(SAMPLE_RESTAURANT_PHONE)


@pytest.fixture
def open_day(restaurant) -> date:
    """The first open day at least two days ahead, so no slot on it is in the past."""
    today = restaurant.calendar[0].date
    return next(d.date for d in restaurant.calendar if d.open and d.date >= today + timedelta(days=2))


@pytest.fixture
def closed_day(restaurant) -> date:
    return next(d.date for d in restaurant.calendar if not d.open)
