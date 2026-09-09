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


def test_business_contact_reachability_and_enrichment(client):
    create = client.post(
        "/business/contacts",
        json={
            "name": "Prospect Partiel",
            "email": "partial@example.com",
            "website": "https://example.com",
            "city": "Draguignan",
        },
    )
    assert create.status_code == 200
    body = create.json()
    cid = body["id"]
    assert body["website"] == "https://example.com"
    assert body["reachability"]["level"] == "complete"
    assert body["reachability"]["score"] >= 45

    blocked = client.post(f"/business/contacts/{cid}/explore")
    assert blocked.status_code == 409

    upd = client.put(
        f"/business/contacts/{cid}",
        json={"email": "", "website": "", "phone": "", "linkedin_url": ""},
    )
    assert upd.status_code == 200
    assert upd.json()["reachability"]["level"] == "unreachable"

    explore = client.post(f"/business/contacts/{cid}/explore")
    assert explore.status_code == 200
    assert explore.json()["job_id"]
    assert explore.json()["agent"] == "commercial"

    from tools.registry_business import dispatch_business_tool

    propose = dispatch_business_tool(
        "gestion_propose_contact_enrichment",
        {
            "contact_id": cid,
            "email": "found@example.com",
            "phone": "+33600000000",
            "linkedin_url": "https://linkedin.com/in/test",
            "instagram": "https://instagram.com/test",
            "summary": "Trouvé via site + LinkedIn",
            "sources": ["https://example.com", "LinkedIn"],
            "job_id": explore.json()["job_id"],
            "agent_key": "commercial",
        },
    )
    assert "proposal" in propose or '"proposal"' in propose

    pending = client.get(f"/business/contacts/{cid}/enrichment-proposals?status=pending")
    assert pending.status_code == 200
    proposals = pending.json()["proposals"]
    assert len(proposals) == 1
    pid = proposals[0]["id"]
    assert proposals[0]["proposed"]["email"] == "found@example.com"
    assert proposals[0]["proposed"]["socials"]["instagram"]

    apply = client.post(
        f"/business/contacts/{cid}/enrichment-proposals/{pid}/apply",
        json={"fields": ["email", "phone", "linkedin_url", "socials"]},
    )
    assert apply.status_code == 200
    contact = apply.json()["contact"]
    assert contact["email"] == "found@example.com"
    assert contact["phone"] == "+33600000000"
    assert contact["linkedin_url"] == "https://linkedin.com/in/test"
    assert contact["socials"]["instagram"]
    assert contact["verified_at"]
    assert contact["reachability"]["level"] == "complete"

    again = client.get(f"/business/contacts/{cid}/enrichment-proposals?status=pending")
    assert again.json()["proposals"] == []


def test_business_enrichment_reject(client):
    contact = client.post("/business/contacts", json={"name": "À rejeter"}).json()
    from tools.registry_business import dispatch_business_tool

    dispatch_business_tool(
        "gestion_propose_contact_enrichment",
        {
            "contact_id": contact["id"],
            "email": "skip@example.com",
            "summary": "Proposition à ignorer",
        },
    )
    pid = client.get(
        f"/business/contacts/{contact['id']}/enrichment-proposals?status=pending",
    ).json()["proposals"][0]["id"]

    reject = client.post(
        f"/business/contacts/{contact['id']}/enrichment-proposals/{pid}/reject",
    )
    assert reject.status_code == 200
    assert reject.json()["proposal"]["status"] == "rejected"
    assert (
        client.get(f"/business/contacts/{contact['id']}/enrichment-proposals?status=pending").json()["proposals"]
        == []
    )


def test_business_contact_exploration_endpoint(client):
    contact = client.post("/business/contacts", json={"name": "Sans explor"}).json()
    empty = client.get(f"/business/contacts/{contact['id']}/exploration")
    assert empty.status_code == 200
    assert empty.json()["job_id"] is None
    assert empty.json()["result"] is None

    explore = client.post(f"/business/contacts/{contact['id']}/explore")
    assert explore.status_code == 200
    job_id = explore.json()["job_id"]

    # Sans résultat encore : la mission vient d'être planifiée
    row = client.get(f"/business/contacts/{contact['id']}/exploration")
    assert row.status_code == 200
    assert row.json()["job_id"] == job_id


