"""
routers/core_jobs.py — Domaine jobs : liste, détail, cancel, validate, delete + compat /run/*.
Extrait de main.py — contrats API préservés à l'identique.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from auth import verify_secret
from config import settings
from database import (
    append_job_mission_thread,
    get_conn,
    get_job as db_get_job,
    get_latest_chat_followup_snapshot,
    list_jobs as db_list_jobs,
    job_set_user_validated,
    delete_mission_session,
)
from runtime_settings import merge_with_env
from state import (
    active_jobs,
    delete_job_from_state,
    clear_all_jobs_from_state,
    parse_team_field,
    extract_delivery_warnings_from_events,
)

router = APIRouter(tags=["jobs"])


def _followup_payload_for_parent(job_id: str, row: dict, pin: float, pout: float) -> dict | None:
    """Dernier tour CIO (job enfant chat) pour enrichir l’affichage du job mission parent."""
    if str(row.get("source") or "") == "chat":
        return None
    if (str(row.get("parent_job_id") or "").strip()):
        return None
    snap = get_latest_chat_followup_snapshot(job_id)
    if not snap:
        return None
    team = parse_team_field({"team_trace": snap.get("team_trace"), "team": []})
    ti = int(snap.get("tokens_in") or 0)
    to = int(snap.get("tokens_out") or 0)
    total = ti + to
    return {
        "job_id": snap["job_id"],
        "status": snap["status"],
        "result": snap["result"],
        "created_at": snap["created_at"],
        "team": team,
        "tokens_total": total,
        "cost_usd": round((ti * pin + to * pout) / 1_000_000, 5),
        "events_total": int(snap.get("events_total") or 0),
    }


# ── Modèles ───────────────────────────────────────────────────────────────────

class ValidateMissionPayload(BaseModel):
    job_id: str


class RemoveJobPayload(BaseModel):
    job_id: str


class RemoveMissionSessionPayload(BaseModel):
    session_id: str


def delete_job_impl(job_id: str) -> dict:
    delete_job_from_state(job_id)
    with get_conn() as conn:
        conn.execute("DELETE FROM jobs WHERE id=?", (job_id,))
        conn.commit()
    return {"deleted": job_id}


def clear_jobs_impl() -> dict:
    clear_all_jobs_from_state()
    with get_conn() as conn:
        conn.execute("DELETE FROM jobs")
        conn.commit()
    return {"cleared": True}


def validate_mission_by_user_impl(job_id: str) -> dict:
    if active_jobs.get(job_id, {}).get("status") == "running":
        raise HTTPException(status_code=400, detail="Mission encore en cours.")
    row = db_get_job(job_id)
    if not row:
        raise HTTPException(status_code=404, detail="Job introuvable.")
    if row.get("user_validated_at"):
        return {"job_id": job_id, "already": True, "user_validated_at": row["user_validated_at"]}
    if row.get("status") != "completed":
        raise HTTPException(
            status_code=400,
            detail="Seule une mission terminée avec succès peut être validée par le dirigeant.",
        )
    if not job_set_user_validated(job_id):
        row2 = db_get_job(job_id)
        if row2 and row2.get("user_validated_at"):
            return {"job_id": job_id, "user_validated_at": row2["user_validated_at"]}
        raise HTTPException(status_code=500, detail="Enregistrement de la validation impossible.")
    row3 = db_get_job(job_id)
    return {"job_id": job_id, "user_validated_at": row3.get("user_validated_at") if row3 else None}


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/jobs", dependencies=[Depends(verify_secret)])
def list_jobs(limit: int = 50):
    db_jobs = {j["id"]: j for j in db_list_jobs(limit)}
    for jid, job in active_jobs.items():
        prev = db_jobs.get(jid)
        merged = {"id": jid, **job, "logs": []}
        if prev:
            for field in ("user_validated_at", "mission_config", "mission_thread", "parent_job_id"):
                if prev.get(field):
                    merged[field] = prev[field]
        db_jobs[jid] = merged

    jobs = sorted(db_jobs.values(), key=lambda j: j.get("created_at", ""), reverse=True)
    out: list[dict] = []
    for j in jobs:
        if len(out) >= limit:
            break
        if (j.get("parent_job_id") or "").strip() and str(j.get("source") or "") == "chat":
            continue
        ev = j.get("events") or []
        if not isinstance(ev, list):
            ev = []
        pl = j.get("plan") if isinstance(j.get("plan"), dict) else {}
        has_plan = bool(
            (str(pl.get("synthese_attendue") or "").strip())
            or (pl.get("sous_taches") or {})
            or (pl.get("agents") or []),
        )
        uva = j.get("user_validated_at") or None
        mc = j.get("mission_config") if isinstance(j.get("mission_config"), dict) else {}
        mt = j.get("mission_thread") if isinstance(j.get("mission_thread"), list) else []
        dw = extract_delivery_warnings_from_events(ev)
        raw_result = str(j.get("result") or "").strip()
        out.append({
            "job_id": j.get("id", j.get("job_id", "")),
            "agent": j["agent"],
            "mission": j["mission"],
            "status": j["status"],
            "result": raw_result[:3000] + ("…" if len(raw_result) > 3000 else ""),
            "tokens_in": j.get("tokens_in", 0),
            "tokens_out": j.get("tokens_out", 0),
            "tokens_total": j.get("tokens_in", 0) + j.get("tokens_out", 0),
            "cost_usd": round(
                (j.get("tokens_in", 0) * float(merge_with_env().get("llm_price_input_per_million_usd") or 0)
                 + j.get("tokens_out", 0) * float(merge_with_env().get("llm_price_output_per_million_usd") or 0))
                / 1_000_000, 5
            ),
            "created_at": j.get("created_at", ""),
            "team": parse_team_field(j),
            "source": j.get("source", "mission"),
            "events_count": len(ev),
            "has_plan": has_plan,
            "user_validated_at": uva,
            "mission_closed_by_user": bool(uva),
            "mission_config": mc,
            "mission_thread": mt[-12:] if len(mt) > 12 else mt,
            "mission_thread_count": len(mt),
            "delivery_warnings": dw,
            "delivery_blocked": bool(dw),
            "parent_job_id": j.get("parent_job_id") or None,
            "chat_session_id": j.get("chat_session_id") or None,
        })
    return {"jobs": out}


@router.post("/jobs/clear", dependencies=[Depends(verify_secret)])
def clear_jobs_post():
    return clear_jobs_impl()


@router.delete("/jobs", dependencies=[Depends(verify_secret)])
def clear_jobs():
    return clear_jobs_impl()


@router.post("/jobs/validate-mission", dependencies=[Depends(verify_secret)])
def validate_mission_by_user_body(payload: ValidateMissionPayload):
    jid = str(payload.job_id or "").strip()
    if not jid:
        raise HTTPException(status_code=400, detail="job_id manquant.")
    return validate_mission_by_user_impl(jid)


@router.get("/jobs/{job_id}", dependencies=[Depends(verify_secret)])
def get_job(job_id: str, log_offset: int = 0, events_offset: int = 0):
    cfg = merge_with_env()
    pin = float(cfg.get("llm_price_input_per_million_usd") or 0)
    pout = float(cfg.get("llm_price_output_per_million_usd") or 0)
    job = active_jobs.get(job_id)
    if job:
        logs = job.get("logs", [])
        total = job.get("tokens_in", 0) + job.get("tokens_out", 0)
        ev = job.get("events") or []
        if not isinstance(ev, list):
            ev = []
        off = max(0, events_offset)
        row_db = db_get_job(job_id)
        uva = (row_db or {}).get("user_validated_at") if row_db else None
        mc = job.get("mission_config")
        if (not isinstance(mc, dict) or not mc) and row_db:
            mc = row_db.get("mission_config") if isinstance(row_db.get("mission_config"), dict) else {}
        mt: list = (row_db["mission_thread"] if row_db and isinstance(row_db.get("mission_thread"), list) else [])
        dw = extract_delivery_warnings_from_events(ev)
        parent_out = job.get("parent_job_id") or ((row_db or {}).get("parent_job_id") if row_db else None)
        hitl_block = None
        if str(job.get("status") or "") == "awaiting_validation" or (
            row_db and str(row_db.get("status") or "") == "awaiting_validation"
        ):
            from database import get_hitl_gate
            hitl_block = get_hitl_gate(job_id)
        fb = _followup_payload_for_parent(job_id, row_db or {}, pin, pout) if row_db else None
        out = {
            "job_id": job_id, "status": job["status"], "agent": job["agent"], "mission": job["mission"],
            "result": job.get("result"), "team": job.get("team") or [],
            "logs": logs[log_offset:], "log_total": len(logs),
            "tokens_in": job.get("tokens_in", 0), "tokens_out": job.get("tokens_out", 0),
            "tokens_total": total,
            "cost_usd": round((job.get("tokens_in", 0) * pin + job.get("tokens_out", 0) * pout) / 1_000_000, 5),
            "token_alert": total >= settings.token_alert_threshold,
            "source": job.get("source", "mission"), "plan": job.get("plan") or {},
            "events": ev[off:], "events_total": len(ev), "events_offset": off,
            "user_validated_at": uva, "mission_closed_by_user": bool(uva),
            "mission_config": mc if isinstance(mc, dict) else {},
            "mission_thread": mt, "mission_thread_count": len(mt),
            "delivery_warnings": dw, "delivery_blocked": bool(dw),
            "parent_job_id": parent_out or None,
            "chat_session_id": (job.get("chat_session_id") or ((row_db or {}).get("chat_session_id") if row_db else None) or None),
            "hitl": hitl_block,
        }
        if fb:
            out["latest_chat_followup"] = fb
        return out
    row = db_get_job(job_id)
    if not row:
        raise HTTPException(status_code=404, detail="Job introuvable.")
    logs = row.get("logs", [])
    total = row.get("tokens_in", 0) + row.get("tokens_out", 0)
    ev = row.get("events") or []
    if not isinstance(ev, list):
        ev = []
    off = max(0, events_offset)
    uva = row.get("user_validated_at")
    mc = row.get("mission_config") if isinstance(row.get("mission_config"), dict) else {}
    mt = row.get("mission_thread") if isinstance(row.get("mission_thread"), list) else []
    dw = extract_delivery_warnings_from_events(ev)
    hitl_block = None
    if str(row.get("status") or "") == "awaiting_validation":
        from database import get_hitl_gate
        hitl_block = get_hitl_gate(job_id)
    fb = _followup_payload_for_parent(job_id, row, pin, pout)
    out = {
        "job_id": job_id, "status": row["status"], "agent": row["agent"], "mission": row["mission"],
        "result": row.get("result"), "team": parse_team_field(row),
        "logs": logs[log_offset:], "log_total": len(logs),
        "tokens_in": row.get("tokens_in", 0), "tokens_out": row.get("tokens_out", 0),
        "tokens_total": total,
        "cost_usd": round((row.get("tokens_in", 0) * pin + row.get("tokens_out", 0) * pout) / 1_000_000, 5),
        "created_at": row.get("created_at"),
        "token_alert": total >= settings.token_alert_threshold,
        "source": row.get("source", "mission"), "plan": row.get("plan") or {},
        "events": ev[off:], "events_total": len(ev), "events_offset": off,
        "user_validated_at": uva, "mission_closed_by_user": bool(uva),
        "mission_config": mc, "mission_thread": mt, "mission_thread_count": len(mt),
        "delivery_warnings": dw, "delivery_blocked": bool(dw),
        "parent_job_id": row.get("parent_job_id") or None,
        "chat_session_id": row.get("chat_session_id") or None,
        "hitl": hitl_block,
    }
    if fb:
        out["latest_chat_followup"] = fb
    return out


@router.post("/jobs/{job_id}/validate-mission", dependencies=[Depends(verify_secret)])
def validate_mission_by_user(job_id: str):
    return validate_mission_by_user_impl(job_id)


@router.post("/jobs/{job_id}/cancel", dependencies=[Depends(verify_secret)])
def cancel_running_job(job_id: str):
    jid = (job_id or "").strip()
    if not jid:
        raise HTTPException(status_code=400, detail="job_id manquant.")
    row = active_jobs.get(jid)
    if not row:
        raise HTTPException(status_code=404, detail="Mission introuvable en mémoire (déjà terminée ou redémarrage serveur).")
    st = str(row.get("status") or "")
    if st not in ("running", "awaiting_validation"):
        raise HTTPException(status_code=400, detail="La mission n'est pas en cours d'exécution.")
    row["cancel_requested"] = True
    return {"ok": True, "job_id": jid, "message": "Annulation enregistrée ; l'exécution s'arrête dès la prochaine étape."}


@router.post("/jobs/{job_id}/cio-answer", dependencies=[Depends(verify_secret)])
def cio_answer(job_id: str, payload: dict):
    """
    Stocke la réponse du dirigeant aux questions CIO dans le fil de la mission.
    Injecte dans mission_thread (state + DB) pour que la synthèse CIO en cours ou future en tienne compte.
    """
    answer = str(payload.get("answer", "")).strip()
    if not answer:
        raise HTTPException(status_code=400, detail="Réponse vide.")

    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat()
    jid = (job_id or "").strip()[:16]
    if not jid:
        raise HTTPException(status_code=400, detail="job_id manquant.")

    row = db_get_job(jid)
    if row is None:
        raise HTTPException(status_code=404, detail="Mission introuvable.")

    try:
        append_job_mission_thread(
            jid,
            role="user",
            agent="dirigeant",
            content=f"[Réponse questions CIO] {answer}",
            source="cio_question_answer",
        )
    except Exception:
        raise HTTPException(status_code=500, detail="Impossible d'enregistrer la réponse sur le fil mission.") from None

    refreshed = db_get_job(jid)
    job = active_jobs.get(jid)
    if job is not None and refreshed:
        job["mission_thread"] = list(refreshed.get("mission_thread") or [])
        events = job.setdefault("events", [])
        events.append({
            "type": "cio_question_answer",
            "actor": "dirigeant",
            "ts": now,
            "data": {"answer": answer},
        })

    return {"ok": True, "job_id": jid, "stored": True}


@router.post("/jobs/{job_id}/remove", dependencies=[Depends(verify_secret)])
def delete_job_post(job_id: str):
    return delete_job_impl(job_id)


@router.delete("/jobs/{job_id}", dependencies=[Depends(verify_secret)])
def delete_job(job_id: str):
    return delete_job_impl(job_id)


# ── Compat /run/* (proxys restrictifs) ───────────────────────────────────────

@router.post("/run/remove-job", dependencies=[Depends(verify_secret)])
def run_remove_job(payload: RemoveJobPayload):
    return delete_job_impl(payload.job_id)


@router.post("/run/remove-mission-session", dependencies=[Depends(verify_secret)])
def run_remove_mission_session(payload: RemoveMissionSessionPayload):
    sid = str(payload.session_id or "").strip()
    if not sid:
        raise HTTPException(status_code=400, detail="session_id manquant.")
    if not delete_mission_session(sid):
        raise HTTPException(status_code=404, detail="Session introuvable.")
    return {"deleted": True, "session_id": sid}


@router.post("/run/validate-mission", dependencies=[Depends(verify_secret)])
def run_validate_mission(payload: ValidateMissionPayload):
    jid = str(payload.job_id or "").strip()
    if not jid:
        raise HTTPException(status_code=400, detail="job_id manquant.")
    return validate_mission_by_user_impl(jid)


@router.post("/run/clear-jobs", dependencies=[Depends(verify_secret)])
def run_clear_jobs():
    return clear_jobs_impl()
