"""The restaurant's menu and general info, loaded once per call and put straight into the prompt.

The whole knowledge base (about 20 dishes and six info topics) is around 500 tokens, so retrieval
(RAG) would only add a lookup step. With the facts in the prompt, a menu or parking question takes
one LLM request and no API round trip, instead of a tool call plus a second request.
Bookings and availability still go through tools: they change and must be checked live.
"""

from __future__ import annotations

import asyncio
import logging

from agent.api_client import ApiError, RestaurantAPI
from agent.api_client.models import MenuItem, RestaurantSettings

logger = logging.getLogger("agent.facts")

INFO_TOPICS = ["hours", "location", "parking", "delivery", "specials", "policies"]
MENU_LIMIT = 20  # the contract's maximum page size
MAX_PARALLEL = 3  # gentle on the web app's database pool


def _menu_line(item: MenuItem) -> str:
    parts = [f"{item.name} ({item.category}) {item.price:g} rupees"]
    if item.dietary_tags:
        parts.append(", ".join(t.replace("_", " ") for t in item.dietary_tags))
    if item.spice_level and item.spice_level != "none":
        parts.append(f"{item.spice_level} spicy")
    if not item.allergens_listed:
        parts.append("allergens NOT LISTED")
    elif item.allergens:
        parts.append("contains " + ", ".join(item.allergens))
    else:
        parts.append("no listed allergens")
    if not item.available_today:
        parts.append("not available today")
    return "- " + "; ".join(parts)


async def load_facts(api: RestaurantAPI, restaurant: RestaurantSettings) -> str | None:
    """Menu and info as compact prompt text, fetched in parallel; None if the API isn't answering."""

    gate = asyncio.Semaphore(MAX_PARALLEL)

    async def info(topic: str) -> str | None:
        async with gate:
            try:
                return f"- {topic}: {(await api.get_info(restaurant.id, topic)).summary}"
            except ApiError:
                return None

    async def menu_items():
        async with gate:
            return await api.search_menu(restaurant.id, limit=MENU_LIMIT)

    try:
        menu, *answers = await asyncio.gather(menu_items(), *(info(t) for t in INFO_TOPICS))
    except ApiError as e:
        logger.warning("restaurant facts not loaded, tools will answer instead: %s", e)
        return None
    lines = ["Info:", *(a for a in answers if a), "Menu:", *(_menu_line(i) for i in menu.items)]
    if len(menu.items) >= MENU_LIMIT:
        lines.append("(The menu may have more dishes: use search_menu for any dish not listed here.)")
    return "\n".join(lines)
