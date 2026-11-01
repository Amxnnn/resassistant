import asyncio

from livekit.agents import DEFAULT_API_CONNECT_OPTIONS, APIStatusError, llm
from livekit.agents.llm import ChatChunk, ChatContext, ChoiceDelta, FunctionCall, FunctionCallOutput
from livekit.plugins import google

from agent.main import ForeignCallSignatures, NoProbeFallbackAdapter, build_llm, gemini_llm, groq_llm


def test_gemini_gets_a_stand_in_signature_for_calls_another_model_made(monkeypatch):
    monkeypatch.setenv("GOOGLE_API_KEY", "test")
    gemini = gemini_llm()
    assert isinstance(gemini._thought_signatures, ForeignCallSignatures)

    ctx = ChatContext()
    ctx.add_message(role="user", content="Is there parking?")
    ctx.insert(FunctionCall(call_id="groq_1", name="get_restaurant_info", arguments='{"topic": "parking"}'))
    ctx.insert(
        FunctionCallOutput(call_id="groq_1", name="get_restaurant_info", output="Valet.", is_error=False)
    )
    turns, _ = ctx.to_provider_format(format="google", thought_signatures=gemini._thought_signatures)

    calls = [p for t in turns for p in t["parts"] if "function_call" in p]
    assert calls[0]["thought_signature"] == ForeignCallSignatures.SKIP


def test_gemini_keeps_its_own_signatures():
    sigs = ForeignCallSignatures()
    sigs["gemini_1"] = b"real"
    assert sigs.get("gemini_1") == b"real"
    assert sigs  # truthy even when empty, or the plugin would skip signatures altogether
    assert ForeignCallSignatures()


def test_groq_is_primary_with_gemini_as_fallback_when_both_keys_are_set(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "groq")
    monkeypatch.setenv("GROQ_API_KEY", "test")
    monkeypatch.setenv("GOOGLE_API_KEY", "test")
    session_llm, label = build_llm()
    assert isinstance(session_llm, NoProbeFallbackAdapter)
    assert label == "openai/gpt-oss-120b (fallback openai/gpt-oss-20b, gemini-3.5-flash-lite)"
    # Becomes Gemini's request deadline; Google rejects deadlines under 10 s.
    assert session_llm._attempt_timeout >= 10

    monkeypatch.delenv("GOOGLE_API_KEY")
    monkeypatch.setenv("GROQ_MODELS", "openai/gpt-oss-20b")
    session_llm, label = build_llm()
    assert not isinstance(session_llm, llm.FallbackAdapter)
    assert not isinstance(session_llm, google.LLM)
    assert label == "openai/gpt-oss-20b"


def test_groq_makes_one_tool_call_per_reply(monkeypatch):
    # A tool that speaks for itself ends the turn; a second call alongside it would get a reply on top.
    monkeypatch.setenv("GROQ_API_KEY", "test")
    assert groq_llm()._opts.parallel_tool_calls is False


class FakeLLM(llm.LLM):
    """Answers with its own name, or fails with a 429 while `failing`; counts the requests it gets."""

    def __init__(self, name: str) -> None:
        super().__init__()
        self._name = name
        self.failing = False
        self.requests = 0

    @property
    def model(self) -> str:
        return self._name

    def chat(self, *, chat_ctx, tools=None, conn_options=DEFAULT_API_CONNECT_OPTIONS, **_):
        self.requests += 1
        return FakeStream(self, chat_ctx=chat_ctx, tools=tools or [], conn_options=conn_options)


class FakeStream(llm.LLMStream):
    async def _run(self) -> None:
        if self._llm.failing:
            raise APIStatusError("rate limited", status_code=429, retryable=False)
        delta = ChoiceDelta(role="assistant", content=self._llm.model)
        self._event_ch.send_nowait(ChatChunk(id="1", delta=delta))


async def answer(adapter: llm.LLM) -> str:
    async with adapter.chat(chat_ctx=ChatContext.empty()) as stream:
        return "".join([chunk.delta.content async for chunk in stream if chunk.delta and chunk.delta.content])


async def test_a_failed_model_sits_out_then_rejoins_without_probe_requests(monkeypatch):
    import agent.main as main

    monkeypatch.setattr(main, "RETRY_FAILED_LLM_AFTER", 0.2)
    primary, backup = FakeLLM("primary"), FakeLLM("backup")
    adapter = NoProbeFallbackAdapter([primary, backup], attempt_timeout=10.0)

    primary.failing = True  # e.g. its tokens-per-minute budget ran out
    assert await answer(adapter) == "backup"
    assert await answer(adapter) == "backup"  # sitting out: not even tried
    await asyncio.sleep(0.05)
    assert primary.requests == 1  # LiveKit's adapter would re-send the request in the background

    primary.failing = False
    await asyncio.sleep(0.25)
    assert await answer(adapter) == "primary"  # back after the pause, on a real request
    assert primary.requests == 2