def test_rebalance_notes_moves_approach_angle(client):
    create = client.post(
        "/business/contacts",
        json={
            "name": "Split Notes",
            "notes": (
                "Thérapeute familiale à Brignoles. Source : Pages Jaunes. "
                "Angle d'approche : intégrer le Tarot Fleur d'ÅmÔurs dans ses ateliers parents-ados."
            ),
        },
    )
    assert create.status_code == 200
    # create_contact split déjà à la création
    body = create.json()
    assert "Thérapeute familiale" in body["notes"]
    assert "Angle d'approche" not in body["notes"]
    assert "Tarot" in (body.get("outreach_suggestions") or "")

    # Remélange volontairement puis rebalance
    cid = body["id"]
    client.put(
        f"/business/contacts/{cid}",
        json={
            "notes": "Faits métier. Angle d'approche : proposer un atelier découverte.",
            "outreach_suggestions": "",
        },
    )
    reb = client.post(f"/business/contacts/{cid}/rebalance-notes")
    assert reb.status_code == 200
    assert reb.json()["changed"] is True
    c = reb.json()["contact"]
    assert c["notes"] == "Faits métier"
    assert "atelier découverte" in c["outreach_suggestions"]

    batch = client.post("/business/contacts/rebalance-notes")
    assert batch.status_code == 200
    assert batch.json()["scanned"] >= 1


def test_outreach_suggestions_launch_and_apply(client):
    contact = client.post(
        "/business/contacts",
        json={
            "name": "Outreach Target",
            "email": "out@example.com",
            "notes": "Coach systémique Var.",
            "outreach_suggestions": "Angle d'approche : premier contact LinkedIn.",
        },
    ).json()
    cid = contact["id"]

    launch = client.post(f"/business/contacts/{cid}/outreach")
    assert launch.status_code == 200
    job_id = launch.json()["job_id"]

    status = client.get(f"/business/contacts/{cid}/outreach")
    assert status.status_code == 200
    assert status.json()["job_id"] == job_id

    from database import update_job

    update_job(
        job_id,
        status="completed",
        result=(
            "### Suggestions avancées\n"
            "- **Canal :** email perso\n"
            "- **Accroche :** cartographie relationnelle parents-ados\n"
            "- **Prochaine action :** proposer un atelier découverte de 90 min\n"
        ),
    )

    apply = client.post(f"/business/contacts/{cid}/outreach/apply")
    assert apply.status_code == 200, apply.text
    assert apply.json()["applied"] is True
    updated = apply.json()["contact"]
    assert "atelier découverte" in (updated.get("outreach_suggestions") or "").lower()


def test_fill_contact_from_exploration_result(client, monkeypatch):
    contact = client.post("/business/contacts", json={"name": "FillMe Corp", "company": "FillMe"}).json()
    cid = contact["id"]

    sample = """
Voici les infos.

### 1. Données de contact
| Champ | Valeur |
| Email | found@fillme.test |
| Téléphone | +33 6 12 34 56 78 |
| Site web | https://www.fillme.test |
| LinkedIn | https://fr.linkedin.com/company/fillme |
| Adresse | 10 Rue Test, 75001 Paris, France |

### 2. Informations complémentaires
Cabinet de coaching d'équipes, spécialisé intelligence collective.

### 3. Notes pour l'approche commerciale
Proposer le tarot comme médiateur visuel dans leurs ateliers problem-solving.
Canal : email contact@ + LinkedIn. Offre : module pro coachs.
"""

    from database import save_job, update_job

    jid = "filltest01ab"
    save_job(jid, "commercial", "explore", source=f"contact_explore:{cid}")
    update_job(jid, status="completed", result=sample)

    fill = client.post(f"/business/contacts/{cid}/exploration/fill", json={"apply": True})
    assert fill.status_code == 200, fill.text
    body = fill.json()
    assert body["applied"] is True
    c = body["contact"]
    assert c["email"] == "found@fillme.test"
    assert "612345678" in c["phone"].replace(" ", "")
    assert c["website"] == "https://www.fillme.test"
    assert "linkedin.com/company/fillme" in c["linkedin_url"]
    assert c["city"] == "Paris"
    assert c["postal_code"] == "75001"
    assert c["verified_at"]
    assert "intelligence collective" in (c.get("notes") or "").lower() or "coaching" in (c.get("notes") or "").lower()
    assert "médiateur" in (c.get("outreach_suggestions") or "").lower() or "module" in (c.get("outreach_suggestions") or "").lower()

    again = client.post(f"/business/contacts/{cid}/exploration/fill", json={"apply": True})
    assert again.status_code == 200
    assert again.json()["reason"] == "already_applied_for_job"


