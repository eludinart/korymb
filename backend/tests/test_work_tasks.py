"""Tâches hors projet, calendrier, conversion du bac « Tâches d'Eric »."""
from __future__ import annotations

from services.business_db import create_project, get_calendar_event, get_project
from services.work_tasks import import_eric_task_buckets, list_work_tasks, parse_task_blob

_ERIC = """Liste de tâches d'Eric pour la semaine du 19/10/2026.

[x] P1 · Fait — Frontend déjà propre, fusionnée le 19/10
[ ] P2 · En attente réponse — Coach : échéance mer. 21/10
[ ] P6 · À faire cette semaine — Réorganiser le site
"""


def test_parse_checkbox_blob_keeps_open_date_only():
    items = parse_task_blob(_ERIC)
    assert len(items) == 3
    assert items[0]["done"] is True
    assert items[0]["due_at"] is None
    assert items[0]["priority"] == "P1"
    assert items[1]["done"] is False
    assert items[1]["due_at"] == "2026-10-21"
    assert items[2]["due_at"] is None


def test_eric_project_becomes_loose_tasks_and_keeps_unparsed(client):
    plain = create_project(
        title="Tâches d'Eric — notes",
        description="Rien à cocher pour l'instant.",
        status="active",
    )
    project = create_project(
        title="Tâches d'Eric — semaine du 19/10",
        description=_ERIC,
        status="active",
        project_type="autre",
    )
    summary = import_eric_task_buckets()
    assert summary["projects"] == 1
    assert summary["skipped"] == 1
    assert summary["tasks"] == 3
    assert get_project(plain["id"]) is not None
    assert get_project(project["id"]) is None

    mine = [
        t for t in list_work_tasks()
        if t["title"].startswith("Frontend") or t["title"].startswith("Coach") or t["title"].startswith("Réorganiser")
    ]
    assert len(mine) == 3
    assert all(not t.get("project_id") for t in mine)
    dated = next(t for t in mine if t["due_at"] == "2026-10-21")
    event = get_calendar_event(dated["calendar_event_id"])
    assert event is not None
    assert event["event_type"] == "tache"
    assert event["visibility"] == "internal"
    assert str(event["starts_at"]).startswith("2026-10-21T09:00:00")
    done = next(t for t in mine if t["status"] == "done")
    assert not done.get("calendar_event_id")

    again = import_eric_task_buckets()
    assert again["projects"] == 0
    assert again["skipped"] == 1
    still = [
        t for t in list_work_tasks()
        if t["title"].startswith("Frontend") or t["title"].startswith("Coach") or t["title"].startswith("Réorganiser")
    ]
    assert len(still) == 3


def test_task_api_calendar_follows_the_date(client):
    created = client.post(
        "/business/tasks",
        json={"title": "Appeler le coach", "due_at": "2026-10-22"},
    )
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["project_id"] is None
    event = get_calendar_event(body["calendar_event_id"])
    assert event and event["status"] == "planned"

    listed = client.get("/business/tasks?status=open")
    assert listed.status_code == 200
    assert any(row["id"] == body["id"] for row in listed.json()["tasks"])

    cleared = client.put(f"/business/tasks/{body['id']}", json={"due_at": ""})
    assert cleared.status_code == 200, cleared.text
    cancelled = get_calendar_event(cleared.json()["calendar_event_id"])
    assert cancelled and cancelled["status"] == "cancelled"

    redated = client.put(
        f"/business/tasks/{body['id']}",
        json={"due_at": "2026-10-23", "status": "open"},
    )
    assert redated.status_code == 200, redated.text
    revived = get_calendar_event(redated.json()["calendar_event_id"])
    assert revived and revived["status"] == "planned"
    assert str(revived["starts_at"]).startswith("2026-10-23")

    closed = client.put(f"/business/tasks/{body['id']}", json={"status": "done"})
    assert closed.status_code == 200, closed.text
    finished = get_calendar_event(closed.json()["calendar_event_id"])
    assert finished and finished["status"] == "cancelled"
    opened = client.get("/business/tasks?status=open")
    assert all(row["id"] != body["id"] for row in opened.json()["tasks"])

    invalid = client.post("/business/tasks", json={"title": "Mauvaise date", "due_at": "22/10/2026"})
    assert invalid.status_code == 422


def test_task_urgent_stays_first_and_keeps_created_at(client):
    plain = client.post("/business/tasks", json={"title": "Tâche calme"})
    assert plain.status_code == 200, plain.text
    calm = plain.json()
    assert calm["urgent"] is False
    assert calm["created_at"]

    flagged = client.put(f"/business/tasks/{calm['id']}", json={"urgent": True})
    assert flagged.status_code == 200, flagged.text
    assert flagged.json()["urgent"] is True
    assert flagged.json()["created_at"] == calm["created_at"]

    later = client.post("/business/tasks", json={"title": "Tâche plus récente"})
    assert later.status_code == 200, later.text
    listed = client.get("/business/tasks?status=open")
    assert listed.status_code == 200
    ours = [
        row for row in listed.json()["tasks"]
        if row["id"] in {calm["id"], later.json()["id"]}
    ]
    assert [row["id"] for row in ours] == [calm["id"], later.json()["id"]]

    cleared = client.put(f"/business/tasks/{calm['id']}", json={"urgent": False})
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["urgent"] is False
