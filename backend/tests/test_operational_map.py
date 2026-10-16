"""Contrats de la carte opérationnelle."""
from __future__ import annotations

from database import job_set_awaiting_hitl, save_job, update_job
from services.business_db import create_project, update_project


def test_overview_map_shape(client):
    r = client.get("/overview/map")
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body.get("nodes"), list)
    assert isinstance(body.get("edges"), list)
    assert "stats" in body
    kinds = {n.get("kind") for n in body["nodes"]}
    assert "team" in kinds


def test_overview_map_links_project_to_mission(client):
    save_job("mapjob01", "coordinateur", "Préparer le stage d'été", source="mission")
    update_job(
        "mapjob01",
        "running",
        team_trace=[{"key": "commercial", "label": "Commercial", "status": "working"}],
    )
    prj = create_project(title="Stage d'été Sivana", project_type="stage", status="active")
    assert prj and prj.get("id")
    update_project(prj["id"], linked_job_ids=["mapjob01"])

    r = client.get("/overview/map")
    assert r.status_code == 200, r.text
    body = r.json()
    node_ids = {n["id"] for n in body["nodes"]}
    assert "mission:mapjob01" in node_ids
    assert f"project:{prj['id']}" in node_ids
    linked = [
        e
        for e in body["edges"]
        if e.get("kind") == "linked"
        and e.get("source") == f"project:{prj['id']}"
        and e.get("target") == "mission:mapjob01"
    ]
    assert linked, body["edges"]
    mission = next(n for n in body["nodes"] if n["id"] == "mission:mapjob01")
    assert mission["urgency"] == "active"
    assert "Commercial" in (mission.get("who") or [])
    assert mission.get("detail")
    assert mission.get("cta", {}).get("href")


def test_overview_map_brain_marks_guesses_and_gaps(client):
    from services.knowledge import upsert_entity

    upsert_entity(
        name="Fleur Test Cerveau",
        entity_type="project",
        attributes={"type": "Cible du lien confirmé"},
        relations={},
    )
    upsert_entity(
        name="Atelier Test Cerveau",
        entity_type="project",
        attributes={"type": "Atelier pour vérifier le ciel"},
        relations={"supports": ["Fleur Test Cerveau"]},
    )
    upsert_entity(
        name="Orphelin Cerveau",
        entity_type="other",
        attributes={"type": "Fiche sans relation"},
        relations={},
    )
    prj = create_project(title="Atelier Test Cerveau — été", project_type="stage", status="active")
    assert prj and prj.get("id")

    body = client.get("/overview/map").json()
    fiche = next(n for n in body["nodes"] if n["label"] == "Atelier Test Cerveau")
    assert fiche["kind"] == "knowledge"
    assert fiche["detail"] == "Atelier pour vérifier le ciel"
    assert fiche.get("updated_at")
    assert fiche.get("cta", {}).get("href") == "/administration/contexte"

    confirmed = [
        e
        for e in body["edges"]
        if not e.get("inferred") and (e["source"] == fiche["id"] or e["target"] == fiche["id"])
    ]
    assert confirmed, body["edges"]
    guessed = [
        e
        for e in body["edges"]
        if e.get("inferred") is True
        and e.get("kind") == "related"
        and {e["source"], e["target"]} == {fiche["id"], f"project:{prj['id']}"}
    ]
    assert guessed, body["edges"]
    assert any(g["reason"] == "isolated" and g["label"] == "Orphelin Cerveau" for g in body["gaps"])
    assert any(g["reason"] == "inferred" and "Atelier Test Cerveau" in g["label"] for g in body["gaps"])


def test_overview_map_hitl_plan_meta(client):
    save_job("maphitl01", "coordinateur", "Valider le plan de rentrée", source="mission")
    update_job("maphitl01", "running")
    assert job_set_awaiting_hitl("maphitl01", {"kind": "cio_plan", "plan_public": {"title": "Rentrée"}})

    r = client.get("/overview/map")
    assert r.status_code == 200, r.text
    mission = next(n for n in r.json()["nodes"] if n["id"] == "mission:maphitl01")
    assert mission["status"] == "awaiting_validation"
    assert mission["urgency"] == "waiting"
    assert mission.get("meta", {}).get("hitl") is True
    assert mission.get("meta", {}).get("hitl_kind") == "cio_plan"
    assert mission.get("cta", {}).get("label") == "Valider le plan"

