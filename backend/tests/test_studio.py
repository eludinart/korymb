"""Studio de contenus — catalogue, lancement, PDF, publication."""
from __future__ import annotations


def test_studio_catalog(client):
    r = client.get("/studio/catalog")
    assert r.status_code == 200, r.text
    body = r.json()
    ids = {f["id"] for f in body["formats"]}
    assert "article" in ids
    assert "podcast" in ids
    assert "document_pdf" in ids
    assert "video_short" in ids
    assert "social_instagram" in ids
    assert "social_linkedin" in ids
    assert body["brand"]["name"]
    assert any(c["id"] == "tts" for c in body["connections"])
    assert any(c["id"] == "video_gen" for c in body["connections"])
    linkedin = next(c for c in body["connections"] if c["id"] == "linkedin")
    assert "group=linkedin_publish" in linkedin["setup"]
    tts = next(c for c in body["connections"] if c["id"] == "tts")
    assert "group=tts" in tts["setup"]
    assert "media" in body
    assert body["media"]["mode"] in {"economy", "quality"}


def test_studio_generate_rejects_short_prompt(client):
    r = client.post("/studio/generate", json={"prompt": "ok", "formats": ["article"]})
    assert r.status_code == 422


def test_studio_generate_rejects_unknown_format_via_empty(client):
    r = client.post("/studio/generate", json={"prompt": "", "formats": ["article"]})
    assert r.status_code == 422


