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
    assert dp.build_project_milestones() == {"open": [], "done": [], "groups": [], "projects": []}


def _use_workspace(display_name: str):
    import secrets

    from tenant_context import set_tenant_context
    from workspace_db import create_user, create_workspace

    user = create_user(
        f"jalons-{secrets.token_hex(4)}@example.com",
        "not-used",
        display_name,
    )
    workspace = create_workspace(f"Jalons {display_name}", user["id"], starter_pack_id="blank")
    set_tenant_context(workspace_id=workspace["id"])
    return user, workspace


def _stamp(project_id: str, stamp: str) -> None:
    from database import get_conn

    with get_conn() as conn:
        conn.execute("UPDATE biz_projects SET updated_at=? WHERE id=?", (stamp, project_id))
        conn.commit()


def test_project_milestones_group_by_contact_order_and_owner(app, monkeypatch):
    import services.business_db as bdb
    from services.business_db import create_contact, create_project, delete_contact, delete_project
    from services.director_platform import build_project_milestones

    _use_workspace("Eric")
    created_projects: list[str] = []
    created_contacts: list[str] = []

    def track_project(**kwargs):
        project = create_project(**kwargs)
        created_projects.append(project["id"])
        return project

    def track_contact(**kwargs):
        contact = create_contact(**kwargs)
        created_contacts.append(contact["id"])
        return contact

    lina = track_contact(name="Lina", company="Studio Lina", contact_type="client")
    camille = track_contact(name="Camille", company="Atelier Camille", contact_type="client")
    atelier = track_contact(name="", company="Atelier Nord", contact_type="client")
    noa = track_contact(name="Noa", contact_type="client")
    nora = track_contact(name="Nora", contact_type="client")

    lina_project = track_project(
        title="Site Lina",
        contact_id=lina["id"],
        status="active",
        milestones=[
            {"label": "P2 · À faire — Relire la maquette", "done": False},
            {"label": "P1 · À faire — Appeler Lina", "done": False},
        ],
    )
    owner_notes = track_project(
        title="Notes perso",
        status="active",
        linked_job_ids=["job-perso"],
        milestones=[
            {"label": "Ranger le bureau", "done": False},
            {"label": "Classer les scans", "done": False},
        ],
    )
    owner_orphan = track_project(
        title="Sans fiche",
        contact_id="ctc-absent",
        status="active",
        milestones=[{"label": "Retrouver le contact", "done": False}],
    )
    atelier_project = track_project(
        title="Devanture",
        contact_id=atelier["id"],
        status="active",
        milestones=[
            {"label": "P3 · À faire — Photo vitrine", "done": False},
            {"label": "P3 · À faire — Enseigne", "done": False},
        ],
    )
    noa_project = track_project(
        title="Logo Noa",
        contact_id=noa["id"],
        status="active",
        milestones=[
            {"label": "P4 · À faire — Croquis", "done": False},
            {"label": "P4 · À faire — Typo", "done": False},
        ],
    )
    camille_project = track_project(
        title="Devis Camille",
        contact_id=camille["id"],
        status="active",
        linked_job_ids=["job-a", "job-a", " ", "job-b"],
        milestones=[
            {"label": "P2 · À faire — Envoyer le devis", "done": False},
            {"label": "P1 · Fait — Brief reçu", "done": True},
        ],
    )
    nora_project = track_project(
        title="Archives Nora",
        contact_id=nora["id"],
        status="active",
        milestones=[{"label": "P1 · Fait — Clôturer", "done": True}],
    )
    _stamp(lina_project["id"], "2026-10-03T00:00:00")
    _stamp(owner_notes["id"], "2026-10-02T00:00:00")
    _stamp(owner_orphan["id"], "2026-10-02T00:00:01")
    _stamp(atelier_project["id"], "2026-10-05T00:00:00")
    _stamp(noa_project["id"], "2026-10-04T00:00:00")
    _stamp(camille_project["id"], "2026-10-01T00:00:00")
    _stamp(nora_project["id"], "2026-10-19T00:00:00")

    calls = {"contacts": 0}
    real_batch = bdb.get_contacts_by_ids

    def wrapped(ids):
        calls["contacts"] += 1
        return real_batch(ids)

    monkeypatch.setattr(bdb, "get_contacts_by_ids", wrapped)

    def reject_single(*_args, **_kwargs):
        raise AssertionError("lecture contact une par une")

    def reject_write(*_args, **_kwargs):
        raise AssertionError("écriture pendant la lecture des jalons")

    monkeypatch.setattr(bdb, "get_contact", reject_single)
    monkeypatch.setattr(bdb, "update_project", reject_write)
    try:
        block = build_project_milestones()
        assert calls["contacts"] == 1
        labels = [group["label"] for group in block["groups"]]
        assert labels == ["Lina", "Eric", "Atelier Nord", "Noa", "Camille", "Nora"]
        by_label = {group["label"]: group for group in block["groups"]}

        lina_group = by_label["Lina"]
        assert lina_group["kind"] == "contact"
        assert lina_group["contact_id"] == lina["id"]
        assert lina_group["href"] == f"/gestion/contacts/{lina['id']}"
        assert lina_group["has_open_p1"] is True
        assert [row["title"] for row in lina_group["open"]] == ["Appeler Lina", "Relire la maquette"]
        assert lina_group["open"][0]["contact_id"] == lina["id"]
        assert lina_group["open"][0]["contact_name"] == "Lina"

        owner = by_label["Eric"]
        assert owner["id"] == "owner"
        assert owner["kind"] == "owner"
        assert owner["contact_id"] is None
        assert owner["href"] == "/gestion/projets"
        assert owner["open_count"] == 3
        assert owner["has_open_p1"] is False
        assert {item["project_id"] for item in owner["projects"]} == {owner_notes["id"], owner_orphan["id"]}
        notes = next(item for item in owner["projects"] if item["project_id"] == owner_notes["id"])
        assert notes["linked_mission_count"] == 1
        assert notes["contact_id"] is None
        orphan_row = next(row for row in owner["open"] if row["project_id"] == owner_orphan["id"])
        assert orphan_row["contact_id"] == "ctc-absent"
        assert orphan_row["contact_name"] == "Eric"

        assert by_label["Atelier Nord"]["updated_at"] > by_label["Noa"]["updated_at"]
        assert by_label["Atelier Nord"]["open_count"] == by_label["Noa"]["open_count"] == 2
        assert by_label["Camille"]["has_open_p1"] is False
        camille_ref = by_label["Camille"]["projects"][0]
        assert camille_ref["linked_mission_count"] == 2
        assert by_label["Camille"]["open"][0]["linked_mission_count"] == 2
        assert by_label["Camille"]["done"][0]["title"] == "Brief reçu"
        assert by_label["Nora"]["open_count"] == 0
        assert by_label["Nora"]["has_open_p1"] is False
        assert by_label["Nora"]["done"][0]["priority"] == 1

        flat_lina = [row["title"] for row in block["open"] if row["project_id"] == lina_project["id"]]
        assert flat_lina == ["Appeler Lina", "Relire la maquette"]
    finally:
        for project_id in created_projects:
            delete_project(project_id)
        for contact_id in created_contacts:
            delete_contact(contact_id)


