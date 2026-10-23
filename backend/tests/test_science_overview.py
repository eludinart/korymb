"""API science-overview — agrégat lecture seule pour le hub Science."""
from __future__ import annotations


def test_science_overview_shape(client):
    res = client.get("/business/science-overview")
    assert res.status_code == 200, res.text
    body = res.json()
    assert "facts" in body and isinstance(body["facts"], dict)
    assert "global_preview" in body
    assert "global_md" in body
    assert isinstance(body["global_md"], str)
    preview = body["global_preview"]
    assert "text" in preview and "chars" in preview and "has_more" in preview
    assert isinstance(body.get("persons"), list)
    assert isinstance(body.get("entities"), list)
    docs = body.get("documents") or {}
    assert "count" in docs and "recent" in docs
    guide = body.get("context_guide") or {}
    assert "offers" in guide and "offers_mode" in guide
    assert "calendar_migrate" in body
    assert "pending_count" in body["calendar_migrate"]
    links = body.get("links") or {}
    assert links.get("questionnaire") == "/administration/contexte"
    assert links.get("memory") == "/administration/memory"
    # Pas de clés secrètes typiques dans les faits exposés
    for key in body["facts"]:
        assert "api_key" not in key.lower()
        assert "password" not in key.lower()
        assert "token" not in key.lower()


def test_science_overview_includes_seeded_facts_and_person(client):
    from services.knowledge import upsert_entity
    from services.memory_inbox import merge_enterprise_facts

    merge_enterprise_facts(
        {
            "brand": "Élude In Art",
            "tagline": "Création & accompagnement",
            "location": "Tourves",
            "offers": ["Ateliers", "Mandala"],
        }
    )
    upsert_entity(
        "Éric",
        "person",
        {"role": "dirigeant"},
        {},
    )
    upsert_entity(
        "Fleur",
        "project",
        {"statut": "actif"},
        {},
    )

    res = client.get("/business/science-overview")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["facts"].get("brand") == "Élude In Art"
    assert body["facts"].get("location") == "Tourves"
    names_person = [p.get("name") for p in body["persons"]]
    assert "Éric" in names_person
    names_fiches = [e.get("name") for e in body["entities"]]
    assert "Fleur" in names_fiches
    assert "Éric" not in names_fiches


def test_science_overview_global_md_is_full_not_teaser(client):
    from database import merge_enterprise_contexts

    full = "## Identité\n\n" + ("Ligne de contexte confirmé. " * 80) + "\n\nFin du contexte."
    assert len(full) > 800
    merge_enterprise_contexts({"global": full})

    res = client.get("/business/science-overview")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["global_md"] == full.strip()
    assert body["global_preview"]["chars"] == len(full.strip())
    assert body["global_preview"]["has_more"] is True
    assert len(body["global_preview"]["text"]) < len(body["global_md"])
    assert "Fin du contexte." in body["global_md"]
    assert "Fin du contexte." not in body["global_preview"]["text"]
