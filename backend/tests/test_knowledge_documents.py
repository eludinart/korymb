"""API knowledge_documents — CRUD + archive."""
from __future__ import annotations


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
