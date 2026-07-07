"""Contrats API gestion métier (contacts, projets, devis, planning, Tiime)."""
from __future__ import annotations


def test_business_overview(client):
    r = client.get("/business/overview")
    assert r.status_code == 200
    body = r.json()
    assert "stats" in body
    assert "tiime" in body
    assert "contacts_active" in body["stats"]


def test_business_contacts_crud(client):
    create = client.post(
        "/business/contacts",
        json={
            "name": "Coach Test",
            "email": "coach@example.com",
            "contact_type": "prospect",
            "tags": ["fleur"],
        },
    )
    assert create.status_code == 200
    cid = create.json()["id"]
    assert create.json()["name"] == "Coach Test"

    lst = client.get("/business/contacts")
    assert lst.status_code == 200
    assert any(c["id"] == cid for c in lst.json()["contacts"])

    upd = client.put(f"/business/contacts/{cid}", json={"contact_type": "client"})
    assert upd.status_code == 200
    assert upd.json()["contact_type"] == "client"

    delete = client.delete(f"/business/contacts/{cid}")
    assert delete.status_code == 200


def test_business_project_and_event(client):
    contact = client.post("/business/contacts", json={"name": "Client Stage"}).json()
    project = client.post(
        "/business/projects",
        json={
            "title": "Stage SÏvåñà été",
            "contact_id": contact["id"],
            "project_type": "sivana",
            "status": "active",
            "location": "Haut-Var",
        },
    )
    assert project.status_code == 200
    pid = project.json()["id"]

    event = client.post(
        "/business/events",
        json={
            "title": "Jour 1 stage",
            "starts_at": "2026-08-01T09:00:00",
            "ends_at": "2026-08-01T17:00:00",
            "project_id": pid,
            "contact_id": contact["id"],
            "event_type": "stage",
        },
    )
    assert event.status_code == 200
    events = client.get("/business/events")
    assert any(e["id"] == event.json()["id"] for e in events.json()["events"])


def test_business_quote_and_tiime_reference(client):
    quote = client.post(
        "/business/quotes",
        json={
            "title": "Module Pro — Groupe A",
            "lines": [
                {"label": "Formation 2 jours", "qty": 1, "unit_price_cents": 120000, "tax_rate": 0},
            ],
            "status": "draft",
        },
    )
    assert quote.status_code == 200
    q = quote.json()
    assert q["quote_number"].startswith("DEV-")
    assert q["total_cents"] == 120000

    tiime = client.post(f"/business/quotes/{q['id']}/request-tiime-invoice")
    assert tiime.status_code == 200
    assert tiime.json()["mode"] in ("manual", "webhook")

    inv = client.post(
        "/business/external-invoices",
        json={
            "quote_id": q["id"],
            "tiime_invoice_id": "TII-2026-0042",
            "external_url": "https://app.tiime.fr/",
            "tiime_status": "issued",
        },
    )
    assert inv.status_code == 200
    assert inv.json()["tiime_invoice_id"] == "TII-2026-0042"

    get_q = client.get(f"/business/quotes/{q['id']}")
    assert get_q.status_code == 200
    assert get_q.json()["status"] == "accepted"
    assert len(get_q.json().get("external_invoices") or []) >= 1


def test_business_interactions_list(client):
    contact = client.post(
        "/business/contacts",
        json={"name": "Historique Test", "email": "hist@example.com"},
    ).json()
    assert contact["id"]

    from tools.registry_business import dispatch_business_tool

    dispatch_business_tool(
        "gestion_log_interaction",
        {
            "contact_id": contact["id"],
            "interaction_type": "prospection",
            "summary": "Premier contact LinkedIn",
            "agent_key": "commercial",
            "job_id": "job-hist-1",
        },
    )

    r = client.get(f"/business/interactions?contact_id={contact['id']}")
    assert r.status_code == 200
    rows = r.json()["interactions"]
    assert len(rows) >= 1
    assert rows[0]["summary"] == "Premier contact LinkedIn"