def test_project_milestones_owner_fallback_is_moi(app):
    from database import get_conn
    from services.business_db import create_project, delete_project
    from services.director_platform import build_project_milestones

    user, workspace = _use_workspace("Temporaire")
    project = create_project(
        title="Sans client",
        status="active",
        milestones=[{"label": "P2 · À faire — Noter", "done": False}],
    )
    try:
        with get_conn() as conn:
            conn.execute("UPDATE korymb_users SET display_name=? WHERE id=?", ("", user["id"]))
            conn.commit()
        unnamed = build_project_milestones()
        assert [group["label"] for group in unnamed["groups"]] == ["Moi"]
        assert unnamed["groups"][0]["href"] == f"/gestion/projets/{project['id']}"

        with get_conn() as conn:
            conn.execute(
                "UPDATE korymb_workspaces SET owner_user_id=NULL WHERE id=?",
                (workspace["id"],),
            )
            conn.commit()
        missing = build_project_milestones()
        assert missing["groups"][0]["label"] == "Moi"
        assert missing["groups"][0]["kind"] == "owner"
    finally:
        delete_project(project["id"])


def test_active_project_without_steps_is_listed(app):
    from services.business_db import create_project, delete_project
    from services.director_platform import build_project_milestones

    _use_workspace("Vide")
    empty = create_project(title="Sans étape", status="active", milestones=[])
    stepped = create_project(
        title="Avec étape",
        status="active",
        milestones=[{"label": "P1 · À faire — Dire bonjour", "done": False, "job_id": "job-hi"}],
    )
    try:
        block = build_project_milestones()
        assert set(block) >= {"open", "done", "groups", "projects"}
        blank = next(item for item in block["projects"] if item["project_id"] == empty["id"])
        assert blank["project_title"] == "Sans étape"
        assert blank["open"] == []
        assert blank["done"] == []
        assert all(
            empty["id"] not in {ref.get("project_id") for ref in (group.get("projects") or [])}
            for group in block["groups"]
        )
        filled = next(item for item in block["projects"] if item["project_id"] == stepped["id"])
        assert filled["open"][0]["title"] == "Dire bonjour"
        assert filled["open"][0]["job_id"] == "job-hi"
        assert block["open"][0]["job_id"] == "job-hi"
    finally:
        delete_project(empty["id"])
        delete_project(stepped["id"])


