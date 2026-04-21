"""
state.py — Etat mémoire partagé entre main.py et les routers.
Importé par main.py ET par les routers domain pour éviter les importations circulaires.
"""
from __future__ import annotations

import json
import logging
from datetime import date
from typing import Any

from observability import make_event
from debug_ndjson import append_session_ndjson

logger = logging.getLogger(__name__)

# Jobs actifs en mémoire vive (complétés par SQLite via database.py).
active_jobs: dict[str, dict] = {}

# Compteurs tokens par jour calendaire (non persistés au redémarrage).
daily_tokens: dict[str, dict] = {}


class KorymbJobCancelled(Exception):
    """Annulation demandée par l'utilisateur (POST /jobs/{id}/cancel)."""


def raise_if_job_cancelled(job_id: str | None) -> None:
    if job_id and job_id in active_jobs and active_jobs[job_id].get("cancel_requested"):
        raise KorymbJobCancelled()


def today() -> str:
    return date.today().isoformat()


def add_daily(t_in: int, t_out: int) -> None:
    d = today()
    if d not in daily_tokens:
        daily_tokens[d] = {"in": 0, "out": 0}
    daily_tokens[d]["in"] += t_in
    daily_tokens[d]["out"] += t_out


def sync_active_job_tokens(job_id: str | None, t_in: int, t_out: int) -> None:
    if not job_id or job_id not in active_jobs:
        return
    active_jobs[job_id]["tokens_in"] = int(t_in)
    active_jobs[job_id]["tokens_out"] = int(t_out)


def tokens_inflight() -> int:
    return sum(
        int(j.get("tokens_in", 0)) + int(j.get("tokens_out", 0))
        for j in active_jobs.values()
        if j.get("status") == "running"
    )


def parse_team_field(j: dict) -> list:
    t = j.get("team")
    if isinstance(t, list):
        return t
    tr = j.get("team_trace")
    if isinstance(tr, str):
        try:
            return json.loads(tr or "[]")
        except Exception:
            return []
    return []


def delete_job_from_state(job_id: str) -> None:
    active_jobs.pop(job_id, None)


def clear_all_jobs_from_state() -> None:
    active_jobs.clear()


def _cio_ndjson_trace(
    run_id: str,
    hypothesis_id: str,
    location: str,
    message: str,
    data: dict | None = None,
) -> None:
    # region agent log
    append_session_ndjson(run_id, hypothesis_id, location, message, data)
    # endregion


def emit_job_event(
    job_id: str | None,
    typ: str,
    agent: str | None = None,
    payload: dict | None = None,
) -> None:
    """Append-only : prêt pour export NDJSON / bus async plus tard."""
    if not job_id or job_id not in active_jobs:
        if typ in (
            "delegation",
            "instruction_delivered",
            "agent_turn_done",
            "synthesis_done",
            "mission_done",
            "orchestration_start",
        ):
            _cio_ndjson_trace(
                "emit_orphan",
                "H4",
                "state.py:emit_job_event",
                "job_event_not_stored",
                {
                    "typ": typ,
                    "agent": agent,
                    "has_job_id": bool(job_id),
                    "in_active_jobs": job_id in active_jobs if job_id else False,
                },
            )
        return
    ev = make_event(typ, agent, payload)
    active_jobs[job_id].setdefault("events", []).append(ev)
    if typ == "team_dialogue":
        pl = payload if isinstance(payload, dict) else {}
        line = str(pl.get("line_fr") or "").strip()
        if line:
            phase = str(pl.get("phase") or "dialogue").strip()[:24] or "dialogue"
            src = f"orchestration_{phase}"[:32]
            ag = (agent or "coordinateur")[:32]
            try:
                from database import append_job_mission_thread
                append_job_mission_thread(
                    job_id,
                    role="assistant",
                    agent=ag,
                    content=line[:12000],
                    source=src,
                )
            except Exception:
                logger.exception("append_job_mission_thread (team_dialogue → journal mission)")


def publish_team(job_id: str | None, rows: list[dict]) -> None:
    """Expose qui travaille sur la mission (UI + persistance via update_job)."""
    if not job_id or job_id not in active_jobs:
        return
    active_jobs[job_id]["team"] = [{**r} for r in rows]


def extract_delivery_warnings_from_events(events: Any) -> list[str]:
    """Dernier event delivery_review → liste des avertissements."""
    if not isinstance(events, list):
        return []
    for i in range(len(events) - 1, -1, -1):
        e = events[i]
        if not isinstance(e, dict):
            continue
        if e.get("type") != "delivery_review":
            continue
        pl = e.get("payload") or {}
        w = pl.get("warnings")
        if isinstance(w, list):
            return [str(x).strip() for x in w if str(x).strip()]
    return []
