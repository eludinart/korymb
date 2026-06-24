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


def test_get_jobs_active_merges_db_and_memory(client):
    from database import save_job, update_job
    from state import active_jobs

    job_id = "actvjob1"
    save_job(job_id, "coordinateur", "Mission bandeau activité", source="mission", mission_config={})
    events = [
        {"type": "mission_start", "agent": "coordinateur", "payload": {}},
        {"type": "tool_call", "agent": "commercial", "payload": {"tool": "web_search"}},
    ]
    update_job(job_id, "running", events=events, team_trace=[{"key": "commercial", "label": "Commercial"}])

    active_jobs[job_id] = {
        "status": "running",
        "mission": "Mission bandeau activité",
        "source": "mission",
        "agent": "coordinateur",
        "events": events,
        "team": [{"key": "commercial", "label": "Commercial", "status": "working"}],
        "created_at": "2026-01-01T00:00:00",
    }

    r = client.get("/jobs/active")
    assert r.status_code == 200
    body = r.json()
    assert body.get("count", 0) >= 1
    row = next((j for j in body.get("jobs", []) if j.get("job_id") == job_id), None)
    assert row is not None
    assert row["status"] == "running"
    assert row.get("last_event_preview") == "Outil · web_search"
    assert isinstance(row.get("events"), list)

    active_jobs.pop(job_id, None)


def test_pause_and_cancel_job_in_memory(client):
    from database import save_job
    from state import active_jobs

    job_id = "ctrljob1"
    save_job(job_id, "coordinateur", "Test pause cancel", source="mission", mission_config={})
    active_jobs[job_id] = {
        "status": "running",
        "agent": "coordinateur",
        "mission": "Test pause cancel",
        "result": None,
        "logs": [],
        "tokens_in": 0,
        "tokens_out": 0,
        "team": [],
        "events": [],
        "source": "mission",
    }

    r_pause = client.post(f"/jobs/{job_id}/pause")
    assert r_pause.status_code == 200
    assert active_jobs[job_id].get("pause_requested") is True
    assert active_jobs[job_id].get("status") == "paused"

    r_resume = client.post(f"/jobs/{job_id}/resume-work")
    assert r_resume.status_code == 200
    assert active_jobs[job_id].get("pause_requested") is False
    assert active_jobs[job_id].get("status") == "running"

    r_cancel = client.post(f"/jobs/{job_id}/cancel")
    assert r_cancel.status_code == 200
    assert active_jobs[job_id].get("cancel_requested") is True

    active_jobs.pop(job_id, None)
