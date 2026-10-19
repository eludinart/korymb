"""Telegram HITL : refus sans workspace_id (pas de repli legacy)."""
from __future__ import annotations


def test_telegram_webhook_refuses_ticket_without_workspace(client, monkeypatch):
    monkeypatch.setattr(
        "services.action_queue.get_action_unscoped",
        lambda tid: {"id": tid, "workspace_id": "", "kind": "email", "status": "pending"},
    )
    answered: list[str] = []
    monkeypatch.setattr(
        "services.action_telegram.answer_callback",
        lambda cb, text: answered.append(str(text)),
    )
    r = client.post(
        "/telegram/webhook",
        json={"callback_query": {"id": "cb-missing-ws", "data": "k:a:ticket-no-ws"}},
    )
    assert r.status_code == 200
    body = r.json()
    assert body.get("ok") is False
    assert body.get("error") == "missing_workspace"
    assert answered and "espace" in answered[0].lower()
