"""Seuil qualité de clôture : heuristique, blocage, override."""
from __future__ import annotations


def test_heuristic_score_grows_with_length():
    from services.quality_gate import heuristic_completion_score

    assert heuristic_completion_score("") < heuristic_completion_score("x" * 80)
    assert heuristic_completion_score("x" * 80) < heuristic_completion_score("x" * 500)


def test_block_only_when_threshold_positive(monkeypatch):
    from services import quality_gate as qg

    monkeypatch.setattr(qg, "_min_score_to_complete", lambda: 0)
    assert qg.should_block_completion("job", 1.0) is False
    monkeypatch.setattr(qg, "_min_score_to_complete", lambda: 7)
    assert qg.should_block_completion("job", 6.5) is True
    assert qg.should_block_completion("job", 8.5) is False


def test_assess_records_rejection_when_threshold_high(monkeypatch):
    from services import quality_gate as qg

    stored: list[dict] = []

    def _insert(job_id, *, phase, score, rejected, payload=None):
        stored.append({"job_id": job_id, "score": score, "rejected": rejected, "phase": phase})
        return {"id": 1}

    monkeypatch.setattr(qg, "_min_score_to_complete", lambda: 9)
    monkeypatch.setattr("database.insert_quality_verdict", _insert)
    verdict = qg.assess_and_record("job-q", result="trop court", phase="completion")
    assert verdict["rejected"] is True
    assert stored and stored[0]["rejected"] is True


def test_quality_override_unblocks(client):
    from database import save_job, set_job_status_quick
    from tenant_context import clear_tenant_context, set_tenant_context

    reg = client.post(
        "/auth/register",
        json={
            "email": "quality-override@example.com",
            "password": "secretpass123",
            "workspace_name": "Qualité",
        },
    )
    assert reg.status_code == 200, reg.text
    token = reg.json()["token"]
    wid = reg.json()["workspace"]["id"]
    job_id = "jobqualoverride1"
    set_tenant_context(workspace_id=wid)
    try:
        save_job(job_id, "coordinateur", "Note courte.", source="test")
        set_job_status_quick(job_id, "quality_blocked")
    finally:
        clear_tenant_context()
    override = client.post(
        f"/jobs/{job_id}/quality-override",
        headers={"Authorization": f"Bearer {token}"},
        json={"reason": "acceptable"},
    )
    assert override.status_code == 200, override.text
    assert override.json().get("unblocked") is True
    assert override.json().get("status") == "completed"
