"""Jalons de projet dans le briefing Aujourd'hui."""
from __future__ import annotations

from services.business_db import create_project, delete_project, get_project
from services.director_platform import build_ops_board, parse_project_step_label


def test_parse_project_step_label_reads_priority_and_status():
    parsed = parse_project_step_label("P1 · À faire — Appeler Camille")
    assert parsed == {"priority": 1, "status": "À faire", "title": "Appeler Camille"}

    ranked = parse_project_step_label("  p12 · En cours — Relire le devis — v2")
    assert ranked["priority"] == 12
    assert ranked["status"] == "En cours"
    assert ranked["title"] == "Relire le devis — v2"

    hyphen = parse_project_step_label("P3 - Bloqué — Attendre le retour")
    assert hyphen["priority"] == 3
    assert hyphen["status"] == "Bloqué"
    assert hyphen["title"] == "Attendre le retour"

    plain = parse_project_step_label("Ranger les notes")
    assert plain["priority"] is None
    assert plain["status"] == ""
    assert plain["title"] == "Ranger les notes"


def test_project_milestones_split_open_and_done_without_touching_the_board():
    board = build_ops_board(
        [{"kind": "closure", "job_id": "job-close", "title": "Studio", "severity": "medium"}],
    )
    assert [row["id"] for row in board["todo"]] == ["job-close"]
    assert "project_step" not in {row.get("kind") for row in board["todo"]}
    assert "todo_steps" not in board["counts"]


def test_briefing_lists_active_milestones_and_checkoff_persists(client):
    active = create_project(
        title="Tâches d'Eric — semaine du 19/10",
        project_type="autre",
        status="active",
        milestones=[
            {"label": "P2 · À faire — Relire le devis", "done": False, "job_id": "jobkeep1"},
            {"label": "P1 · À faire — Appeler Camille", "done": False},
            {"label": "P1 · Fait — Déjà coché", "done": True},
            {"label": "Ranger les notes", "done": False},
        ],
    )
    draft = create_project(
        title="Brouillon Eric",
        project_type="autre",
        status="draft",
        milestones=[{"label": "P1 · À faire — Rester caché", "done": False}],
    )
    paused = create_project(
        title="Pause Eric",
        project_type="autre",
        status="on_hold",
        milestones=[{"label": "P1 · À faire — En pause", "done": False}],
    )
    created = [active["id"], draft["id"], paused["id"]]
    try:
        body = client.get("/admin/briefing?period=today").json()
        block = body["project_milestones"]
        mine_open = [row for row in block["open"] if row.get("project_id") == active["id"]]
        mine_done = [row for row in block["done"] if row.get("project_id") == active["id"]]
        assert [row["title"] for row in mine_open] == ["Appeler Camille", "Relire le devis", "Ranger les notes"]
        assert mine_open[0]["priority"] == 1
        assert mine_open[0]["status"] == "À faire"
        assert mine_open[0]["label"] == "P1 · À faire — Appeler Camille"
        assert mine_open[0]["href"] == f"/gestion/projets/{active['id']}"
        assert mine_open[0]["done"] is False
        assert [row["title"] for row in mine_done] == ["Déjà coché"]
        assert mine_done[0]["done"] is True
        titles = {row.get("title") for row in block["open"] + block["done"]}
        assert "Rester caché" not in titles
        assert "En pause" not in titles
        assert all(row.get("kind") != "project_step" for row in body["board"]["todo"])

        step = mine_open[0]
        done = client.post(
            f"/business/projects/{active['id']}/milestones/{step['index']}/done",
            json={"done": True, "label": step["label"]},
        )
        assert done.status_code == 200, done.text
        stored = get_project(active["id"])
        assert stored is not None
        milestones = stored["milestones"]
        assert milestones[1]["done"] is True
        assert milestones[0]["done"] is False
        assert milestones[0]["job_id"] == "jobkeep1"
        assert milestones[0]["label"] == "P2 · À faire — Relire le devis"

        block_after = client.get("/admin/briefing?period=today").json()["project_milestones"]
        still_open = [
            row
            for row in block_after["open"]
            if row.get("project_id") == active["id"] and row.get("title") == "Appeler Camille"
        ]
        now_done = [
            row
            for row in block_after["done"]
            if row.get("project_id") == active["id"] and row.get("title") == "Appeler Camille"
        ]
        assert still_open == []
        assert len(now_done) == 1

        conflict = client.post(
            f"/business/projects/{active['id']}/milestones/0/done",
            json={"done": True, "label": "un autre libellé"},
        )
        assert conflict.status_code == 409
        assert "Rechargez" in (conflict.json().get("detail") or "")
        assert get_project(active["id"])["milestones"][0]["done"] is False

        missing = client.post(
            f"/business/projects/{active['id']}/milestones/9/done",
            json={"done": True},
        )
        assert missing.status_code == 404
        unknown = client.post(
            "/business/projects/prj-absent/milestones/0/done",
            json={"done": True},
        )
        assert unknown.status_code == 404
    finally:
        for project_id in created:
            delete_project(project_id)


def test_build_project_milestones_returns_empty_lists_when_lookup_fails(monkeypatch):
    import services.director_platform as dp

    def boom(*_a, **_k):
        raise RuntimeError("db down")

    monkeypatch.setattr("services.business_db.list_projects", boom)
    assert dp.build_project_milestones() == {"open": [], "done": []}
