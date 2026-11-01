"""The call record saved when a call ends: one per conversation, under the call's unique id.

Bookings and messages made during the call carry the same call_id, so the dashboard and the
database can tie each booking to the exact conversation that made it.
"""

from __future__ import annotations

import logging
from dataclasses import asdict
from datetime import datetime
from typing import Literal
from uuid import uuid4

from agent.api_client import ApiError
from agent.api_client.models import CallTurn, CreateCallLogRequest
from agent.api_client.models import TurnLatency as TurnLatencyModel
from agent.metrics import LatencyTracker
from agent.tools import CallState

logger = logging.getLogger("agent.call_log")


def build_call_log(
    state: CallState,
    tracker: LatencyTracker,
    *,
    channel: Literal["phone", "browser"],
    dialed_number: str | None,
    started_at: datetime,
    ended_at: datetime,
) -> CreateCallLogRequest:
    tz = state.tz
    turns = [
        CallTurn(
            index=t.index,
            speaker=t.speaker,
            text=t.text,
            at=t.at.astimezone(tz),
            interrupted=t.interrupted,
            latency=TurnLatencyModel(**asdict(t.latency)) if t.latency else None,
        )
        for t in tracker.turns
    ]
    return CreateCallLogRequest(
        restaurant_id=state.restaurant.id,
        call_id=state.call_id,
        idempotency_key=uuid4(),
        channel=channel,
        caller_number=state.caller_phone,
        dialed_number=dialed_number if channel == "phone" else None,
        started_at=started_at.astimezone(tz),
        ended_at=ended_at.astimezone(tz),
        language="en",
        outcome=state.outcome(caller_spoke=any(t.speaker == "caller" for t in tracker.turns)),
        recording_url=None,
        turns=turns,
    )


async def save_call_log(state: CallState, request: CreateCallLogRequest) -> None:
    try:
        await state.api.create_call_log(request)
    except ApiError as e:
        logger.warning("call log not saved for %s: %s", request.call_id, e)
        return
    logger.info(
        "call log saved | %s | outcome %s | %d turns", request.call_id, request.outcome, len(request.turns)
    )
