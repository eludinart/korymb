"""Tests bibliothèque livrables."""
from __future__ import annotations

import json

from database import save_job, update_job
from services.deliverable_library import build_deliverables_library, infer_deliverable_theme


def test_infer_deliverable_theme_prospection():
    assert infer_deliverable_theme(mission="Tableau Resalib prospection") == "Prospection & vente"


def test_deliverables_library_from_job(client):
    job_id = "delivlib1"
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

    r = client.get("/deliverables/library?limit=20")
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
