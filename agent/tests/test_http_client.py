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