def test_extract_contact_fields_ignores_unlabeled_noise():
    from services.business_db import extract_contact_fields_from_exploration

    noisy = """
Sources consultées : https://www.google.com/search?q=marie+dupont
Un homonyme :  jean.autre@pagesjaunes.fr et https://www.facebook.com/gaming/xyz
Téléphone d'un voisin : 04 94 00 00 00

### 1. Données de contact
| Champ | Valeur |
| Email | non trouvé |
| Site web | https://www.google.com/search?q=test |
| LinkedIn | https://fr.linkedin.com/in/marie-cible |
"""
    fields = extract_contact_fields_from_exploration(noisy)
    assert "email" not in fields
    assert "phone" not in fields
    assert "website" not in fields
    assert fields.get("linkedin_url", "").endswith("/in/marie-cible") or "marie-cible" in str(
        fields.get("linkedin_url") or ""
    )


def test_fill_exploration_defaults_to_proposal_not_write(client):
    contact = client.post("/business/contacts", json={"name": "NoAutoWrite"}).json()
    cid = contact["id"]
    sample = """
### 1. Données de contact
| Champ | Valeur |
| Email | sure@cible.test |
| Site web | https://www.cible.test |
"""
    from database import save_job, update_job

    jid = "fillprop01ab"
    save_job(jid, "commercial", "explore", source=f"contact_explore:{cid}")
    update_job(jid, status="completed", result=sample)

    fill = client.post(f"/business/contacts/{cid}/exploration/fill", json={"apply": False})
    assert fill.status_code == 200, fill.text
    body = fill.json()
    assert body["applied"] is False
    pending = client.get(f"/business/contacts/{cid}/enrichment-proposals?status=pending")
    assert pending.status_code == 200
    assert len(pending.json()["proposals"]) == 1
    fresh = client.get(f"/business/contacts/{cid}").json()
    assert not fresh.get("email")


def test_website_must_belong_to_contact():
    from services.business_db import sanitize_proposed_against_contact, website_belongs_to_contact

    contact = {"name": "Sophie Carniaux", "company": "Galerie de l'Atelier"}
    assert website_belongs_to_contact("https://www.sophiecarniaux.fr", contact) is True
    assert website_belongs_to_contact("https://eludein.art", contact) is False
    assert website_belongs_to_contact("https://app-fleurdamours.eludein.art", contact) is False
    assert website_belongs_to_contact("https://www.resalib.fr/praticien/56942-sophie-carniaux", contact) is False
    assert website_belongs_to_contact("https://www.levaretvous.com/events/atelier", contact) is False
    cleaned = sanitize_proposed_against_contact(
        contact,
        {"website": "https://eludein.art", "email": "sophiecarniaux@gmail.com", "phone": "+33617471590"},
    )
    assert "website" not in cleaned
    assert cleaned["email"] == "sophiecarniaux@gmail.com"


def test_extract_drops_signature_website():
    from services.business_db import extract_contact_fields_from_exploration, sanitize_proposed_against_contact

    sample = """
### 1. Données de contact
| Champ | Valeur |
| Email | sophiecarniaux@gmail.com |
| Site web | https://eludein.art |

Bien à vous,
Éric
[eludein.art](https://eludein.art)
"""
    fields = extract_contact_fields_from_exploration(sample)
    assert "website" not in fields
    contact = {"name": "Sophie Carniaux"}
    assert "website" not in sanitize_proposed_against_contact(contact, {"website": "https://eludein.art", "email": fields["email"]})


