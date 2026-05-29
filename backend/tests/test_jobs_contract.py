"""Contrats API : jobs / run."""
from __future__ import annotations

from unittest.mock import patch


def test_post_run_creates_job(client):
    with patch("routers.core_missions._schedule_mission_execution") as mock_sched:
        r = client.post(
            "/run",
            json={"mission": "Test contrat pytest", "agent": "coordinateur"},
        )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "accepted"
    assert body["job_id"]
    assert body["agent"] == "coordinateur"
    mock_sched.assert_called_once()


def test_get_job_detail_shape(client):
    from database import save_job

    job_id = "pytest01"
    save_job(job_id, "coordinateur", "Detail shape pytest", source="mission", mission_config={})

    r = client.get(f"/jobs/{job_id}")
    assert r.status_code == 200
    body = r.json()
    assert body["job_id"] == job_id
    assert "status" in body
    assert "mission" in body
    assert "events" in body or "events_total" in body


def test_get_jobs_list(client):
    r = client.get("/jobs")
    assert r.status_code == 200
    body = r.json()
    assert "jobs" in body
