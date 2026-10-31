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
    ):
        assert required in names
    assistant_names = set(tool_names_for_tags(ASSISTANT_TOOL_TAGS))
    assert "science_create_document" in assistant_names


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


def test_science_create_writes_immediately_in_chat_mode(client):
    """Après « ok » conversationnel : pas de proposition Décisions, écriture réelle."""
    from agent_tool_use import _activate_tool_run_ctx, _execute_tool, _tool_run_ctx
    from services.knowledge_documents import list_knowledge_documents

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
    assert data.get("proposal") is not True
    assert data.get("written") is True
    titles = [str(d.get("title") or "") for d in list_knowledge_documents(limit=50)]
    assert "Sous-section Identité" in titles


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


def test_assistant_system_mentions_science_write():
    from services.agent_groups import ASSISTANT_SYSTEM

    folded = ASSISTANT_SYSTEM.lower()
    assert "science_create_document" in folded
    assert "gestion/science" in folded