def test_milestone_reply_keeps_done_and_survives_project_save(client):
    from services.business_db import update_project

    project = create_project(
        title="Éclaircie",
        status="active",
        milestones=[{"label": "P2 · En attente réponse — Quelle date ?", "done": False}],
    )
    try:
        saved = client.post(
            f"/business/projects/{project['id']}/milestones/0/reply",
            json={"reply": "Mercredi après-midi.", "label": "P2 · En attente réponse — Quelle date ?"},
        )
        assert saved.status_code == 200, saved.text
        step = saved.json()["milestones"][0]
        assert step["reply"] == "Mercredi après-midi."
        assert step["reply_at"]
        assert step["done"] is False

        conflict = client.post(
            f"/business/projects/{project['id']}/milestones/0/reply",
            json={"reply": "Autre", "label": "un autre libellé"},
        )
        assert conflict.status_code == 409
        assert get_project(project["id"])["milestones"][0]["reply"] == "Mercredi après-midi."

        bound = client.post(
            f"/business/projects/{project['id']}/milestones/0/reply",
            json={
                "reply": "Mercredi après-midi.",
                "label": "P2 · En attente réponse — Quelle date ?",
                "conversation_id": "rcv-jalon1",
            },
        )
        assert bound.status_code == 200, bound.text
        assert bound.json()["milestones"][0]["chat_conversation_id"] == "rcv-jalon1"

        kept = update_project(
            project["id"],
            milestones=[{
                "label": "P2 · En attente réponse — Quelle date ?",
                "done": False,
                "reply": "Mercredi après-midi.",
                "reply_at": step["reply_at"],
                "chat_conversation_id": "rcv-jalon1",
            }],
        )
        assert kept["milestones"][0]["reply"] == "Mercredi après-midi."
        assert kept["milestones"][0]["chat_conversation_id"] == "rcv-jalon1"
        assert kept["milestones"][0]["done"] is False

        block = client.get("/admin/briefing?period=today").json()["project_milestones"]
        row = next(
            item for item in block["open"]
            if item.get("project_id") == project["id"]
        )
        assert row["reply"] == "Mercredi après-midi."
        assert row["chat_conversation_id"] == "rcv-jalon1"
    finally:
        delete_project(project["id"])


def test_milestone_notes_keeps_reply_and_appears_in_briefing(client):
    project = create_project(
        title="Notes d'étape",
        status="active",
        milestones=[{
            "label": "P1 · À faire — Vérifier le câblage",
            "done": False,
            "reply": "OK pour jeudi",
            "reply_at": "2026-04-01T10:00:00Z",
        }],
    )
    try:
        saved = client.post(
            f"/business/projects/{project['id']}/milestones/0/notes",
            json={
                "notes": "Besoin d'un multimètre + schéma OpenPlotter.",
                "label": "P1 · À faire — Vérifier le câblage",
            },
        )
        assert saved.status_code == 200, saved.text
        step = saved.json()["milestones"][0]
        assert step["notes"] == "Besoin d'un multimètre + schéma OpenPlotter."
        assert step["reply"] == "OK pour jeudi"
        assert step["done"] is False

        conflict = client.post(
            f"/business/projects/{project['id']}/milestones/0/notes",
            json={"notes": "Autre", "label": "libellé décalé"},
        )
        assert conflict.status_code == 409
        assert get_project(project["id"])["milestones"][0]["notes"] == (
            "Besoin d'un multimètre + schéma OpenPlotter."
        )

        block = client.get("/admin/briefing?period=today").json()["project_milestones"]
        row = next(item for item in block["open"] if item.get("project_id") == project["id"])
        assert row["notes"] == "Besoin d'un multimètre + schéma OpenPlotter."
        assert row["reply"] == "OK pour jeudi"
    finally:
        delete_project(project["id"])
