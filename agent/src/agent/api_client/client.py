"""The restaurant tool API the agent talks to: one interface, two backends.

HttpRestaurantAPI calls web/ (or the Prism mock) over HTTP, per contracts/openapi.yaml.
SampleRestaurantAPI (sample.py) answers from in-memory sample data, so the agent can be built
and tested before web/ is deployed. Both return the generated contract models and raise ApiError
with the contract's error code and speakable `say`.
"""

from __future__ import annotations

from datetime import date
from typing import Protocol
from uuid import UUID

import httpx
from pydantic import BaseModel, ValidationError

from .models import (
    Availability,
    CallLogReceipt,
    CancelReservationRequest,
    CreateCallLogRequest,
    CreateMessageRequest,
    CreateReservationRequest,
    Error,
    InfoAnswer,
    MenuSearchResult,
    MessageReceipt,
    Reservation,
    ReservationList,
    RestaurantSettings,
    UpdateReservationRequest,
)

UNREACHABLE_SAY = "Sorry, I can't reach our booking system right now. Can I take a message instead?"


class ApiError(Exception):
    """An error in the contract's shape: a machine code and a sentence the agent can speak."""

    def __init__(self, code: str, say: str, status: int | None = None) -> None:
        super().__init__(f"{code}: {say}")
        self.code = code
        self.say = say
        self.status = status


class RestaurantAPI(Protocol):
    async def get_restaurant_by_number(self, phone: str) -> RestaurantSettings: ...

    async def get_info(self, restaurant_id: UUID, topic: str, language: str = "en") -> InfoAnswer: ...

    async def search_menu(
        self,
        restaurant_id: UUID,
        query: str | None = None,
        dietary: list[str] | None = None,
        limit: int = 5,
    ) -> MenuSearchResult: ...

    async def check_availability(
        self, restaurant_id: UUID, day: date, time: str, party_size: int
    ) -> Availability: ...

    async def create_reservation(self, req: CreateReservationRequest) -> Reservation: ...

    async def find_reservations(
        self, restaurant_id: UUID, phone: str | None = None, code: str | None = None
    ) -> ReservationList: ...

    async def update_reservation(
        self, reservation_id: UUID, req: UpdateReservationRequest
    ) -> Reservation: ...

    async def cancel_reservation(
        self, reservation_id: UUID, req: CancelReservationRequest
    ) -> Reservation: ...

    async def create_message(self, req: CreateMessageRequest) -> MessageReceipt: ...

    async def create_call_log(self, req: CreateCallLogRequest) -> CallLogReceipt: ...

    async def aclose(self) -> None: ...


class HttpRestaurantAPI:
    """The real tool API over HTTP. Short timeouts: a caller is waiting on every request."""

    def __init__(
        self,
        base_url: str,
        agent_key: str,
        *,
        timeout: float = 4.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._http = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            headers={"x-agent-key": agent_key},
            timeout=timeout,
            transport=transport,
        )

    async def _request[M: BaseModel](
        self,
        method: str,
        path: str,
        model: type[M],
        *,
        params: dict | None = None,
        body: BaseModel | None = None,
    ) -> M:
        json = body.model_dump(mode="json", exclude_none=True) if body else None
        params = {k: v for k, v in (params or {}).items() if v is not None}
        try:
            resp = await self._http.request(method, path, params=params, json=json)
        except httpx.HTTPError as e:
            raise ApiError("unreachable", UNREACHABLE_SAY) from e
        if resp.is_success:
            return model.model_validate(resp.json())
        try:
            err = Error.model_validate(resp.json()).error
        except (ValueError, ValidationError):
            raise ApiError("internal_error", UNREACHABLE_SAY, resp.status_code) from None
        raise ApiError(err.code, err.say, resp.status_code)

    async def get_restaurant_by_number(self, phone: str) -> RestaurantSettings:
        return await self._request("GET", f"/api/agent/restaurants/by-number/{phone}", RestaurantSettings)

    async def get_info(self, restaurant_id: UUID, topic: str, language: str = "en") -> InfoAnswer:
        return await self._request(
            "GET",
            f"/api/agent/restaurants/{restaurant_id}/info",
            InfoAnswer,
            params={"topic": topic, "language": language},
        )

    async def search_menu(
        self,
        restaurant_id: UUID,
        query: str | None = None,
        dietary: list[str] | None = None,
        limit: int = 5,
    ) -> MenuSearchResult:
        return await self._request(
            "GET",
            f"/api/agent/restaurants/{restaurant_id}/menu",
            MenuSearchResult,
            params={"query": query, "dietary": dietary or None, "limit": limit},
        )

    async def check_availability(
        self, restaurant_id: UUID, day: date, time: str, party_size: int
    ) -> Availability:
        return await self._request(
            "GET",
            f"/api/agent/restaurants/{restaurant_id}/availability",
            Availability,
            params={"date": day.isoformat(), "time": time, "party_size": party_size},
        )

    async def create_reservation(self, req: CreateReservationRequest) -> Reservation:
        return await self._request("POST", "/api/agent/reservations", Reservation, body=req)

    async def find_reservations(
        self, restaurant_id: UUID, phone: str | None = None, code: str | None = None
    ) -> ReservationList:
        return await self._request(
            "GET",
            "/api/agent/reservations",
            ReservationList,
            params={"restaurant_id": str(restaurant_id), "phone": phone, "code": code},
        )

    async def update_reservation(self, reservation_id: UUID, req: UpdateReservationRequest) -> Reservation:
        return await self._request(
            "PATCH", f"/api/agent/reservations/{reservation_id}", Reservation, body=req
        )

    async def cancel_reservation(self, reservation_id: UUID, req: CancelReservationRequest) -> Reservation:
        return await self._request(
            "POST", f"/api/agent/reservations/{reservation_id}/cancel", Reservation, body=req
        )

    async def create_message(self, req: CreateMessageRequest) -> MessageReceipt:
        return await self._request("POST", "/api/agent/messages", MessageReceipt, body=req)

    async def create_call_log(self, req: CreateCallLogRequest) -> CallLogReceipt:
        return await self._request("POST", "/api/agent/calls", CallLogReceipt, body=req)

    async def aclose(self) -> None:
        await self._http.aclose()
