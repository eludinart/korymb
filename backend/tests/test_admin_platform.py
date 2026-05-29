"""Contrats admin inbox / analytics / briefing / notifications."""
from __future__ import annotations

import json

from database import get_job, insert_director_notification, save_job, update_job


def test_admin_inbox(client):
    r = client.get("/admin/inbox")
    assert r.status_code == 200
    body = r.json()
    assert "items" in body
    assert isinstance(body["items"], list)


def test_admin_briefing(client):
    r = client.get("/admin/briefing?period=today")
    assert r.status_code == 200
    body = r.json()
    assert body["period"] == "today"
    assert "decisions_today" in body
    assert "budget" in body


def test_admin_notifications_crud(client):
    row = insert_director_notification(kind="test", title="Test notif", body="hello")
    nid = row["id"]
    r = client.get("/admin/notifications?unread_only=true")
    assert r.status_code == 200
    assert any(i["id"] == nid for i in r.json()["items"])
    r2 = client.patch(f"/admin/notifications/{nid}/read")
    assert r2.status_code == 200
    assert r2.json().get("read_at")


def test_cio_answer_marks_answered(client):
    save_job("cioans01", "coordinateur", "Test CIO answer", source="test")
    update_job(
        "cioans01",
        "running",
        None,
        [],
        0,
        0,
        events=[
            {"type": "cio_question", "ts": "2026-01-01T00:00:00", "data": {"questions": ["Q1?"], "answered": False}},
        ],
    )
    r = client.post("/jobs/cioans01/cio-answer", json={"answer": "Réponse test"})
    assert r.status_code == 200
    row = get_job("cioans01")
    events = row.get("events") or []
    assert any(
        ev.get("type") == "cio_question" and (ev.get("data") or {}).get("answered") is True for ev in events
    )


def test_missions_estimate_cost(client):
    r = client.post(
        "/missions/estimate-cost",
        json={"mission": "Analyser le marché local", "agents": ["commercial"], "mode": "cio"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["estimated_tokens"] > 0
    assert "estimated_cost_usd" in body


def test_playbooks_list(client):
    r = client.get("/playbooks")
    assert r.status_code == 200
    assert "playbooks" in r.json()


def test_jobs_summary(client):
    r = client.get("/jobs/summary?limit=5")
    assert r.status_code == 200
    assert "jobs" in r.json()


def test_admin_mission_analytics(client):
    r = client.get("/admin/mission-analytics?days=7")
    assert r.status_code == 200
    body = r.json()
    assert body["days"] == 7
    assert "missions_total" in body