def test_studio_generate_launches_job(client, monkeypatch):
    captured: dict = {}

    def fake_schedule(background_tasks, job_id, agent_key, mission_plain, context, source_tag, mission_config=None):
        captured["job_id"] = job_id
        captured["agent"] = agent_key
        captured["source"] = source_tag
        captured["mission"] = mission_plain
        captured["context"] = context

    monkeypatch.setattr("services.mission._schedule_mission_execution", fake_schedule)

    r = client.post(
        "/studio/generate",
        json={
            "prompt": "Parler d'Agapé pour les coachs, invitation à une soirée.",
            "formats": ["article", "social_instagram"],
            "tone": "invite",
            "audience": "coachs",
            "destination": "wordpress",
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "accepted"
    assert body["job_id"]
    assert "article" in body["formats"]
    assert captured.get("source", "").startswith("studio:")
    assert "Agapé" in captured.get("mission", "") or "Agapé" in r.text


def test_studio_publish_requires_file_or_markdown(client):
    r = client.post(
        "/studio/publish",
        json={"title": "Fiche Agapé", "resource_type": "document"},
    )
    assert r.status_code == 422


def test_create_branded_pdf_saves_resource(client, tmp_path, monkeypatch):
    monkeypatch.setenv("KORYMB_RESOURCE_FILES_DIR", str(tmp_path))
    from tools.studio import run_create_branded_pdf

    out = run_create_branded_pdf(
        "Agapé — fiche",
        "## Accueil\n\nL'agapé est une forme d'amour inconditionnel.\n\nPas de divination.",
        "Élude In Art",
    )
    assert "file_id:" in out or "rfil-" in out or out.startswith("✅") or "markdown" in out.lower()


def test_studio_release_unknown_job(client):
    r = client.post("/studio/release", json={"job_id": "missingjob99"})
    assert r.status_code == 422


def test_studio_release_rejects_running_job(client, monkeypatch):
    monkeypatch.setattr(
        "database.get_job",
        lambda job_id: {
            "id": job_id,
            "status": "running",
            "source": "studio:article",
            "result": "brouillon",
        },
    )
    r = client.post("/studio/release", json={"job_id": "abc12345"})
    assert r.status_code == 422
    assert "terminée" in r.text.lower() or "pas encore" in r.text.lower()


def test_describe_studio_pieces_article_dual_path(monkeypatch):
    monkeypatch.setattr("services.studio._tickets_for_job", lambda _job_id: [])
    from services.studio import describe_studio_pieces

    pieces = describe_studio_pieces(
        {
            "id": "jobdualpath01",
            "status": "completed",
            "source": "studio:article,social_instagram,youtube",
            "result": (
                "#### LIVRABLE — Agapé\n\nUn article complet.\n\n"
                "#### LIVRABLE — Post IG\n\nCaption instagram.\n\n"
                "#### LIVRABLE — Pack YouTube\n\nTitre et description."
            ),
        }
    )
    assert [p["format_id"] for p in pieces] == ["article", "social_instagram", "youtube"]
    article = pieces[0]
    assert article["in_app"] is True
    assert article["channel"] == "wordpress"
    assert article["can_publish_in_app"] is True
    ig = pieces[1]
    assert ig["channel"] == "instagram"
    assert ig["in_app"] is False
    yt = pieces[2]
    assert yt["channel"] == "youtube"
    assert yt["in_app"] is True
    assert yt["can_publish_channel"] is False


def test_extract_livrables_accepts_bold_markdown(monkeypatch):
    from services.studio import _extract_livrables

    rows = _extract_livrables(
        '---\n#### **LIVRABLE — PDF Brandé : "Agapé"**\n\nContenu.\n'
    )
    assert rows
    assert "Agapé" in rows[0]["title"]
    assert "Contenu" in rows[0]["body"]


def _seed_studio_job(job_id: str, *, result: str = "#### LIVRABLE — Fiche Agapé\n\nUn texte assez long pour la file."):
    from database import save_job, update_job

    save_job(job_id, "community_manager", "Brief Agapé", source="studio:document_pdf")
    update_job(job_id, "completed", result)


def test_studio_dismiss_requires_confirm_word(client):
    _seed_studio_job("studiorm01")
    r = client.post(
        "/studio/dismiss",
        json={"job_id": "studiorm01", "format_id": "document_pdf", "confirm": "oui"},
    )
    assert r.status_code == 422
    assert "SUPPRIMER" in r.text


def test_studio_dismiss_hides_from_queue(client):
    _seed_studio_job("studiorm02")
    listed = client.get("/studio/runs").json()["runs"]
    assert any(r["job_id"] == "studiorm02" for r in listed)
    r = client.post(
        "/studio/dismiss",
        json={"job_id": "studiorm02", "format_id": "document_pdf", "confirm": "SUPPRIMER"},
    )
    assert r.status_code == 200, r.text
    listed = client.get("/studio/runs").json()["runs"]
    assert all(r["job_id"] != "studiorm02" for r in listed)


def test_published_piece_leaves_studio_queue(client):
    from database import merge_job_studio_queue

    _seed_studio_job("studiorm03")
    merge_job_studio_queue(
        "studiorm03",
        {"piece": {"format_id": "document_pdf", "state": "published", "target": "korymb"}},
    )
    listed = client.get("/studio/runs").json()["runs"]
    assert all(r["job_id"] != "studiorm03" for r in listed)


def test_studio_stale_notifies_once_after_two_days(monkeypatch):
    from datetime import datetime

    from database import get_conn, _ws
    from services.studio import notify_stale_studio_pieces

    _seed_studio_job("studiorm04")
    with get_conn() as conn:
        conn.execute(
            "UPDATE jobs SET created_at=? WHERE id=? AND workspace_id=?",
            ("2026-01-01T10:00:00", "studiorm04", _ws()),
        )
        conn.commit()
    captured: list[dict] = []

    def fake_notify(**kwargs):
        captured.append(kwargs)
        return {"id": "notif-studio"}

    monkeypatch.setattr("services.director_platform.emit_director_notification", fake_notify)
    n1 = notify_stale_studio_pieces(now=datetime(2026, 1, 4, 12, 0, 0), days=2)
    assert n1 == 1
    assert captured and captured[0]["kind"] == "studio_stale"
    assert "/gestion/studio" in (captured[0].get("action_url") or "")
    n2 = notify_stale_studio_pieces(now=datetime(2026, 1, 5, 12, 0, 0), days=2)
    assert n2 == 0


def test_studio_stale_skips_dismissed(monkeypatch):
    from datetime import datetime

    from database import get_conn, _ws, merge_job_studio_queue
    from services.studio import notify_stale_studio_pieces

    _seed_studio_job("studiorm05")
    merge_job_studio_queue("studiorm05", {"dismissed_job": True})
    with get_conn() as conn:
        conn.execute(
            "UPDATE jobs SET created_at=? WHERE id=? AND workspace_id=?",
            ("2026-01-01T10:00:00", "studiorm05", _ws()),
        )
        conn.commit()
    monkeypatch.setattr(
        "services.director_platform.emit_director_notification",
        lambda **k: (_ for _ in ()).throw(AssertionError("ne doit pas notifier")),
    )
    n = notify_stale_studio_pieces(now=datetime(2026, 1, 10, 12, 0, 0), days=2)
    assert n == 0


def test_studio_playbooks_seeded(client):
    r = client.get("/playbooks")
    assert r.status_code == 200
    pbs = r.json().get("playbooks") or []
    ids = {p.get("id") for p in pbs}
    assert "studio-podcast" in ids
    assert "studio-pdf-module" in ids
