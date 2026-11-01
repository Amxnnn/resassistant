"""The restaurant's menu and general info, loaded once per call and put straight into the prompt.

The whole knowledge base (about 20 dishes and six info topics) is around 500 tokens, so retrieval
(RAG) would only add a lookup step. With the facts in the prompt, a menu or parking question takes
one LLM request and no API round trip, instead of a tool call plus a second request.
Bookings and availability still go through tools: they change and must be checked live.

The same data gives the STT its keyterms: dish names, street names and delivery apps that a
general speech model mishears ("paneer tikka" heard as "paneer tea").
"""

from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass, field

from agent.api_client import ApiError, RestaurantAPI
from agent.api_client.models import MenuItem, RestaurantSettings

logger = logging.getLogger("agent.facts")

INFO_TOPICS = ["hours", "location", "parking", "delivery", "specials", "policies"]
MENU_LIMIT = 20  # the contract's maximum page size
MAX_PARALLEL = 3  # gentle on the web app's database pool
MAX_KEYTERMS = 60  # Deepgram accepts up to 100; the rest of the vocabulary needs no help

_NAME = re.compile(r"\b[A-Z][a-z]+(?: [A-Z][a-z]+){0,2}\b")
_COMMON = {
    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "January",
    "February", "March", "April", "May", "June", "July", "August", "September", "October",
    "November", "December", "The", "We", "Our", "You", "Your", "There", "This", "Today", "Tonight",
    "Tomorrow", "Open", "Closed", "Parties", "Parking", "Please", "For", "And", "But", "Free",
}  # fmt: skip


@dataclass
class Facts:
    text: str  # for the prompt
    keyterms: list[str] = field(default_factory=list)  # for the STT
    all_info: bool = True  # every info topic loaded: get_restaurant_info has nothing to add
    whole_menu: bool = True  # every dish listed: search_menu has nothing to add


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


def proper_names(text: str) -> list[str]:
    """Capitalised names in running text ("Museum Road", "Swiggy"), not ordinary capitalised words."""

    def common(word: str) -> bool:
        return word in _COMMON or word.rstrip("s") in _COMMON  # "Mondays" too

    names = []
    for match in _NAME.finditer(text):
        words = match.group(0).split()
        trimmed_front = 0
        while words and common(words[0]):
            words.pop(0)
            trimmed_front += 1
        while words and common(words[-1]):
            words.pop()
        if not words:
            continue
        before = text[: match.start()].rstrip()
        sentence_start = trimmed_front == 0 and (not before or before[-1] in ".!?")
        if sentence_start and len(words) == 1:  # a single capitalised word may just start a sentence
            continue
        names.append(" ".join(words))
    return names


def keyterms_for(restaurant: RestaurantSettings, menu: list[MenuItem], info: list[str]) -> list[str]:
    terms = [restaurant.name, *(item.name for item in menu)]
    for text in [restaurant.address, *info]:
        terms += proper_names(text)
    return list(dict.fromkeys(terms))[:MAX_KEYTERMS]


async def load_facts(api: RestaurantAPI, restaurant: RestaurantSettings) -> Facts | None:
    """Menu and info, fetched a few at a time; None if the API isn't answering."""
    gate = asyncio.Semaphore(MAX_PARALLEL)

    async def info(topic: str) -> str | None:
        async with gate:
            try:
                return (await api.get_info(restaurant.id, topic)).summary
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
    lines = ["Info:"]
    lines += [f"- {topic}: {answer}" for topic, answer in zip(INFO_TOPICS, answers, strict=True) if answer]
    lines += ["Menu:", *(_menu_line(i) for i in menu.items)]
    whole_menu = len(menu.items) < MENU_LIMIT
    if not whole_menu:
        lines.append("(The menu may have more dishes: use search_menu for any dish not listed here.)")
    return Facts(
        text="\n".join(lines),
        keyterms=keyterms_for(restaurant, menu.items, [a for a in answers if a]),
        all_info=all(answers),
        whole_menu=whole_menu,
    )
