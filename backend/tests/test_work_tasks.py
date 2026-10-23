"""Tâches hors projet, calendrier, conversion du bac « Tâches d'Eric »."""
from __future__ import annotations

from database import list_director_notifications
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


def test_varchar_note_columns_are_widened_to_text():
    from database import column_type_is_bounded_varchar

    assert column_type_is_bounded_varchar("varchar(400)")
    assert column_type_is_bounded_varchar("VARCHAR(191)")
    assert column_type_is_bounded_varchar("char(32)")
    assert not column_type_is_bounded_varchar("text")
    assert not column_type_is_bounded_varchar("mediumtext")
    assert not column_type_is_bounded_varchar("longtext")


def test_task_notes_keep_at_least_2500_characters(client):
    notes = "détail " * 400
    assert len(notes) >= 2500
    notes = notes[:2500]
    created = client.post("/business/tasks", json={"title": "Note longue", "notes": notes})
    assert created.status_code == 200, created.text
    assert created.json()["notes"] == notes

    updated_notes = ("suite " * 500)[:2500]
    updated = client.put(f"/business/tasks/{created.json()['id']}", json={"notes": updated_notes})
    assert updated.status_code == 200, updated.text
    assert updated.json()["notes"] == updated_notes

    listed = client.get("/business/tasks")
    assert listed.status_code == 200
    row = next(item for item in listed.json()["tasks"] if item["id"] == created.json()["id"])
    assert row["notes"] == updated_notes

    too_long = client.post("/business/tasks", json={"title": "Trop long", "notes": "x" * 2501})
    assert too_long.status_code == 422


def test_unassigned_filter_keeps_capture_tasks_only(client):
    from services.business_db import create_project

    project = create_project(title="Projet filtre capture", status="active")
    orphan = client.post("/business/tasks", json={"title": "Note qui traîne"})
    assert orphan.status_code == 200, orphan.text
    attached = client.post(
        "/business/tasks",
        json={"title": "Travail projet", "project_id": project["id"]},
    )
    assert attached.status_code == 200, attached.text

    listed = client.get("/business/tasks?status=open&unassigned=1")
    assert listed.status_code == 200, listed.text
    ids = {row["id"] for row in listed.json()["tasks"]}
    assert orphan.json()["id"] in ids
    assert attached.json()["id"] not in ids
    assert all(not row.get("project_id") for row in listed.json()["tasks"])

    all_open = client.get("/business/tasks?status=open")
    assert all_open.status_code == 200
    all_ids = {row["id"] for row in all_open.json()["tasks"]}
    assert orphan.json()["id"] in all_ids
    assert attached.json()["id"] in all_ids


def test_triage_filter_keeps_clarified_tasks_only(client):
    from services.business_db import create_project

    project = create_project(title="Projet triage", status="active")
    orphan = client.post("/business/tasks", json={"title": "Capture hors triage"})
    assert orphan.status_code == 200, orphan.text
    attached = client.post(
        "/business/tasks",
        json={"title": "Clarifiée pour triage", "project_id": project["id"]},
    )
    assert attached.status_code == 200, attached.text
    finished = client.post(
        "/business/tasks",
        json={"title": "Faite avec projet", "project_id": project["id"]},
    )
    assert finished.status_code == 200, finished.text
    closed = client.put(f"/business/tasks/{finished.json()['id']}", json={"status": "done"})
    assert closed.status_code == 200, closed.text

    triage = client.get("/business/tasks?triage=1")
    assert triage.status_code == 200, triage.text
    rows = triage.json()["tasks"]
    ids = {row["id"] for row in rows}
    assert attached.json()["id"] in ids
    assert orphan.json()["id"] not in ids
    assert finished.json()["id"] not in ids
    assert all(row.get("project_id") for row in rows)
    assert all(row.get("status") == "open" for row in rows)

    conflict = client.get("/business/tasks?unassigned=1&triage=1")
    assert conflict.status_code == 422


