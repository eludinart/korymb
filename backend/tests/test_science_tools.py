"""Outils agents science_* — documents Knowledge (écriture immédiate même en chat)."""
from __future__ import annotations

import json


def test_science_tools_on_assistant_knowledge_tag():
    from agent_tool_use import tool_names_for_tags
    from services.agents import ASSISTANT_TOOL_TAGS

    names = set(tool_names_for_tags(["knowledge"]))
    for required in (
        "science_overview",
        "science_list_documents",
        "science_get_document",
        "science_create_document",
        "science_update_document",
        "science_list_entities",
        "science_merge_facts",
        "science_upsert_entity",
    ):
        assert required in names
    assistant_names = set(tool_names_for_tags(ASSISTANT_TOOL_TAGS))
    assert "science_create_document" in assistant_names
    assert "science_merge_facts" in assistant_names


def test_science_create_list_update(client):
    from tools.registry_science import dispatch_science_tool

    created = dispatch_science_tool(
        "science_create_document",
        {
            "title": "Positionnement Élude",
            "summary": "Angle principal",
            "content_md": "## Offre\n\nAccompagnement.",
            "category": "Stratégie",
            "tags": ["science", "elude"],
            "author": "assistant",
        },
    )
    assert created is not None
    data = json.loads(created)
    doc = data["document"]
    assert doc["id"].startswith("kd-")
    assert doc["title"] == "Positionnement Élude"
    assert doc["category"] == "Stratégie"
    assert doc["status"] == "active"
    assert data.get("written") is True

    listed = dispatch_science_tool("science_list_documents", {"category": "Stratégie"})
    assert listed is not None
    ids = [d["id"] for d in json.loads(listed)["documents"]]
    assert doc["id"] in ids

    updated = dispatch_science_tool(
        "science_update_document",
        {"document_id": doc["id"], "summary": "Mis à jour", "category": "Offre"},
    )
    assert updated is not None
    row = json.loads(updated)["document"]
    assert row["summary"] == "Mis à jour"
    assert row["category"] == "Offre"


def test_science_create_is_proposal_in_chat_mode(client):
    """En chat : proposition à valider (bouton), pas d'écriture immédiate."""
    from agent_tool_use import _activate_tool_run_ctx, _execute_tool, _tool_run_ctx
    from services.knowledge_documents import list_knowledge_documents
    from services.config_suggestions import apply_config_suggestion

    token = _activate_tool_run_ctx(
        "jobchat-science",
        "chat_sync:assistant",
        "assistant",
        chat_mode=True,
    )
    try:
        out = _execute_tool(
            "science_create_document",
            {
                "title": "Sous-section Identité",
                "category": "Stratégie",
                "content_md": "Valeurs et promesse.",
            },
        )
    finally:
        _tool_run_ctx.reset(token)
    data = json.loads(out)
    assert data.get("proposal") is True
    sid = str(data.get("suggestion_id") or "")
    assert sid
    titles = [str(d.get("title") or "") for d in list_knowledge_documents(limit=50)]
    assert "Sous-section Identité" not in titles
    applied = apply_config_suggestion(sid)
    assert applied.get("status") == "applied"
    titles2 = [str(d.get("title") or "") for d in list_knowledge_documents(limit=50)]
    assert "Sous-section Identité" in titles2


def test_chat_turn_needs_science_write_on_ok_after_structure():
    from services.chat_intelligence import chat_turn_needs_science_write

    history = [
        {
            "role": "assistant",
            "content": (
                "Je propose de créer dans Science de l'entreprise : "
                "Identité, Offre, Process. Dis ok et j'écris les documents."
            ),
        }
    ]
    assert chat_turn_needs_science_write("ok", history) is True
    assert chat_turn_needs_science_write("oui", history) is True
    assert chat_turn_needs_science_write("bonjour", history) is False
    assert chat_turn_needs_science_write("ok", []) is False
    assert (
        chat_turn_needs_science_write(
            "mets en place la science de l'entreprise avec 3 sous-sections",
            [],
        )
        is True
    )
    materialize_hist = [
        {
            "role": "assistant",
            "content": (
                "Le contexte est plein mais Identité et fiches sont vides. "
                "Je peux matérialiser dans le hub Science — dis ok."
            ),
        }
    ]
    assert chat_turn_needs_science_write("ok", materialize_hist) is True
    assert chat_turn_needs_science_write("remplir l'identité depuis le contexte", []) is True


