import httpx
import pytest

from agent.api_client import ApiError, HttpRestaurantAPI
from agent.api_client.sample import RESTAURANT_ID

INFO = {"topic": "parking", "summary": "Free valet from 6 PM."}


def client(handler) -> HttpRestaurantAPI:
    return HttpRestaurantAPI("http://api.test", "secret", transport=httpx.MockTransport(handler))


async def test_requests_carry_the_agent_key_and_parse_the_contract_model():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["key"] = request.headers["x-agent-key"]
        seen["url"] = str(request.url)
        return httpx.Response(200, json=INFO)

    answer = await client(handler).get_info(RESTAURANT_ID, "parking")
    assert answer.summary == "Free valet from 6 PM."
    assert seen["key"] == "secret"
    assert (
        seen["url"] == f"http://api.test/api/agent/restaurants/{RESTAURANT_ID}/info?topic=parking&language=en"
    )


async def test_dietary_filters_are_sent_as_repeated_parameters():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params.get_list("dietary") == ["vegan", "gluten_free"]
        assert "query" not in request.url.params
        return httpx.Response(200, json={"items": [], "summary": "Nothing found."})

    await client(handler).search_menu(RESTAURANT_ID, dietary=["vegan", "gluten_free"])


async def test_contract_errors_become_api_errors_with_the_speakable_text():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(409, json={"error": {"code": "slot_taken", "say": "8 PM is free."}})

    with pytest.raises(ApiError) as err:
        await client(handler).get_info(RESTAURANT_ID, "parking")
    assert (err.value.code, err.value.say, err.value.status) == ("slot_taken", "8 PM is free.", 409)


async def test_network_failures_and_non_contract_errors_still_give_a_sentence_to_speak():
    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    def broken(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="<html>oops</html>")

    for handler, code in ((down, "unreachable"), (broken, "internal_error")):
        with pytest.raises(ApiError) as err:
            await client(handler).get_info(RESTAURANT_ID, "parking")
        assert err.value.code == code
        assert "take a message" in err.value.say


def flaky(*responses):
    """A transport that answers with each response (or raises each exception) in turn."""
    calls = iter(responses)

    def handler(request: httpx.Request) -> httpx.Response:
        nxt = next(calls)
        if isinstance(nxt, Exception):
            raise nxt
        return nxt

    return handler


async def test_a_server_error_or_dropped_connection_is_retried_once():
    ok = httpx.Response(200, json=INFO)
    for first in (httpx.Response(500, text="pool exhausted"), httpx.ConnectError("reset")):
        answer = await client(flaky(first, ok)).get_info(RESTAURANT_ID, "parking")
        assert answer.summary == "Free valet from 6 PM."


async def test_a_second_failure_or_a_timeout_is_not_retried():
    with pytest.raises(ApiError) as err:
        await client(flaky(httpx.Response(503), httpx.Response(503))).get_info(RESTAURANT_ID, "parking")
    assert err.value.status == 503

    with pytest.raises(ApiError) as err:  # only one response queued: a retry would fail differently
        await client(flaky(httpx.ReadTimeout("slow"))).get_info(RESTAURANT_ID, "parking")
    assert err.value.code == "unreachable"


async def test_business_errors_are_not_retried():
    error = httpx.Response(409, json={"error": {"code": "slot_taken", "say": "Taken."}})
    with pytest.raises(ApiError) as err:
        await client(flaky(error)).get_info(RESTAURANT_ID, "parking")
    assert err.value.code == "slot_taken"


async def test_writes_wait_longer_than_reads():
    """A booking write that times out may still have gone through: give writes more time."""
    from agent.api_client.client import WRITE_TIMEOUT_SECONDS
    from agent.api_client.models import CreateMessageRequest

    timeouts = {}

    def handler(request: httpx.Request) -> httpx.Response:
        timeouts[request.method] = request.extensions["timeout"]["read"]
        if request.method == "GET":
            return httpx.Response(200, json=INFO)
        return httpx.Response(201, json={"id": "6f1c2a9e-3b7d-4c5a-9e2f-1a8b7c6d5e40", "summary": "Saved."})

    api = client(handler)
    await api.get_info(RESTAURANT_ID, "parking")
    await api.create_message(
        CreateMessageRequest(
            restaurant_id=RESTAURANT_ID,
            idempotency_key="6f1c2a9e-3b7d-4c5a-9e2f-1a8b7c6d5e41",
            caller_name="Rohan",
            caller_phone="+919876543210",
            topic="catering",
            details="Lunch for 40 on Friday.",
        )
    )
    assert timeouts == {"GET": 4.0, "POST": WRITE_TIMEOUT_SECONDS}
