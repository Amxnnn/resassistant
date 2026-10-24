from livekit.agents import FlushSentinel
from livekit.agents.llm import ChatChunk, ChoiceDelta, FunctionToolCall

from agent.facts import load_facts
from agent.prompts import NO_FACTS_YET, build_instructions
from agent.speakable import speak_in_phrases


async def collect(parts):
    async def chunks():
        for part in parts:
            yield part

    return [p async for p in speak_in_phrases(chunks())]


def segments(output) -> list[str]:
    """Join the text between flushes: what the voice synthesises as one piece."""
    segs, current = [], ""
    for item in output:
        if isinstance(item, FlushSentinel):
            segs.append(current)
            current = ""
        elif isinstance(item, str):
            current += item
    return segs + ([current] if current else [])


async def test_the_voice_starts_after_the_first_phrase_not_the_whole_reply():
    out = await collect(["Sure, we're open", " 12 to 3 PM. Would you", " like to book a table for tonight?"])
    assert segments(out) == ["Sure, we're open 12 to 3 PM.", " Would you like to book a table for tonight?"]


async def test_after_the_first_phrase_segments_end_at_sentences_only():
    out = await collect(
        ["Got it, one moment.", " We have Chana Masala, Aloo Gobi, and Samosa.", " Anything else?"]
    )
    assert segments(out) == [
        "Got it, one moment.",
        " We have Chana Masala, Aloo Gobi, and Samosa.",
        " Anything else?",
    ]


async def test_tool_calls_and_text_chunks_pass_through():
    tool_chunk = ChatChunk(
        id="1",
        delta=ChoiceDelta(
            role="assistant", tool_calls=[FunctionToolCall(name="search_menu", arguments="{}", call_id="c1")]
        ),
    )
    text_chunk = ChatChunk(id="2", delta=ChoiceDelta(role="assistant", content="Let me check that for you."))
    out = await collect([tool_chunk, text_chunk])
    assert out[0] is tool_chunk
    assert out[1:] == ["Let me check that for you.", out[2]] and isinstance(out[2], FlushSentinel)


async def test_facts_hold_the_menu_and_info_with_allergen_markers(api, restaurant):
    facts = await load_facts(api, restaurant)
    assert "- parking: There's free valet parking" in facts
    assert "- Aloo Gobi (Mains) 320 rupees; vegetarian, vegan; mild spicy; allergens NOT LISTED" in facts
    assert "- Butter Chicken (Mains) 520 rupees; gluten free; mild spicy; contains dairy, nuts" in facts
    assert "Lamb Rogan Josh" in facts and "not available today" in facts


def test_the_prompt_carries_the_facts_or_says_to_use_tools(restaurant):
    assert build_instructions(restaurant, caller_id_known=False).endswith(NO_FACTS_YET + "\n")
    with_facts = build_instructions(restaurant, caller_id_known=False, facts="Menu:\n- Samosa 180 rupees")
    assert with_facts.endswith("# Restaurant facts\nMenu:\n- Samosa 180 rupees\n")
