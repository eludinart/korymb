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


def test_approve_social_chains_follow_up(client, monkeypatch):
    monkeypatch.setattr(
        "tools.run_post_instagram",
        lambda caption, image_url="": "✅ Post Instagram publié",
    )
    create = client.post(
        "/actions",
        json={
            "kind": "social",
            "title": "Instagram — Agapé",
            "payload": {
                "platform": "instagram",
                "tool": "post_instagram",
                "caption": "Carte Agapé — invitation douce.",
            },
        },
    )
    tid = create.json()["id"]
    resolved = client.post(f"/actions/{tid}/resolve", json={"decision": "approve"})
    assert resolved.status_code == 200, resolved.text
    chain = resolved.json().get("chain") or {}
    assert chain.get("published") is True
    assert chain.get("follow_up", {}).get("id")
    assert any("publié" in s.lower() for s in (chain.get("steps") or []))

    from services.business_db import list_calendar_events

    events = list_calendar_events(limit=20)
    assert any(e.get("id") == chain["follow_up"]["id"] for e in events)


def test_cio_plan_approve_returns_launch_chain(client):
    from database import job_set_awaiting_hitl, save_job

    save_job("ciochain1", "coordinateur", "Mission éditeurs", source="test")
    assert job_set_awaiting_hitl(
        "ciochain1",
        {
            "kind": "cio_plan",
            "mission": "Mission éditeurs",
            "plan_public": {"synthese_attendue": "Cartographier", "sous_taches": {"commercial": "Lister"}},
        },
    )
    inbox = client.get("/admin/inbox")
    assert inbox.status_code == 200
    item = next(
        i
        for i in inbox.json()["items"]
        if i.get("job_id") == "ciochain1" and i.get("kind") == "hitl"
    )
    assert item.get("hitl_kind") == "cio_plan"
    assert item.get("primary_cta") == "Valider et lancer"

    resolved = client.post("/jobs/ciochain1/hitl/resolve", json={"decision": "approve"})
    assert resolved.status_code == 200, resolved.text
    body = resolved.json()
    assert body.get("success") is True
    assert body.get("new_status") == "running"
    chain = body.get("chain") or {}
    assert chain.get("launched") is True
    assert any("relancée" in s.lower() or "relancee" in s.lower() for s in (chain.get("steps") or []))


def test_approve_email_chains_crm_and_follow_up(client, monkeypatch):
    """Approuver un e-mail : envoi + journal CRM + fil e-mail + créneau relance planning."""
    from services.business_db import create_contact, list_calendar_events, list_interactions
    from services.email_prospecting import list_contact_email_threads

    contact = create_contact(
        name="Coach Relance",
        email="relance@example.com",
        contact_type="prospect",
        tags=["coach"],
    )
    cid = contact["id"]

    monkeypatch.setattr("services.action_executor._gmail_configured", lambda: False)
    monkeypatch.setattr(
        "tools.run_send_email",
        lambda to, subject, body: f"✅ Email envoyé à {to}",
    )

    create = client.post(
        "/actions",
        json={
            "kind": "email",
            "title": "E-mail — Relance module",
            "payload": {
                "to": "relance@example.com",
                "subject": "Module Pro",
                "body": "Bonjour, suite à notre échange.",
                "contact_id": cid,
                "follow_up_days": 7,
            },
        },
    )
    assert create.status_code == 200, create.text
    tid = create.json()["id"]

    resolved = client.post(f"/actions/{tid}/resolve", json={"decision": "approve", "source": "inbox"})
    assert resolved.status_code == 200, resolved.text
    body = resolved.json()
    assert body["success"] is True
    assert body["ticket"]["status"] == "executed"
    chain = body.get("chain") or {}
    assert chain.get("sent") is True
    assert chain.get("crm_logged") is True
    assert chain.get("contact_id") == cid
    assert chain.get("email_thread_id")
    assert chain.get("follow_up", {}).get("id")
    assert any("envoyé" in s.lower() for s in (chain.get("steps") or []))

    interactions = list_interactions(contact_id=cid, limit=10)
    assert any(i.get("interaction_type") == "email" for i in interactions)

    threads = list_contact_email_threads(cid, limit=5)
    assert len(threads) >= 1
    assert threads[0].get("status") == "open"
    assert any(m.get("direction") == "outbound" for m in (threads[0].get("messages") or []))

    events = list_calendar_events(limit=20)
    assert any(
        (e.get("id") == chain["follow_up"]["id"]) or ("Relance" in (e.get("title") or ""))
        for e in events
    )


def test_prepare_contact_email_and_inbound_cancels_follow_up(client, monkeypatch):
    """Fiche contact → ticket HITL ; réponse inbound annule la relance Relance —…"""
    from services.business_db import create_contact, create_calendar_event, get_calendar_event
    from services.email_prospecting import (
        list_contact_email_threads,
        record_inbound_reply,
        record_outbound_email,
    )

    contact = create_contact(
        name="Prospect Mail",
        email="prospect.mail@example.com",
        contact_type="prospect",
        outreach_suggestions="Bonjour, proposition module…",
    )
    cid = contact["id"]

    prep = client.post(
        f"/business/contacts/{cid}/emails/prepare",
        json={"subject": "Proposition", "body": "Corps test"},
    )
    assert prep.status_code == 200, prep.text
    ticket = prep.json().get("ticket") or {}
    assert ticket.get("id")
    assert ticket.get("status") == "pending"

    recorded = record_outbound_email(
        contact_id=cid,
        to_email="prospect.mail@example.com",
        subject="Proposition",
        body="Corps test",
        ticket_id=ticket["id"],
    )
    thread = recorded["thread"]
    event = create_calendar_event(
        title=f"Relance — {contact['name']}",
        starts_at="2030-01-15T09:00:00",
        ends_at="2030-01-15T09:30:00",
        contact_id=cid,
        event_type="autre",
        status="planned",
        notes="auto test",
    )
    from services.email_prospecting import attach_follow_up_to_thread

    attach_follow_up_to_thread(thread["id"], event["id"])

    result = record_inbound_reply(
        contact_id=cid,
        thread=thread,
        subject="Re: Proposition",
        body="Merci, intéressé.",
        from_email="prospect.mail@example.com",
        gmail_message_id="gmsg-test-1",
    )
    assert (result.get("thread") or {}).get("status") == "replied"
    assert any(c.get("id") == event["id"] for c in (result.get("cancelled_follow_ups") or []))
    refreshed = get_calendar_event(event["id"])
    assert refreshed and refreshed.get("status") == "cancelled"

    threads = list_contact_email_threads(cid)
    assert threads[0]["status"] == "replied"
    assert any(m.get("direction") == "inbound" for m in threads[0].get("messages") or [])

    listed = client.get(f"/business/contacts/{cid}/emails")
    assert listed.status_code == 200
    assert len(listed.json().get("threads") or []) >= 1


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
