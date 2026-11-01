from agent.facts import load_facts
from agent.prompts import NO_FACTS_YET, build_instructions


async def test_facts_hold_the_menu_and_info_with_allergen_markers(api, restaurant):
    facts = (await load_facts(api, restaurant)).text
    assert "- parking: There's free valet parking" in facts
    assert "- Aloo Gobi (Mains) 320 rupees; vegetarian, vegan; mild spicy; allergens NOT LISTED" in facts
    assert "- Butter Chicken (Mains) 520 rupees; gluten free; mild spicy; contains dairy, nuts" in facts
    assert "Lamb Rogan Josh" in facts and "not available today" in facts


def test_the_prompt_carries_the_facts_or_says_to_use_tools(restaurant):
    assert build_instructions(restaurant, caller_id_known=False).endswith(NO_FACTS_YET + "\n")
    with_facts = build_instructions(restaurant, caller_id_known=False, facts="Menu:\n- Samosa 180 rupees")
    assert with_facts.endswith("# Restaurant facts\nMenu:\n- Samosa 180 rupees\n")


async def test_the_stt_learns_dish_street_and_app_names_but_not_common_words(api, restaurant):
    terms = (await load_facts(api, restaurant)).keyterms
    for name in ["The Saffron Table", "Paneer Tikka", "Baingan Bharta", "Residency Road", "Museum Road",
                 "Swiggy", "Zomato", "Malai Kofta"]:  # fmt: skip
        assert name in terms
    for word in ["Open Tuesday", "Mondays", "Tuesday", "PM"]:
        assert word not in terms
    assert len(terms) == len(set(terms))


def test_proper_names_skip_sentence_openers_and_common_words():
    from agent.facts import proper_names

    text = "Open Tuesday to Sunday. Closed on Mondays. Order on Swiggy and Zomato. Bengaluru is lovely."
    assert proper_names(text) == ["Swiggy", "Zomato"]
    assert proper_names("We're at 12 Residency Road, near Brigade Road, Bengaluru.") == [
        "Residency Road",
        "Brigade Road",
        "Bengaluru",
    ]
