"""Text conversations with the real LLM against the sample data. Opt-in: they use API quota.

Run from agent/:  uv run pytest evals -v
Each scenario costs a few LLM requests (the agent's turns plus one judge call). The agent uses
the same LLM setup as a real call (Groq, falling back to Gemini on a rate limit); Gemini judges,
so judging doesn't eat into Groq's tokens-per-minute budget.
"""

import asyncio
import os
from datetime import datetime
from types import SimpleNamespace

import pytest
from dotenv import load_dotenv
from livekit.agents import AgentSession, mock_tools

from agent.api_client import SAMPLE_RESTAURANT_PHONE, SampleRestaurantAPI
from agent.api_client.sample import TZ
from agent.main import build_llm, gemini_llm, groq_llm
from agent.tools import CallState, Receptionist

load_dotenv()

# Same fixed clock as the unit tests: Saturday 24 October 2026, 5 PM.
NOW = datetime(2026, 10, 24, 17, 0, tzinfo=TZ)


def pytest_collection_modifyitems(config, items):
    if not os.getenv("GROQ_API_KEY"):
        skip = pytest.mark.skip(reason="GROQ_API_KEY not set in agent/.env")
        for item in items:
            item.add_marker(skip)


@pytest.fixture(autouse=True)
async def pace():
    """Space scenarios out so a run stays under the free tier's tokens-per-minute limit."""
    yield
    await asyncio.sleep(float(os.getenv("EVAL_PAUSE_SECONDS", "8")))


@pytest.fixture
async def judge():
    async with gemini_llm() if os.getenv("GOOGLE_API_KEY") else groq_llm() as llm:
        yield llm


@pytest.fixture
async def call():
    """A started text-only session: the Receptionist with its real tools on sample data."""
    api = SampleRestaurantAPI(now=lambda: NOW)
    restaurant = await api.get_restaurant_by_number(SAMPLE_RESTAURANT_PHONE)
    state = CallState(api=api, restaurant=restaurant, call_id="eval")
    llm, _label = build_llm()
    async with llm, AgentSession[CallState](llm=llm, userdata=state) as session:
        with mock_tools(Receptionist, {"end_call": lambda: "Call ended."}):
            await session.start(Receptionist(state))
            yield SimpleNamespace(session=session, state=state, api=api)


def called(result) -> list[str]:
    """Names of the tools the agent called during one run, in order."""
    return [e.item.name for e in result.events if e.type == "function_call"]
