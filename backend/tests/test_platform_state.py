from services.chat_intelligence import (
    INTENT_PLATFORM,
    build_chat_grounding_block,
    build_targeted_memory_block,
    classify_chat_intent,
)
from services.platform_state import (
    clear_platform_state_cache,
    format_platform_state_prompt,
    load_platform_state_text,
)


def test_platform_state_file_loads():
    clear_platform_state_cache()
    text = load_platform_state_text()
    assert "Korymb" in text
    assert "PLATFORM_STATE" in format_platform_state_prompt() or "État plateforme" in format_platform_state_prompt()


def test_classify_platform_etat_des_lieux():
    assert classify_chat_intent("quel est l'état de la plateforme Korymb ?") == INTENT_PLATFORM
    assert classify_chat_intent("fais un état des lieux du développement") == INTENT_PLATFORM


def test_product_snapshot_uses_platform_not_probes():
    from services.chat_intelligence import chat_message_needs_action, chat_tool_mandate

    q = "Fais un point court sur l'état de Korymb (ce qui marche / ce qui bloque)"
    assert classify_chat_intent(q) == INTENT_PLATFORM
    assert chat_message_needs_action(q) is False
    assert classify_chat_intent("Est-ce que Gmail marche ?") != INTENT_PLATFORM
    mandate = chat_tool_mandate(INTENT_PLATFORM, q)
    assert "Ce qui tient" in mandate
    assert "Camille" in mandate
    clear_platform_state_cache()
    block = build_chat_grounding_block(q)
    assert "État plateforme" in block
    assert "korymb_overview" not in block
    assert "search_core_notes" not in block


def test_grounding_includes_platform_state():
    clear_platform_state_cache()
    block = build_chat_grounding_block("état de la plateforme Korymb", intent=INTENT_PLATFORM)
    assert "État plateforme" in block or "PLATFORM_STATE" in block


def test_targeted_memory_includes_platform_state(monkeypatch):
    clear_platform_state_cache()
    monkeypatch.setattr(
        "database.get_enterprise_memory",
        lambda: {"contexts": {"global": "", "developpeur": "Note dev locale."}},
    )
    block = build_targeted_memory_block("état de la plateforme")
    assert "Note dev locale" in block or "État plateforme" in block
