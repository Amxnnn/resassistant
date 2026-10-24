from livekit.agents import llm
from livekit.agents.llm import ChatContext, FunctionCall, FunctionCallOutput
from livekit.plugins import google

from agent.main import ForeignCallSignatures, build_llm, gemini_llm


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
    assert isinstance(session_llm, llm.FallbackAdapter)
    assert label == "openai/gpt-oss-20b (fallback gemini-3.5-flash-lite)"

    monkeypatch.delenv("GOOGLE_API_KEY")
    session_llm, label = build_llm()
    assert not isinstance(session_llm, llm.FallbackAdapter)
    assert not isinstance(session_llm, google.LLM)
