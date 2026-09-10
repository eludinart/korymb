"""Passe de correction — relance un job enfant avec le texte précédent."""
from __future__ import annotations


def test_revise_unknown_job(client):
    r = client.post("/jobs/missingjob99/revise", json={"instruction": "plus court"})
    assert r.status_code == 422
    assert "introuvable" in r.text.lower()


def test_revise_rejects_running_job(client, monkeypatch):
    monkeypatch.setattr(
        "database.get_job",
        lambda job_id: {
            "id": job_id,
            "status": "running",
            "source": "studio:article",
            "result": "brouillon",
            "agent": "community_manager",
            "mission": "Brief",
        },
    )
    r = client.post("/jobs/abc12345revise/revise", json={"instruction": "plus court et plus clair"})
    assert r.status_code == 422
    assert "fin" in r.text.lower() or "attendez" in r.text.lower()


def test_revise_launches_child_job(client, monkeypatch):
    captured: dict = {}

    def fake_schedule(background_tasks, job_id, agent_key, mission_plain, context, source_tag, mission_config=None, parent_job_id=None):
        captured["job_id"] = job_id
        captured["parent"] = parent_job_id
        captured["source"] = source_tag
        captured["mission"] = mission_plain
        captured["agent"] = agent_key

    monkeypatch.setattr("services.mission._schedule_mission_execution", fake_schedule)
    monkeypatch.setattr(
        "database.get_job",
        lambda job_id: {
            "id": job_id,
            "status": "completed",
            "source": "studio:article",
            "result": "#### LIVRABLE — Agapé\n\nUn article trop long.",
            "agent": "community_manager",
            "mission": "Parler d'Agapé",
            "mission_config": {"require_user_validation": True},
        },
    )
    r = client.post(
        "/jobs/parentjob01/revise",
        json={"instruction": "Coupe de moitié, garde le CTA.", "format_id": "article"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "accepted"
    assert body["parent_job_id"] == "parentjob01"
    assert captured.get("parent") == "parentjob01"
    assert captured.get("source") == "studio:article"
    assert "Coupe de moitié" in captured.get("mission", "")
    assert "Un article trop long" in captured.get("mission", "")


def test_playbook_runs_lists_completed(client):
    from database import save_job, update_job

    save_job("pbcopyrun01", "coordinateur", "Relance prospect", source="playbook:relance-prospect")
    update_job("pbcopyrun01", "completed", "#### LIVRABLE — Mail\n\nBonjour, suite à notre échange.")
    r = client.get("/playbooks/runs")
    assert r.status_code == 200, r.text
    runs = r.json().get("runs") or []
    hit = next((x for x in runs if x.get("job_id") == "pbcopyrun01"), None)
    assert hit
    assert hit["pieces"]
    assert "Bonjour" in hit["pieces"][0]["body"]
