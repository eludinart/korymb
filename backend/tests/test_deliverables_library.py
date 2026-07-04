"""Tests bibliothèque livrables."""
from __future__ import annotations

import uuid

from database import save_job, update_job
from services.deliverable_library import build_deliverables_library, infer_deliverable_theme


def _job_suffix() -> str:
    return uuid.uuid4().hex[:8]


def test_infer_deliverable_theme_prospection():
    assert infer_deliverable_theme(mission="Tableau Resalib prospection") == "Prospection & vente"


def test_deliverables_library_ensures_unique_ids_when_legacy_duplicates(client):
    job_id = "delivlib_legacy_dup"
    save_job(job_id, "commercial", "Mission tarot legacy", source="mission", mission_config={})
    result = (
        "#### LIVRABLE — Simulation potentiel revenus tarot Fleur d'amour\n\n"
        "Premier bloc.\n\n"
        "#### LIVRABLE — simulation potentiel revenus tarot fleur d'amour\n\n"
        "Second bloc proche.\n"
    )
    update_job(job_id, "completed", result, events=[], team_trace=[{"key": "commercial"}])

    body = build_deliverables_library(limit=20)
    job_items = [item for item in body.get("items") or [] if item.get("job_id") == job_id]
    assert len(job_items) >= 1
    ids = [item.get("id") for item in job_items]
    assert len(ids) == len(set(ids))


def test_deliverables_library_in_app_ids_unique_for_similar_titles(client):
    job_id = "delivlib_dup_title"
    save_job(job_id, "commercial", "Mission tarot", source="mission", mission_config={})
    result = (
        "#### LIVRABLE — Simulation potentiel revenus tarot Fleur d'amour\n\n"
        "Premier bloc.\n\n"
        "#### LIVRABLE — simulation potentiel revenus tarot fleur d'amour\n\n"
        "Second bloc proche.\n"
    )
    update_job(job_id, "completed", result, events=[], team_trace=[{"key": "commercial"}])

    body = build_deliverables_library(limit=20)
    job_items = [item for item in body.get("items") or [] if item.get("job_id") == job_id]
    assert len(job_items) >= 1
    ids = [item.get("id") for item in job_items]
    assert len(ids) == len(set(ids))


def test_deliverables_library_unique_ids_across_jobs(client):
    for idx, job_id in enumerate(("delivlib_a", "delivlib_b"), start=1):
        save_job(job_id, "commercial", f"Mission {idx}", source="mission", mission_config={})
        result = (
            "**Fichiers Google Drive (Korymb)**\n"
            "- [Export](https://drive.google.com/file/d/shared-file-id/view?usp=sharing)\n"
        )
        update_job(job_id, "completed", result, events=[], team_trace=[{"key": "commercial"}])

    body = build_deliverables_library(limit=20)
    shared = [item for item in body.get("items") or [] if "shared-file-id" in str(item.get("href") or "")]
    assert len(shared) == 1
    assert shared[0].get("source_count", 1) >= 2


def test_deliverables_library_consolidates_drive_and_in_app(client):
    job_id = f"delivlib_merge_{_job_suffix()}"
    save_job(job_id, "commercial", "Prospection fusion", source="mission", mission_config={})
    artifacts = [
        {
            "id": "sheet_merge",
            "name": "Prospects_Resalib.csv",
            "webViewLink": "https://docs.google.com/spreadsheets/d/merge123/edit",
            "kind": "sheet",
            "agent": "commercial",
        }
    ]
    result = (
        "#### LIVRABLE — Tableau prospects\n\n"
        "| Nom | Ville |\n| --- | --- |\n| A | Paris |\n| B | Lyon |\n\n"
        "**Fichiers Google Drive (Korymb)**\n"
        "- [Prospects_Resalib](https://docs.google.com/spreadsheets/d/merge123/edit)\n"
    )
    update_job(job_id, "completed", result, events=[], team_trace=[{"key": "commercial"}])
    from database import append_job_drive_artifacts

    append_job_drive_artifacts(job_id, artifacts)

    body = build_deliverables_library(limit=50)
    rows = [x for x in body.get("items") or [] if x.get("job_id") == job_id]
    assert len(rows) == 1
    row = rows[0]
    assert row.get("href", "").startswith("https://docs.google.com")
    assert row.get("description")
    assert row.get("content_hint")
    assert len(row.get("access_points") or []) == 1


def test_deliverables_library_dismiss_hides_item(client):
    suffix = _job_suffix()
    job_id = f"delivlib_dismiss_{suffix}"
    sheet_id = f"dismiss_{suffix}"
    save_job(job_id, "commercial", "Prospection test dismiss", source="mission", mission_config={})
    artifacts = [
        {
            "id": "sheet_dismiss",
            "name": "Tableau_a_retirer.csv",
            "webViewLink": f"https://docs.google.com/spreadsheets/d/{sheet_id}/edit",
            "kind": "sheet",
            "agent": "commercial",
        }
    ]
    update_job(
        job_id,
        "completed",
        f"Livrable test\n\n- [Tableau](https://docs.google.com/spreadsheets/d/{sheet_id}/edit)\n",
        events=[],
        team_trace=[{"key": "commercial"}],
    )
    from database import append_job_drive_artifacts

    append_job_drive_artifacts(job_id, artifacts)

    before = build_deliverables_library(limit=50)
    item = next((x for x in (before.get("items") or []) if x.get("job_id") == job_id), None)
    assert item is not None
    item_id = item["id"]

    r = client.post("/deliverables/library/dismiss", json={"item_id": item_id})
    assert r.status_code == 200
    body = r.json()
    assert body.get("dismissed") is True
    assert str(body.get("item_id") or "").startswith("group:")

    after = build_deliverables_library(limit=50)
    assert not any(x.get("id") == body.get("item_id") for x in (after.get("items") or []))


def test_deliverables_library_from_job(client):
    job_id = f"delivlib1_{_job_suffix()}"
    save_job(job_id, "commercial", "Prospection Resalib Q2", source="mission", mission_config={})
    artifacts = [
        {
            "id": "sheet123",
            "name": "Prospects_Resalib.csv",
            "webViewLink": "https://docs.google.com/spreadsheets/d/abc123/edit",
            "kind": "sheet",
            "agent": "commercial",
        }
    ]
    result = (
        "#### LIVRABLE — Tableau prospects\n\n"
        "| Nom | Ville |\n| --- | --- |\n| A | B |\n\n"
        "**Fichiers Google Drive (Korymb)**\n"
        "- [Prospects_Resalib](https://docs.google.com/spreadsheets/d/abc123/edit)\n"
    )
    update_job(
        job_id,
        "completed",
        result,
        events=[],
        team_trace=[{"key": "commercial"}],
    )
    from database import append_job_drive_artifacts

    append_job_drive_artifacts(job_id, artifacts)

    r = client.get("/deliverables/library?limit=50")
    assert r.status_code == 200
    body = r.json()
    assert body.get("total", 0) >= 1
    flat = body.get("items") or []
    row = next((x for x in flat if x.get("job_id") == job_id), None)
    assert row is not None
    assert row.get("href", "").startswith("https://docs.google.com")
    assert row.get("theme") == "Prospection & vente"
    themes = body.get("themes") or []
    assert any(t.get("theme") == "Prospection & vente" for t in themes)
