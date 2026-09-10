"""Passe de correction sur un contenu déjà produit (studio, playbook, mission)."""
from __future__ import annotations

import uuid
from typing import Any

from fastapi import BackgroundTasks

_READY = {"completed", "done", "error", "failed"}
_MAX_BODY = 24_000
_MAX_MISSION = 3_000


def launch_revision(
    background_tasks: BackgroundTasks,
    *,
    job_id: str,
    instruction: str,
    format_id: str = "",
) -> dict[str, Any]:
    from database import get_job
    from services.mission import MissionRunConfig, _mission_config_from_payload, _schedule_mission_execution

    row = get_job(job_id)
    if not row:
        raise ValueError("Mission introuvable.")
    status = str(row.get("status") or "").lower()
    if status not in _READY:
        raise ValueError("Attendez la fin de cette production avant de demander une correction.")
    note = (instruction or "").strip()
    if len(note) < 4:
        raise ValueError("Décrivez la correction (plus court, plus clair, autre ton…).")

    source = str(row.get("source") or "mission")
    piece_label = ""
    piece_body = ""
    child_source = source
    if source.startswith("studio:"):
        from services.studio import describe_studio_pieces

        pieces = describe_studio_pieces(row)
        fid = (format_id or "").strip()
        if fid:
            piece = next((p for p in pieces if p.get("format_id") == fid), None)
            if not piece:
                raise ValueError("Pièce introuvable dans cette production.")
            piece_label = str(piece.get("label") or fid)
            piece_body = str(piece.get("body") or "")
            child_source = f"studio:{fid}"
        elif len(pieces) == 1:
            piece_label = str(pieces[0].get("label") or "")
            piece_body = str(pieces[0].get("body") or "")

    previous = str(row.get("result") or "").strip()
    brief = _revision_brief(
        original_mission=str(row.get("mission") or ""),
        previous_result=previous,
        piece_label=piece_label,
        piece_body=piece_body,
        instruction=note,
        keep_livrable_heading=source.startswith("studio:"),
    )
    mc = row.get("mission_config") if isinstance(row.get("mission_config"), dict) else {}
    cfg = _mission_config_from_payload({**MissionRunConfig().model_dump(), **mc})
    agent_key = str(row.get("agent") or "coordinateur")
    new_id = uuid.uuid4().hex[:12]
    context = {
        "revision": {
            "parent_job_id": job_id,
            "format_id": (format_id or "").strip(),
            "instruction": note[:2000],
        }
    }
    _schedule_mission_execution(
        background_tasks,
        new_id,
        agent_key,
        brief,
        context,
        child_source,
        mission_config=cfg,
        parent_job_id=job_id,
    )
    return {
        "status": "accepted",
        "job_id": new_id,
        "parent_job_id": job_id,
        "source": child_source,
        "next": {
            "mission": f"/missions?job={new_id}",
            "hint": "Nouvelle passe lancée. Le texte corrigé remplacera le jet précédent une fois la mission terminée.",
        },
    }


def list_playbook_runs(*, limit: int = 20) -> list[dict[str, Any]]:
    from database import list_jobs
    from services.studio import _extract_livrables

    out: list[dict[str, Any]] = []
    for job in list_jobs(limit=max(limit * 6, 80)):
        source = str(job.get("source") or "")
        if not source.startswith("playbook:"):
            continue
        status = str(job.get("status") or "")
        result = str(job.get("result") or "")
        livrables = _extract_livrables(result) if status in ("completed", "done") else []
        pieces = []
        for liv in livrables:
            body = str(liv.get("body") or "")[:80_000]
            if not body and not liv.get("title"):
                continue
            pieces.append(
                {
                    "title": liv.get("title") or "Livrable",
                    "body": body,
                    "body_preview": body[:400],
                }
            )
        out.append(
            {
                "job_id": job.get("id"),
                "status": status,
                "playbook_id": source.split(":", 1)[-1],
                "created_at": job.get("created_at"),
                "mission_preview": str(job.get("mission") or "")[:240],
                "result_preview": result[:400],
                "pieces": pieces,
            }
        )
        if len(out) >= limit:
            break
    return out


def _revision_brief(
    *,
    original_mission: str,
    previous_result: str,
    piece_label: str,
    piece_body: str,
    instruction: str,
    keep_livrable_heading: bool,
) -> str:
    current = (piece_body or previous_result or "").strip()
    heading = (
        f"#### LIVRABLE — {piece_label or 'Contenu'}\n\n"
        if keep_livrable_heading
        else ""
    )
    origin = (original_mission or "").strip()[:_MAX_MISSION]
    lines = [
        "Passe de correction demandée par le dirigeant.",
        "Le premier jet n’est pas validé. Réécris le contenu en intégrant les consignes.",
        "Ne produis pas un mémo d’analyse : le résultat doit être le texte final, prêt à copier-coller.",
        "",
        "## Consignes",
        instruction.strip(),
    ]
    if origin:
        lines.extend(["", "## Brief d’origine (contexte)", origin])
    if current:
        lines.extend(
            [
                "",
                "## Version actuelle à corriger",
                current[:_MAX_BODY],
            ]
        )
    if keep_livrable_heading:
        lines.extend(
            [
                "",
                "## Format de sortie",
                f"Commence par `{heading.strip() or '#### LIVRABLE — …'}` puis le contenu final uniquement.",
            ]
        )
    return "\n".join(lines)
