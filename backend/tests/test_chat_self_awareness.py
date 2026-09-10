"""Chat : overview lecture seule, propositions CRM/plateforme, apply allowlist."""
from __future__ import annotations

import json


def test_cio_and_dev_have_knowledge_tools():
    from agent_tool_use import tool_names_for_tags
    from services.agents import BUILTIN_AGENT_DEFINITIONS

    assert "knowledge" in BUILTIN_AGENT_DEFINITIONS["coordinateur"]["tools"]
    assert "knowledge" in BUILTIN_AGENT_DEFINITIONS["developpeur"]["tools"]
    assert "validate" in BUILTIN_AGENT_DEFINITIONS["developpeur"]["tools"]
    names = tool_names_for_tags(["knowledge"])
    assert "korymb_overview" in names
    assert "propose_platform_change" in names
    assert "search_core_notes" in names


def test_korymb_overview_has_no_secret_tokens(client, monkeypatch):
    from services.korymb_overview import build_korymb_overview

    monkeypatch.setattr(
        "tools_health.probe_tools_health",
        lambda force=False: {
            "web_search": {"ok": True, "provider": "duckduckgo"},
            "gmail": {"ok": False, "configured": False, "message": "sk-secret-should-not-leak"},
            "cached": True,
        },
    )
    text = build_korymb_overview()
    assert "État Korymb" in text
    assert "sk-secret" not in text
    assert "sk-" not in text


def test_chat_upsert_creates_proposal_not_contact(client):
    from agent_tool_use import _activate_tool_run_ctx, _execute_tool, _tool_run_ctx
    from services.business_db import search_contacts
    from database import list_config_suggestions

    token = _activate_tool_run_ctx("jobchat01", "chat_sync:coordinateur", "coordinateur", chat_mode=True)
    try:
        out = _execute_tool(
            "gestion_upsert_contact",
            {"name": "Coach Chat Proposal", "email": "chat.proposal@example.com"},
        )
    finally:
        _tool_run_ctx.reset(token)
    data = json.loads(out)
    assert data.get("proposal") is True
    found = search_contacts("Coach Chat Proposal")
    assert not any(c.get("email") == "chat.proposal@example.com" for c in found)
    pending = list_config_suggestions(status="pending", limit=20)
    assert any(s.get("kind") == "crm_write" for s in pending)


def test_apply_crm_write_proposal(client):
    from agent_tool_use import _activate_tool_run_ctx, _execute_tool, _tool_run_ctx
    from services.business_db import search_contacts
    from services.config_suggestions import apply_config_suggestion
    from database import list_config_suggestions

    token = _activate_tool_run_ctx("jobchat02", "cio_direct_attempt", "coordinateur", chat_mode=True)
    try:
        _execute_tool(
            "gestion_upsert_contact",
            {"name": "Coach Apply Me", "email": "apply.me@example.com"},
        )
    finally:
        _tool_run_ctx.reset(token)
    sug = next(s for s in list_config_suggestions(status="pending", limit=40) if s.get("kind") == "crm_write")
    applied = apply_config_suggestion(str(sug["id"]))
    assert applied.get("status") == "applied"
    found = search_contacts("Coach Apply Me")
    assert any(c.get("email") == "apply.me@example.com" for c in found)


def test_apply_behavior_allowlist_and_forbid(client):
    from database import get_behavior_setting, insert_config_suggestion
    from services.config_suggestions import apply_config_suggestion
    import pytest

    ok = insert_config_suggestion(
        kind="behavior",
        target_key="behavior:orchestration.tools.sandbox_execute",
        title="Activer sandbox",
        body="sandbox on",
        payload={"behavior_key": "orchestration.tools.sandbox_execute", "value": True},
    )
    applied = apply_config_suggestion(str(ok["id"]))
    assert applied.get("status") == "applied"
    assert get_behavior_setting("orchestration.tools.sandbox_execute") is True

    bad = insert_config_suggestion(
        kind="llm",
        target_key="llm:provider",
        title="Changer le provider",
        body="interdit",
        payload={"provider": "openai"},
    )
    with pytest.raises(PermissionError):
        apply_config_suggestion(str(bad["id"]))


def test_propose_platform_change_tool(client):
    from agent_tool_use import _activate_tool_run_ctx, _execute_tool, _tool_run_ctx
    from database import list_config_suggestions

    token = _activate_tool_run_ctx("jobchat03", "chat_sync:developpeur", "developpeur")
    try:
        out = _execute_tool(
            "propose_platform_change",
            {
                "title": "Ajouter un bouton X",
                "spec": "Le bouton X doit ouvrir Décisions.",
                "files": "admin/app/chat/page.tsx",
                "change_kind": "spec",
            },
        )
    finally:
        _tool_run_ctx.reset(token)
    data = json.loads(out)
    assert data.get("proposal") is True
    pending = list_config_suggestions(status="pending", limit=40)
    assert any(s.get("kind") == "platform_spec" and "bouton X" in str(s.get("title") or "") for s in pending)


def test_classify_chat_intent():
    from services.chat_intelligence import (
        INTENT_CRM,
        INTENT_MISSION,
        INTENT_PLATFORM,
        INTENT_STATUS,
        classify_chat_intent,
        logs_satisfy_grounding,
        wants_mission_brief,
    )

    assert classify_chat_intent("Est-ce que Gmail marche ?") == INTENT_STATUS
    assert classify_chat_intent("Ajoute le coach Dupont au CRM") == INTENT_CRM
    assert classify_chat_intent("Corrige le bug du bouton chat") == INTENT_PLATFORM
    assert classify_chat_intent("Lance une mission avec toute l'équipe") == INTENT_MISSION
    assert wants_mission_brief(INTENT_MISSION, "Lance une mission")
    assert not wants_mission_brief(INTENT_STATUS, "Gmail marche ?")
    assert logs_satisfy_grounding(INTENT_STATUS, ["[outil] web_search"], injected=False) is False
    assert logs_satisfy_grounding(INTENT_STATUS, ["[outil] korymb_overview"], injected=False)
    assert logs_satisfy_grounding(INTENT_STATUS, [], injected=True)


def test_search_core_notes_includes_code():
    from tools.agent_tools import search_core_notes

    out = search_core_notes("korymb_overview", max_results=6, include_code=True)
    assert "korymb_overview" in out.lower()
    assert ".py" in out or "services/" in out


def test_targeted_memory_and_apply_feedback(client):
    from database import merge_enterprise_contexts
    from services.chat_intelligence import (
        build_targeted_memory_block,
        load_chat_apply_feedback,
        record_chat_apply_feedback,
    )

    merge_enterprise_contexts({"global": "- Coach Martin préfère le tutoiement\n- Autre ligne hors sujet"})
    block = build_targeted_memory_block("parle du coach Martin")
    assert "Martin" in block
    record_chat_apply_feedback(title="CRM chat — Coach Apply", kind="crm_write", detail="ok")
    fb = load_chat_apply_feedback(limit=3)
    assert any("Coach Apply" in str(x.get("title") or "") for x in fb)
    block2 = build_targeted_memory_block("quoi de neuf")
    assert "Récemment validé" in block2 or "Coach Apply" in block2
