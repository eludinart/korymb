"""Propositions d'agenda — classement sans écriture, acceptation explicite."""
from __future__ import annotations

from datetime import datetime, timedelta

from services.business_db import create_calendar_event, create_project, get_calendar_event, list_calendar_events
from services.schedule_proposals import (
    accept_schedule_proposal,
    find_free_slots,
    list_schedule_proposals,
    rank_schedule_candidates,
)
from services.work_tasks import create_work_task, get_work_task, list_work_tasks


def test_rank_prefers_urgent_important_without_due(client):
    project = create_project(title="Direction coaching", status="active")
    create_work_task(title="Sans priorité", project_id=project["id"])
    create_work_task(title="Importante", project_id=project["id"], important=True)
    create_work_task(title="Urgente", project_id=project["id"], urgent=True)
    create_work_task(title="Déjà datée", project_id=project["id"], important=True, due_at="2099-01-15")
    create_work_task(title="Capture brute")  # sans projet → hors candidats clarifiés sauf urgent/important

    proposals = rank_schedule_candidates(limit=10)
    titles = [p["title"] for p in proposals]
    assert "Déjà datée" not in titles
    assert "Capture brute" not in titles
    assert titles[0] in {"Urgente", "Importante"}
    assert all(p.get("suggested_due_at") for p in proposals)
    # Aucune écriture : les tâches sans date le restent
    still_open = [t for t in list_work_tasks(status="open") if t["title"] in {"Importante", "Urgente"}]
    assert all(not t.get("due_at") for t in still_open)


def test_list_schedule_proposals_does_not_write(client):
    project = create_project(title="Projet lecture", status="active")
    task = create_work_task(title="À placer", project_id=project["id"], important=True)
    before = get_work_task(task["id"])
    payload = list_schedule_proposals(limit=5)
    assert payload["count"] >= 1
    assert any(p["task_id"] == task["id"] for p in payload["proposals"])
    after = get_work_task(task["id"])
    assert after["due_at"] == before["due_at"]
    assert not after.get("calendar_event_id")


def test_accept_writes_due_and_calendar(client):
    project = create_project(title="Projet accept", status="active")
    task = create_work_task(title="Placer demain", project_id=project["id"], important=True)
    due = (datetime.utcnow() + timedelta(days=1)).replace(hour=10, minute=0, second=0, microsecond=0)
    due_s = due.strftime("%Y-%m-%dT%H:%M:%S")
    updated = accept_schedule_proposal(task_id=task["id"], due_at=due_s)
    assert updated["due_at"].startswith(due_s[:10])
    assert updated.get("calendar_event_id")
    event = get_calendar_event(updated["calendar_event_id"])
    assert event is not None
    assert event["event_type"] == "tache"


def test_accept_endpoint_requires_body(client):
    project = create_project(title="Projet API", status="active")
    task = create_work_task(title="Via API", project_id=project["id"], urgent=True)
    refused = client.post("/business/schedule-proposals/accept", json={})
    assert refused.status_code == 422
    # list sans side-effect
    listed = client.get("/business/schedule-proposals?limit=5")
    assert listed.status_code == 200
    body = listed.json()
    assert "proposals" in body
    due = (datetime.utcnow() + timedelta(days=2)).strftime("%Y-%m-%dT14:00:00")
    ok = client.post(
        "/business/schedule-proposals/accept",
        json={"task_id": task["id"], "due_at": due},
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["due_at"].startswith(due[:10])


def test_find_free_slots_skips_busy(client):
    day = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    while day.weekday() >= 5:
        day += timedelta(days=1)
    create_calendar_event(
        title="Occupé",
        starts_at=day.replace(hour=9, minute=0).strftime("%Y-%m-%dT%H:%M:%S"),
        ends_at=day.replace(hour=9, minute=30).strftime("%Y-%m-%dT%H:%M:%S"),
        event_type="seance",
        status="planned",
    )
    events = list_calendar_events(
        from_at=day.isoformat(),
        to_at=(day + timedelta(days=3)).isoformat(),
        limit=50,
    )
    slots = find_free_slots(events, from_day=day, days=1, limit=5)
    assert slots
    assert not any(s["starts_at"].endswith("T09:00:00") for s in slots)
