"""API knowledge_documents — CRUD + archive + migrate calendrier science."""
from __future__ import annotations

from datetime import datetime, timedelta


def test_knowledge_document_crud_and_archive(client):
    created = client.post(
        "/business/knowledge-documents",
        json={
            "title": "Note de positionnement",
            "summary": "Résumé court",
            "content_md": "## Angle\n\nTexte **markdown**.",
            "category": "Stratégie",
            "tags": ["korymb", "position"],
        },
    )
    assert created.status_code == 200, created.text
    doc = created.json()
    assert doc["id"].startswith("kd-")
    assert doc["title"] == "Note de positionnement"
    assert doc["tags"] == ["korymb", "position"]
    assert doc["status"] == "active"

    listed = client.get("/business/knowledge-documents")
    assert listed.status_code == 200
    ids = [d["id"] for d in listed.json()["documents"]]
    assert doc["id"] in ids

    got = client.get(f"/business/knowledge-documents/{doc['id']}")
    assert got.status_code == 200
    assert "markdown" in got.json()["content_md"]

    updated = client.put(
        f"/business/knowledge-documents/{doc['id']}",
        json={"summary": "Mis à jour", "category": "Vision"},
    )
    assert updated.status_code == 200
    assert updated.json()["summary"] == "Mis à jour"
    assert updated.json()["category"] == "Vision"

    archived = client.post(f"/business/knowledge-documents/{doc['id']}/archive")
    assert archived.status_code == 200
    assert archived.json()["status"] == "archived"

    active = client.get("/business/knowledge-documents")
    assert doc["id"] not in [d["id"] for d in active.json()["documents"]]

    with_arch = client.get("/business/knowledge-documents?include_archived=true")
    assert doc["id"] in [d["id"] for d in with_arch.json()["documents"]]


def test_knowledge_document_requires_title(client):
    res = client.post("/business/knowledge-documents", json={"title": "  "})
    assert res.status_code in (422, 400)


def test_is_science_calendar_migrate_candidate_excludes_noise():
    from services.knowledge_documents import is_science_calendar_migrate_candidate

    base = {
        "resource_file_id": "rfil-abc",
        "nature": "matiere",
        "resource_type": "document",
        "status": "planned",
        "notes": "",
    }
    assert is_science_calendar_migrate_candidate(
        {**base, "title": "Charte partenariats 2026"}
    )
    assert not is_science_calendar_migrate_candidate(
        {**base, "title": "[DEMO ESPACE] Note de séance — document"}
    )
    assert not is_science_calendar_migrate_candidate(
        {**base, "title": "test plannification"}
    )
    assert not is_science_calendar_migrate_candidate(
        {**base, "title": 'PDF Brandé : "Accompagnement Individuel"'}
    )
    assert not is_science_calendar_migrate_candidate(
        {**base, "title": "Document PDF", "notes": "Studio job ff37d9e3dc1c"}
    )
    assert not is_science_calendar_migrate_candidate(
        {**base, "title": "Note utile", "notes": "Studio job abc123", "resource_file_id": "rfil-x"}
    )
    assert not is_science_calendar_migrate_candidate({**base, "resource_file_id": ""})
    assert not is_science_calendar_migrate_candidate(
        {**base, "title": "Ok", "status": "cancelled"}
    )
    assert not is_science_calendar_migrate_candidate(None)


def test_migrate_calendar_pending_ignores_demo_studio_and_duplicates(client):
    from services.business_db import create_calendar_event
    from services.knowledge_documents import migrate_calendar_document_events
    from services.science_overview import get_science_overview

    starts = (datetime.utcnow() + timedelta(days=1)).isoformat()
    shared = "rfil-studio-dup-001"
    noise = [
        ("[DEMO ESPACE] Fiche personnelle", "rfil-demo-1", "Pour vous uniquement."),
        ("test plannification", "rfil-test-1", "test note"),
        ('PDF Brandé : "Fleur"', shared, "Studio job ff37d9e3dc1c"),
        ("Document PDF", shared, "Studio job ff37d9e3dc1c"),
        ("PDF Brandé : encore", shared, "Studio job ff37d9e3dc1c"),
    ]
    for title, fid, notes in noise:
        create_calendar_event(
            title=title,
            starts_at=starts,
            nature="matiere",
            resource_type="document",
            resource_file_id=fid,
            notes=notes,
            event_type="ressource",
        )

    dry = migrate_calendar_document_events(dry_run=True)
    assert dry["ok"] is True
    assert dry["created"] == 0
    assert dry["filtered"] >= 5
    assert get_science_overview()["calendar_migrate"]["pending_count"] == 0

    create_calendar_event(
        title="Guide onboarding partenaires",
        starts_at=starts,
        nature="matiere",
        resource_type="document",
        resource_file_id="rfil-science-ok-1",
        notes="Process interne confirmé.",
        event_type="ressource",
    )
    dry2 = migrate_calendar_document_events(dry_run=True)
    assert dry2["created"] == 1
    assert get_science_overview()["calendar_migrate"]["pending_count"] == 1

    run = migrate_calendar_document_events(dry_run=False)
    assert run["created"] == 1
    assert migrate_calendar_document_events(dry_run=True)["created"] == 0
    assert get_science_overview()["calendar_migrate"]["pending_count"] == 0


def test_migrate_calendar_skips_already_materialized_file(client):
    from services.business_db import create_calendar_event
    from services.knowledge_documents import (
        create_knowledge_document,
        migrate_calendar_document_events,
    )

    starts = (datetime.utcnow() + timedelta(days=2)).isoformat()
    fid = "rfil-already-in-kd"
    create_knowledge_document(
        title="Déjà en science",
        content_md="corps",
        resource_file_id=fid,
        category="Interne",
    )
    create_calendar_event(
        title="Même fichier calendrier",
        starts_at=starts,
        nature="matiere",
        resource_type="document",
        resource_file_id=fid,
        notes="Doublon fichier",
        event_type="ressource",
    )
    dry = migrate_calendar_document_events(dry_run=True)
    assert dry["created"] == 0
    assert dry["skipped"] >= 1
