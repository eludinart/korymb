"""
database_jobs.py — Jobs + colonnes HITL (extrait progressif hors de database.py).

Les implémentations HITL vivent ici ; `database` réexporte pour compatibilité.
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any


def job_set_awaiting_hitl(job_id: str, gate_payload: dict) -> bool:
    """Suspend le job en attente de validation HITL humaine."""
    import database as db

    jid = db.resolve_job_id(job_id) or db._norm_job_id(job_id)
    if not jid:
        return False
    now = datetime.utcnow().isoformat()
    gate_json = json.dumps(gate_payload, ensure_ascii=False)
    with db.get_conn() as conn:
        db._ensure_jobs_hitl_column(conn)
        cur = conn.execute(
            "UPDATE jobs SET status = 'awaiting_validation', hitl_gate_json = ?, hitl_resolved_at = NULL, "
            "hitl_comment = '', hitl_resolution_json = NULL, updated_at = ? "
            "WHERE id = ? AND workspace_id = ? AND status IN ('running', 'pending')",
            (gate_json, now, jid, db._ws()),
        )
        conn.commit()
        return int(getattr(cur, "rowcount", 0) or 0) > 0


def job_resume_after_hitl(
    job_id: str,
    *,
    approved: bool | None = None,
    comment: str = "",
    decision: str | None = None,
    resolution: dict | None = None,
) -> bool:
    """Reprend ou annule un job suspendu en attente HITL.

    decision : approve | reject | amend (prioritaire sur approved legacy).
    resolution : pour amend — ex. {"amended_plan": {...}, "feedback": "..."}.
    """
    import database as db

    jid = db.resolve_job_id(job_id) or db._norm_job_id(job_id)
    if not jid:
        return False
    dec = (decision or "").strip().lower()
    if dec not in ("approve", "reject", "amend"):
        if approved is False:
            dec = "reject"
        else:
            dec = "approve"
    if dec == "reject":
        new_status = "cancelled"
        res_blob = None
    else:
        new_status = "running"
        if dec == "amend" and isinstance(resolution, dict) and resolution:
            res_blob = json.dumps(resolution, ensure_ascii=False)
        else:
            res_blob = None
    now = datetime.utcnow().isoformat()
    comment_s = (comment or "")[:8000]
    with db.get_conn() as conn:
        db._ensure_jobs_hitl_column(conn)
        cur = conn.execute(
            "UPDATE jobs SET status = ?, hitl_resolved_at = ?, hitl_comment = ?, hitl_resolution_json = ?, "
            "updated_at = ? WHERE id = ? AND workspace_id = ? AND status = 'awaiting_validation'",
            (new_status, now, comment_s, res_blob, now, jid, db._ws()),
        )
        if int(getattr(cur, "rowcount", 0) or 0) > 0:
            conn.commit()
            return True
        row = conn.execute(
            "SELECT status, hitl_gate_json, hitl_resolved_at FROM jobs WHERE id = ? AND workspace_id = ?",
            (jid, db._ws()),
        ).fetchone()
        if not row:
            conn.commit()
            return False
        d = dict(row)
        gate_raw = (d.get("hitl_gate_json") or "").strip()
        resolved = (d.get("hitl_resolved_at") or "").strip()
        if not gate_raw or resolved:
            conn.commit()
            return False
        cur = conn.execute(
            "UPDATE jobs SET status = ?, hitl_resolved_at = ?, hitl_comment = ?, hitl_resolution_json = ?, "
            "updated_at = ? WHERE id = ? AND workspace_id = ?",
            (new_status, now, comment_s, res_blob, now, jid, db._ws()),
        )
        conn.commit()
        return int(getattr(cur, "rowcount", 0) or 0) > 0


def get_hitl_gate(job_id: str) -> dict | None:
    """Retourne le payload de la gate HITL pour un job, ou None."""
    import database as db

    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT hitl_gate_json, hitl_resolved_at, hitl_comment, hitl_resolution_json FROM jobs "
            "WHERE id = ? AND workspace_id = ?",
            (job_id, db._ws()),
        ).fetchone()
    if not row:
        return None
    d = dict(row)
    try:
        gate = json.loads(d.get("hitl_gate_json") or "{}")
    except json.JSONDecodeError:
        gate = {}
    res: dict | None = None
    raw_res = d.get("hitl_resolution_json")
    if raw_res:
        try:
            parsed = json.loads(raw_res)
            res = parsed if isinstance(parsed, dict) else None
        except json.JSONDecodeError:
            res = None
    return {
        "gate": gate,
        "resolved_at": d.get("hitl_resolved_at"),
        "comment": d.get("hitl_comment"),
        "resolution": res,
    }


__all__ = [
    "job_set_awaiting_hitl",
    "job_resume_after_hitl",
    "get_hitl_gate",
]
