"""File d'actions HITL — e-mail enqueue puis exécution après validation."""
from __future__ import annotations

from agent_tool_use import _activate_tool_run_ctx, _execute_tool, _tool_run_ctx


def test_sandbox_execute_forced_on(client):
    from database import get_behavior_setting

    assert get_behavior_setting("orchestration.tools.sandbox_execute") is True


def test_send_email_enqueues_pending_ticket(client):
    token = _activate_tool_run_ctx("jobmail01", "commercial", "commercial")
    try:
        out = _execute_tool(
            "send_email",
            {"to": "coach@example.com", "subject": "Relance devis", "body": "Bonjour, suite à notre échange."},
        )
    finally:
        _tool_run_ctx.reset(token)
    assert "[en file]" in out
    assert "Aucun envoi" in out or "attente" in out.lower()

    listed = client.get("/actions?status=pending")
    assert listed.status_code == 200
    actions = listed.json()["actions"]
    assert any(a.get("kind") == "email" and "Relance devis" in (a.get("title") or "") for a in actions)

    inbox = client.get("/admin/inbox")
    assert inbox.status_code == 200
    item = next(
        i for i in inbox.json()["items"]
        if i.get("kind") == "action_ticket" and (i.get("payload") or {}).get("to") == "coach@example.com"
    )
    assert item["payload"]["to"] == "coach@example.com"
    assert item["ticket_id"]


def test_calendar_tool_enqueues(client):
    out = _execute_tool(
        "create_calendar_event",
        {"summary": "Séance", "start_at": "2026-09-10T10:00:00", "end_at": "2026-09-10T11:00:00"},
    )
    assert "[en file]" in out
    listed = client.get("/actions?status=pending")
    assert any("Agenda — Séance" in (a.get("title") or "") for a in listed.json()["actions"])


def test_approve_executes_calendar(client, monkeypatch):
    monkeypatch.setattr(
        "tools.google_api.run_create_calendar_event",
        lambda *a, **k: "✅ Événement créé : Séance (id: 1)",
    )
    create = client.post(
        "/actions",
        json={
            "kind": "calendar",
            "title": "Agenda — Séance",
            "payload": {
                "summary": "Séance",
                "start_at": "2026-09-10T10:00:00Z",
                "end_at": "2026-09-10T11:00:00Z",
            },
        },
    )
    tid = create.json()["id"]
    resolved = client.post(f"/actions/{tid}/resolve", json={"decision": "approve"})
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["ticket"]["status"] == "executed"


def test_social_tool_enqueues(client):
    out = _execute_tool("post_instagram", {"caption": "Carte Agapé — invitation douce."})
    assert "[en file]" in out
    assert "instagram" in out.lower()


def test_wordpress_enqueue_and_publish(client, monkeypatch):
    monkeypatch.setattr("tools.wordpress.wordpress_configured", lambda: False)
    monkeypatch.setattr(
        "tools.wordpress.run_wordpress_create_post",
        lambda *a, **k: "✅ Article WordPress publish (id: 42)\nhttps://eludein.art/?p=42",
    )
    out = _execute_tool("wordpress_create_post", {"title": "Fleur", "content": "<p>Hello</p>"})
    assert "[en file]" in out
    listed = client.get("/actions?status=pending")
    ticket = next(a for a in listed.json()["actions"] if a.get("kind") == "wordpress")
    resolved = client.post(f"/actions/{ticket['id']}/resolve", json={"decision": "approve"})
    assert resolved.status_code == 200, resolved.text


def test_telegram_webhook_approve(client, monkeypatch):
    sent: list[tuple] = []
    monkeypatch.setattr("services.action_executor._gmail_configured", lambda: False)
    monkeypatch.setattr("tools.run_send_email", lambda to, subject, body: sent.append((to, subject, body)) or f"✅ Email envoyé à {to}")
    create = client.post(
        "/actions",
        json={
            "kind": "email",
            "title": "E-mail — TG",
            "payload": {"to": "tg@example.com", "subject": "Hi", "body": "x"},
        },
    )
    tid = create.json()["id"]
    monkeypatch.setattr("services.action_telegram.answer_callback", lambda *a, **k: None)
    r = client.post(
        "/telegram/webhook",
        json={"callback_query": {"id": "cb1", "data": f"k:a:{tid}"}},
    )
    assert r.status_code == 200, r.text
    assert sent == [("tg@example.com", "Hi", "x")]


def test_approve_executes_email(client, monkeypatch):
    sent: list[tuple[str, str, str]] = []

    def fake_send(to: str, subject: str, body: str) -> str:
        sent.append((to, subject, body))
        return f"✅ Email envoyé à {to}"

    monkeypatch.setattr("services.action_executor._gmail_configured", lambda: False)
    monkeypatch.setattr("tools.run_send_email", fake_send)

    create = client.post(
        "/actions",
        json={
            "kind": "email",
            "title": "E-mail — Test HITL",
            "summary": "À : dest@example.com",
            "payload": {"to": "dest@example.com", "subject": "Hello", "body": "Corps"},
            "source": "test",
        },
    )
    assert create.status_code == 200
    tid = create.json()["id"]

    resolved = client.post(f"/actions/{tid}/resolve", json={"decision": "approve", "source": "inbox"})
    assert resolved.status_code == 200, resolved.text
    body = resolved.json()
    assert body["success"] is True
    assert body["ticket"]["status"] == "executed"
    assert sent == [("dest@example.com", "Hello", "Corps")]

    again = client.post(f"/actions/{tid}/resolve", json={"decision": "approve"})
    assert again.status_code == 409


def test_reject_does_not_send(client, monkeypatch):
    monkeypatch.setattr(
        "tools.run_send_email",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("send_email ne doit pas être appelé")),
    )
    create = client.post(
        "/actions",
        json={
            "kind": "email",
            "title": "E-mail — Rejet",
            "payload": {"to": "x@example.com", "subject": "Nope", "body": "…"},
        },
    )
    tid = create.json()["id"]
    rejected = client.post(f"/actions/{tid}/resolve", json={"decision": "reject", "comment": "pas maintenant"})
    assert rejected.status_code == 200
    assert rejected.json()["ticket"]["status"] == "rejected"