def test_task_important_flag_roundtrip(client):
    from services.business_db import create_project

    project = create_project(title="Projet importance", status="active")
    created = client.post(
        "/business/tasks",
        json={"title": "À classer", "project_id": project["id"], "important": True},
    )
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["important"] is True
    assert body["urgent"] is False

    plain = client.post("/business/tasks", json={"title": "Sans importance"})
    assert plain.status_code == 200, plain.text
    assert plain.json()["important"] is False

    cleared = client.put(f"/business/tasks/{body['id']}", json={"important": False})
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["important"] is False

    flagged = client.put(f"/business/tasks/{body['id']}", json={"important": True, "urgent": True})
    assert flagged.status_code == 200, flagged.text
    assert flagged.json()["important"] is True
    assert flagged.json()["urgent"] is True


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


def _notices(kind: str, needle: str) -> list[dict]:
    return [
        row for row in list_director_notifications(limit=50)
        if row.get("kind") == kind and needle in f"{row.get('title') or ''} {row.get('body') or ''} {row.get('action_url') or ''}"
    ]


def test_assigning_a_task_notifies_once_per_person(client):
    created = client.post("/business/tasks", json={"title": "Relancer le devis", "assignee": "Camille"})
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["assignee"] == "Camille"
    assert len(_notices("task_assigned", "Relancer le devis")) == 1
    assert _notices("task_assigned", "Relancer le devis")[0]["action_url"] == "/gestion/taches"

    same = client.put(f"/business/tasks/{body['id']}", json={"assignee": "Camille"})
    assert same.status_code == 200, same.text
    assert len(_notices("task_assigned", "Relancer le devis")) == 1

    moved = client.put(f"/business/tasks/{body['id']}", json={"assignee": "Noah"})
    assert moved.status_code == 200, moved.text
    assert moved.json()["assignee"] == "Noah"
    assert len(_notices("task_assigned", "Relancer le devis")) == 2


def test_event_update_notifies_and_task_slot_stays_quiet(client):
    created = client.post(
        "/business/events",
        json={
            "title": "Point Camille",
            "starts_at": "2026-11-02T10:00:00",
            "ends_at": "2026-11-02T11:00:00",
            "event_type": "visio",
        },
    )
    assert created.status_code == 200, created.text
    event_id = created.json()["id"]
    updated = client.put(f"/business/events/{event_id}", json={"title": "Point Camille — horaire"})
    assert updated.status_code == 200, updated.text
    notes = _notices("event_updated", event_id)
    assert len(notes) == 1
    assert notes[0]["action_url"] == f"/gestion/planning/{event_id}"

    again = client.put(f"/business/events/{event_id}", json={"title": "Point Camille — horaire"})
    assert again.status_code == 200, again.text
    assert len(_notices("event_updated", event_id)) == 1

    slot = client.post(
        "/business/events",
        json={
            "title": "Créneau tâche",
            "starts_at": "2026-11-03T09:00:00",
            "ends_at": "2026-11-03T09:30:00",
            "event_type": "tache",
        },
    )
    assert slot.status_code == 200, slot.text
    slot_id = slot.json()["id"]
    renamed = client.put(f"/business/events/{slot_id}", json={"title": "Créneau tâche déplacé"})
    assert renamed.status_code == 200, renamed.text
    assert _notices("event_updated", slot_id) == []


def test_task_reply_keeps_status_and_notes(client):
    created = client.post(
        "/business/tasks",
        json={"title": "À qui as-tu proposé la session ?", "notes": "En attente réponse"},
    )
    assert created.status_code == 200, created.text
    task_id = created.json()["id"]
    assert created.json()["status"] == "open"
    assert created.json()["notes"] == "En attente réponse"

    saved = client.put(
        f"/business/tasks/{task_id}",
        json={"reply": "Je l'ai proposée à Camille mercredi.", "chat_conversation_id": "rcv-abc123"},
    )
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert body["reply"] == "Je l'ai proposée à Camille mercredi."
    assert body["reply_at"]
    assert body["chat_conversation_id"] == "rcv-abc123"
    assert body["status"] == "open"
    assert body["notes"] == "En attente réponse"

    cleared = client.put(f"/business/tasks/{task_id}", json={"reply": ""})
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["reply"] == ""
    assert cleared.json()["reply_at"] == ""
    assert cleared.json()["status"] == "open"
    assert cleared.json()["notes"] == "En attente réponse"

    too_long = client.put(f"/business/tasks/{task_id}", json={"reply": "x" * 4001})
    assert too_long.status_code == 422