def test_science_merge_facts_and_upsert_entity(client):
    from tools.registry_science import dispatch_science_tool
    from services.science_overview import get_science_overview

    facts_out = dispatch_science_tool(
        "science_merge_facts",
        {
            "facts": {
                "brand": "Mer et Découverte",
                "activity": "Sorties mer",
                "companies": ["Mer et Découverte 83 (SASU)", "Bon Aloha (EI)"],
                "boats": ["Cigno Nero", "ILYAKA"],
                "org": "Vie pro / perso / projets",
            }
        },
    )
    assert facts_out is not None
    facts_data = json.loads(facts_out)
    assert facts_data.get("written") is True
    assert facts_data["facts"]["brand"] == "Mer et Découverte"
    assert "Bon Aloha (EI)" in facts_data["facts"]["companies"]

    person_out = dispatch_science_tool(
        "science_upsert_entity",
        {
            "name": "Cédric",
            "entity_type": "person",
            "attributes": {"role": "Dirigeant", "focus": "Organisation & IA"},
        },
    )
    assert person_out is not None
    person = json.loads(person_out)
    assert person.get("written") is True
    assert person["entity"]["name"] == "Cédric"
    assert person["section"] == "Dirigeant"

    company_out = dispatch_science_tool(
        "science_upsert_entity",
        {
            "name": "Mer et Découverte 83",
            "entity_type": "company",
            "attributes_json": json.dumps({"forme": "SASU"}),
        },
    )
    assert json.loads(company_out or "{}").get("written") is True

    listed = dispatch_science_tool("science_list_entities", {})
    names = [e["name"] for e in json.loads(listed or "{}").get("entities") or []]
    assert "Cédric" in names
    assert "Mer et Découverte 83" in names

    overview = get_science_overview()
    assert overview["facts"].get("brand") == "Mer et Découverte"
    assert "boats" in overview["facts"]
    assert any(p.get("name") == "Cédric" for p in overview.get("persons") or [])
    assert any(e.get("name") == "Mer et Découverte 83" for e in overview.get("entities") or [])


def test_science_facts_proposal_then_apply_in_chat_mode(client):
    from agent_tool_use import _activate_tool_run_ctx, _execute_tool, _tool_run_ctx
    from services.memory_inbox import get_enterprise_facts
    from services.config_suggestions import apply_config_suggestion

    token = _activate_tool_run_ctx(
        "jobchat-science-facts",
        "chat_sync:assistant",
        "assistant",
        chat_mode=True,
    )
    try:
        out = _execute_tool(
            "science_merge_facts",
            {"facts": {"tagline": "Explorer • Comprendre • Agir • Transmettre"}},
        )
    finally:
        _tool_run_ctx.reset(token)
    data = json.loads(out)
    assert data.get("proposal") is True
    assert get_enterprise_facts().get("tagline") != "Explorer • Comprendre • Agir • Transmettre"
    apply_config_suggestion(str(data["suggestion_id"]))
    assert get_enterprise_facts().get("tagline") == "Explorer • Comprendre • Agir • Transmettre"


def test_assistant_system_mentions_science_write():
    from services.agent_groups import ASSISTANT_SYSTEM

    folded = ASSISTANT_SYSTEM.lower()
    assert "science_create_document" in folded
    assert "science_merge_facts" in folded
    assert "science_upsert_entity" in folded
    assert "gestion/science" in folded or "enregistrer dans science" in folded
    assert "enregistrer dans science" in folded
