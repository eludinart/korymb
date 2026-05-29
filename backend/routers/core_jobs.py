"""
routers/core_jobs.py — Domaine jobs : liste, détail, cancel, validate, delete + compat /run/*.
Extrait de main.py — contrats API préservés à l'identique.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

from auth import verify_secret
from config import settings
from database import (
    append_job_mission_thread,
    get_conn,
    get_job as db_get_job,
    get_latest_chat_followup_snapshot,
    list_jobs as db_list_jobs,
    job_set_user_validated,
    job_close_mission_by_user,
    delete_mission_session,
    merge_job_deliverables_ui,
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
logger = logging.getLogger(__name__)


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


class DeliverablesUiPut(BaseModel):
    model_config = ConfigDict(extra="ignore")

    agents: dict[str, dict] | None = None


def delete_job_impl(job_id: str) -> dict:
    jid = (job_id or "").strip()[:16]
    if not jid:
        raise HTTPException(status_code=400, detail="job_id manquant.")
    from database import delete_job_cascade

    delete_job_from_state(jid)
    if not delete_job_cascade(jid):
        raise HTTPException(status_code=404, detail="Job introuvable.")
    return {"deleted": jid}


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
    try:
        from services.learning import trigger_learning_on_validate
        trigger_learning_on_validate(job_id)
    except Exception:
        logger.exception("Learning trigger failed for %s", job_id)
    return {"job_id": job_id, "user_validated_at": row3.get("user_validated_at") if row3 else None}


def close_mission_by_user_impl(job_id: str) -> dict:
    """Clôture dirigeant : y compris mission bloquée en « running » (utiliser plutôt que validate-mission)."""
    jid = (job_id or "").strip()[:16]
    if not jid:
        raise HTTPException(status_code=400, detail="job_id manquant.")
    row = db_get_job(jid)
    if not row:
        raise HTTPException(status_code=404, detail="Job introuvable.")
    if row.get("user_validated_at"):
        return {"job_id": jid, "already": True, "user_validated_at": row["user_validated_at"]}
    st = str(row.get("status") or "")
    if st == "cancelled":
        raise HTTPException(status_code=400, detail="Mission annulée — clôture impossible.")
    mem = active_jobs.get(jid)
    if mem and str(mem.get("status") or "") in ("running", "awaiting_validation"):
        mem["cancel_requested"] = True
        mem["status"] = "completed"
    try:
        closed = job_close_mission_by_user(jid)
    except Exception as exc:
        logger.exception("job_close_mission_by_user(%s)", jid)
        raise HTTPException(
            status_code=500,
            detail=f"Erreur lors de l'enregistrement de la clôture : {exc}",
        ) from exc
    if not closed:
        row2 = db_get_job(jid)
        if row2 and row2.get("user_validated_at"):
            uv = row2["user_validated_at"]
            if jid in active_jobs:
                active_jobs[jid]["user_validated_at"] = uv
                active_jobs[jid]["mission_closed_by_user"] = True
                active_jobs[jid]["status"] = str(row2.get("status") or "completed")
            return {"job_id": jid, "user_validated_at": uv, "closed": True}
        st2 = str((row2 or {}).get("status") or st or "inconnu")
        raise HTTPException(
            status_code=500,
            detail=f"Clôture impossible (statut actuel : {st2}). Réessayez ou redémarrez le backend.",
        )
    row3 = db_get_job(jid)
    uv = row3.get("user_validated_at") if row3 else None
    if jid in active_jobs and row3:
        active_jobs[jid]["user_validated_at"] = uv
        active_jobs[jid]["mission_closed_by_user"] = True
        active_jobs[jid]["status"] = str(row3.get("status") or "completed")
    return {"job_id": jid, "user_validated_at": uv, "closed": True}


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


@router.post("/jobs/close-mission", dependencies=[Depends(verify_secret)])
def close_mission_by_user_body(payload: ValidateMissionPayload):
    jid = str(payload.job_id or "").strip()
    if not jid:
        raise HTTPException(status_code=400, detail="job_id manquant.")
    return close_mission_by_user_impl(jid)


@router.get("/jobs/summary", dependencies=[Depends(verify_secret)])
def list_jobs_summary_route(limit: int = 80):
    from database import list_jobs_summary as db_list_jobs_summary
    rows = db_list_jobs_summary(limit=limit)
    return {"jobs": rows}


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
        if row_db:
            out["deliverables_ui"] = row_db.get("deliverables_ui") or {"agents": {}}
        else:
            out["deliverables_ui"] = {"agents": {}}
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
    out["deliverables_ui"] = row.get("deliverables_ui") or {"agents": {}}
    return out


@router.post("/jobs/{job_id}/validate-mission", dependencies=[Depends(verify_secret)])
def validate_mission_by_user(job_id: str):
    return validate_mission_by_user_impl(job_id)


@router.post("/jobs/{job_id}/close-mission", dependencies=[Depends(verify_secret)])
def close_mission_by_user_route(job_id: str):
    return close_mission_by_user_impl(job_id)


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


@router.put("/jobs/{job_id}/deliverables-ui", dependencies=[Depends(verify_secret)])
def put_deliverables_ui(job_id: str, body: DeliverablesUiPut):
    """Notes dirigeant et acceptations par livrable (clé = agent, ex. commercial)."""
    jid = (job_id or "").strip()[:16]
    if not jid:
        raise HTTPException(status_code=400, detail="job_id manquant.")
    out = merge_job_deliverables_ui(jid, body.agents or {})
    if out is None:
        raise HTTPException(status_code=404, detail="Mission introuvable.")
    return {"ok": True, "deliverables_ui": out.get("deliverables_ui") or {"agents": {}}}


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

    from database import mark_cio_questions_answered
    mark_cio_questions_answered(jid)

    refreshed = db_get_job(jid)
    job = active_jobs.get(jid)
    if job is not None and refreshed:
        job["mission_thread"] = list(refreshed.get("mission_thread") or [])
        job["events"] = list(refreshed.get("events") or [])
        events = job.setdefault("events", [])
        events.append({
            "type": "cio_question_answer",
            "actor": "dirigeant",
            "ts": now,
            "data": {"answer": answer},
        })

    return {"ok": True, "job_id": jid, "stored": True}


class HitlResolveBody(BaseModel):
    model_config = ConfigDict(extra="ignore")

    approved: bool | None = None
    comment: str = ""
    decision: str | None = None
    amended_plan: dict | None = None
    feedback: str = ""


@router.get("/jobs/{job_id}/hitl", dependencies=[Depends(verify_secret)])
def job_hitl_state(job_id: str):
    from database import get_hitl_gate, get_job

    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job introuvable.")
    gate = get_hitl_gate(job_id)
    return {
        "job_id": job_id,
        "status": job.get("status"),
        "orchestration_phase": job.get("orchestration_phase"),
        "hitl": gate,
    }


@router.post("/jobs/{job_id}/hitl/resolve", dependencies=[Depends(verify_secret)])
def job_hitl_resolve(job_id: str, body: HitlResolveBody):
    from services.hitl_unified import resolve_hitl

    result = resolve_hitl(
        job_id,
        approved=body.approved,
        comment=body.comment,
        decision=body.decision,
        amended_plan=body.amended_plan,
        feedback=body.feedback,
    )
    if not result.get("success"):
        err = str(result.get("error") or "").strip()
        code = 400 if "amend" in err.lower() or "requiert" in err.lower() else 404
        raise HTTPException(status_code=code, detail=err or "Job introuvable ou état invalide pour la validation HITL.")
    return result


@router.post("/jobs/{job_id}/resume", dependencies=[Depends(verify_secret)])
def job_resume_graph(job_id: str):
    from graph.runner import get_graph_state, resume_mission_graph

    state = get_graph_state(job_id)
    if not state or not state.get("next"):
        raise HTTPException(status_code=404, detail="Aucun checkpoint LangGraph à reprendre pour ce job.")
    out = resume_mission_graph(job_id, {"decision": "approve"})
    return {"ok": True, "job_id": job_id, "graph_state": out}


@router.post("/jobs/{job_id}/remove", dependencies=[Depends(verify_secret)])
def delete_job_post(job_id: str):
    return delete_job_impl(job_id)


@router.delete("/jobs/{job_id}", dependencies=[Depends(verify_secret)])
def delete_job(job_id: str):
    return delete_job_impl(job_id)


@router.get("/jobs/{job_id}/traces", dependencies=[Depends(verify_secret)])
def job_traces(job_id: str, limit: int = 200):
    from database import list_mission_traces
    return {"job_id": job_id, "traces": list_mission_traces(job_id, limit=limit)}


@router.get("/jobs/{job_id}/audit-bundle", dependencies=[Depends(verify_secret)])
def job_audit_bundle(job_id: str):
    from database import get_job, get_hitl_gate, list_hitl_plan_snapshots, list_mission_traces, list_quality_verdicts
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Mission introuvable.")
    return {
        "job": job,
        "traces": list_mission_traces(job_id),
        "quality_verdicts": list_quality_verdicts(job_id),
        "hitl_snapshots": list_hitl_plan_snapshots(job_id),
        "hitl": get_hitl_gate(job_id),
    }


@router.get("/jobs/{job_id}/hitl/plan-diff", dependencies=[Depends(verify_secret)])
def job_hitl_plan_diff(job_id: str, from_version: int = 1, to_version: int | None = None):
    from database import list_hitl_plan_snapshots
    from services.director_platform import plan_diff

    snaps = list_hitl_plan_snapshots(job_id)
    if not snaps:
        raise HTTPException(status_code=404, detail="Aucun snapshot plan pour cette mission.")
    by_v = {int(s.get("version") or 0): s.get("plan") or {} for s in snaps}
    fv = by_v.get(from_version)
    if fv is None:
        raise HTTPException(status_code=404, detail=f"Version {from_version} introuvable.")
    tv = by_v.get(to_version) if to_version else by_v.get(max(by_v.keys()))
    if tv is None:
        raise HTTPException(status_code=404, detail="Version cible introuvable.")
    return {"job_id": job_id, "from_version": from_version, "to_version": to_version or max(by_v.keys()), "diff": plan_diff(fv, tv)}


@router.post("/jobs/{job_id}/clone", dependencies=[Depends(verify_secret)])
def job_clone(job_id: str, background_tasks: BackgroundTasks):
    from database import get_job
    from services.mission import MissionRunConfig, _mission_config_from_payload, _schedule_mission_execution
    import uuid

    row = get_job(job_id)
    if not row:
        raise HTTPException(status_code=404, detail="Mission introuvable.")
    new_id = uuid.uuid4().hex[:12]
    mc = row.get("mission_config") if isinstance(row.get("mission_config"), dict) else {}
    cfg = _mission_config_from_payload({**MissionRunConfig().model_dump(), **mc})
    _schedule_mission_execution(
        background_tasks,
        new_id,
        str(row.get("agent") or "coordinateur"),
        str(row.get("mission") or ""),
        None,
        "clone",
        mission_config=cfg,
    )
    return {"ok": True, "source_job_id": job_id, "job_id": new_id}


@router.post("/jobs/{job_id}/quality-override", dependencies=[Depends(verify_secret)])
def job_quality_override(job_id: str, payload: dict):
    from database import get_job, insert_quality_verdict
    if not get_job(job_id):
        raise HTTPException(status_code=404, detail="Mission introuvable.")
    reason = str(payload.get("reason") or "").strip()
    insert_quality_verdict(job_id, phase="override", score=10.0, rejected=False, payload={"reason": reason, "override": True})
    return {"ok": True, "job_id": job_id}


# ── Compat /run/* (proxys restrictifs) ───────────────────────────────────────

def _deprecated_json(content: dict, *, status_code: int = 200) -> JSONResponse:
    return JSONResponse(
        content=content,
        status_code=status_code,
        headers={"Deprecation": "true", "Link": '</jobs>; rel="successor-version"'},
    )


@router.post("/run/remove-job", dependencies=[Depends(verify_secret)])
def run_remove_job(payload: RemoveJobPayload):
    return _deprecated_json(delete_job_impl(payload.job_id))


@router.post("/run/remove-mission-session", dependencies=[Depends(verify_secret)])
def run_remove_mission_session(payload: RemoveMissionSessionPayload):
    sid = str(payload.session_id or "").strip()
    if not sid:
        raise HTTPException(status_code=400, detail="session_id manquant.")
    if not delete_mission_session(sid):
        raise HTTPException(status_code=404, detail="Session introuvable.")
    return _deprecated_json({"deleted": True, "session_id": sid})


@router.post("/run/validate-mission", dependencies=[Depends(verify_secret)])
def run_validate_mission(payload: ValidateMissionPayload):
    jid = str(payload.job_id or "").strip()
    if not jid:
        raise HTTPException(status_code=400, detail="job_id manquant.")
    return _deprecated_json(validate_mission_by_user_impl(jid))


@router.post("/run/close-mission", dependencies=[Depends(verify_secret)])
def run_close_mission(payload: ValidateMissionPayload):
    jid = str(payload.job_id or "").strip()
    if not jid:
        raise HTTPException(status_code=400, detail="job_id manquant.")
    return _deprecated_json(close_mission_by_user_impl(jid))


@router.post("/run/clear-jobs", dependencies=[Depends(verify_secret)])
def run_clear_jobs():
    return _deprecated_json(clear_jobs_impl())
