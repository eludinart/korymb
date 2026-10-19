"""Règle d'outils : lecture libre, CRM noté, sortie externe arrêtée."""
from __future__ import annotations

from agent_tool_use import _execute_tool
from services.tool_policy import CRM_WRITE, EXTERNAL, READ, classify_tool


def test_classify_three_effects():
    assert classify_tool("web_search") == READ
    assert classify_tool("gestion_search_contacts") == READ
    assert classify_tool("gestion_create_quote") == CRM_WRITE
    assert classify_tool("gestion_log_interaction") == CRM_WRITE
    assert classify_tool("send_email") == EXTERNAL
    assert classify_tool("send_whatsapp_message") == EXTERNAL
    assert classify_tool("gestion_request_tiime_invoice") == EXTERNAL


def test_whatsapp_never_sends_live(monkeypatch):
    called = {"n": 0}

    def boom(*_a, **_k):
        called["n"] += 1
        return "envoyé"

    monkeypatch.setattr("tools.platforms.run_send_whatsapp_message", boom)
    monkeypatch.setattr("database.get_behavior_setting", lambda key: False)
    out = _execute_tool("send_whatsapp_message", {"to_phone": "+33600000000", "message": "salut"})
    assert called["n"] == 0
    assert "bloquée" in out
    assert "whatsapp" in out.lower() or "send_whatsapp_message" in out


def test_crm_write_is_not_blocked(monkeypatch):
    monkeypatch.setattr(
        "agent_tool_use.dispatch_business_tool",
        lambda name, inp: f"ok:{name}",
    )
    out = _execute_tool("gestion_create_quote", {"title": "Devis test"})
    assert out.startswith("ok:")
    assert "bloquée" not in out


def test_send_email_still_opens_a_ticket(client):
    out = _execute_tool(
        "send_email",
        {"to": "a@example.com", "subject": "Politique", "body": "Bonjour"},
    )
    assert "[en file]" in out
    listed = client.get("/actions?status=pending")
    assert listed.status_code == 200
    assert any("Politique" in (a.get("title") or "") for a in listed.json()["actions"])
