"""Restaurant data for the agent: the contract's models plus a sample and an HTTP backend."""

from __future__ import annotations

import os

from .client import ApiError, HttpRestaurantAPI, RestaurantAPI
from .sample import RESTAURANT_PHONE as SAMPLE_RESTAURANT_PHONE
from .sample import SampleRestaurantAPI

__all__ = [
    "SAMPLE_RESTAURANT_PHONE",
    "ApiError",
    "HttpRestaurantAPI",
    "RestaurantAPI",
    "SampleRestaurantAPI",
    "make_restaurant_api",
]


def make_restaurant_api() -> RestaurantAPI:
    """DATA_SOURCE=sample (default) uses built-in sample data; DATA_SOURCE=api calls API_BASE_URL."""
    source = os.getenv("DATA_SOURCE", "sample").lower()
    if source == "sample":
        return SampleRestaurantAPI(state_file=os.getenv("SAMPLE_STATE_FILE", ".sample_state.json"))
    if source == "api":
        base_url, key = os.getenv("API_BASE_URL"), os.getenv("AGENT_API_KEY")
        if not base_url or not key:
            raise RuntimeError("DATA_SOURCE=api needs API_BASE_URL and AGENT_API_KEY in agent/.env")
        return HttpRestaurantAPI(base_url, key)
    raise ValueError(f"DATA_SOURCE must be 'sample' or 'api', got {source!r}")
