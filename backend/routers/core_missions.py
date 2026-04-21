"""
routers/core_missions.py — Routes /run et /mission-sessions/*.
"""
from __future__ import annotations

import uuid
import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from auth import verify_secret
from database import (
    get_job as db_get_job,
    create_mission_session,
    get_mission_session,
    list_mission_sessions,
    append_session_message,
    mission_session_commit,
    delete_mission_session,
)
from services.agents import agents_def
from services.mission import (
    MissionRunConfig,
    _schedule_mission_execution,
    _mission_config_from_payload,
    _session_planning_llm_turn,
    _compose_mission_brief_from_session,
    _append_session_exchange_for_delegation,
    _add_daily as _add_daily_svc,
)
from routers.core_jobs import validate_mission_by_user_impl

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Pydantic models ───────────────────────────────────────────────────────────

class MissionRequest(BaseModel):
    """Lancer une mission, ou (si user_validate_job_id) valider une mission déjà terminée."""
    model_config = ConfigDict(extra="ignore")

    mission: str = ""
    agent: str = "coordinateur"
    context: dict | None = None
    mission_config: MissionRunConfig | None = None
    user_validate_job_id: str | None = None
    remove_mission_session_id: str | None = Field(
        default=None,
        description="Avec mission vide : supprime cette session de cadrage.",
    )


class MissionResponse(BaseModel):
    status: str
    job_id: str
    agent: str
    user_validated_at: str | None = None


class MissionSessionCreate(BaseModel):
    agent: str = "coordinateur"
    title: str = ""
    initial_message: str | None = None


class MissionSessionMessageBody(BaseModel):
    message: str


class MissionSessionValidateBody(BaseModel):
    model_config = ConfigDict(extra="ignore")

    brief: str | None = None
    mission_config: MissionRunConfig | None = None


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/run", response_model=MissionResponse, dependencies=[Depends(verify_secret)])
async def run_mission(request: MissionRequest, background_tasks: BackgroundTasks):
    rsid = (request.remove_mission_session_id or "").strip()
    if rsid:
        if not delete_mission_session(rsid):
            raise HTTPException(status_code=404, detail="Session introuvable.")
        return MissionResponse(status="session_deleted", job_id=rsid, agent="coordinateur")

    vj = (request.user_validate_job_id or "").strip()
    if vj:
        out = validate_mission_by_user_impl(vj)
        row = db_get_job(vj)
        agent_key = (row or {}).get("agent") or "coordinateur"
        if agent_key not in agents_def():
            agent_key = "coordinateur"
        uva = out.get("user_validated_at")
        st = "already_validated" if out.get("already") else "validated"
        return MissionResponse(status=st, job_id=vj, agent=agent_key, user_validated_at=uva)

    mission_plain = (request.mission or "").strip()
    if not mission_plain:
        raise HTTPException(status_code=400, detail="Mission vide.")

    job_id = str(uuid.uuid4())[:8]
    agent_key = request.agent if request.agent in agents_def() else "coordinateur"
    mcfg = request.mission_config.model_dump() if request.mission_config else _mission_config_from_payload(None)
    _schedule_mission_execution(
        background_tasks,
        job_id,
        agent_key,
        mission_plain,
        request.context,
        "mission",
        mission_config=mcfg,
    )
    return MissionResponse(status="accepted", job_id=job_id, agent=agent_key)


@router.post("/mission-sessions", dependencies=[Depends(verify_secret)])
def mission_sessions_create(body: MissionSessionCreate):
    agent_key = body.agent if body.agent in agents_def() else "coordinateur"
    sid = str(uuid.uuid4()).replace("-", "")[:12]
    create_mission_session(sid, agent_key, (body.title or "").strip())
    if body.initial_message and str(body.initial_message).strip():
        append_session_message(sid, "user", str(body.initial_message).strip())
        s = get_mission_session(sid)
        if s:
            reply, ti, to = _session_planning_llm_turn(s)
            _add_daily_svc(ti, to)
            append_session_message(sid, "assistant", reply)
    row = get_mission_session(sid)
    if not row:
        raise HTTPException(status_code=500, detail="Session non créée.")
    return row


@router.get("/mission-sessions", dependencies=[Depends(verify_secret)])
def mission_sessions_list(limit: int = 40):
    return {"sessions": list_mission_sessions(limit)}


@router.get("/mission-sessions/{session_id}", dependencies=[Depends(verify_secret)])
def mission_sessions_get(session_id: str):
    row = get_mission_session(session_id)
    if not row:
        raise HTTPException(status_code=404, detail="Session introuvable.")
    return row


@router.delete("/mission-sessions/{session_id}", dependencies=[Depends(verify_secret)])
def mission_sessions_delete(session_id: str):
    if not delete_mission_session(session_id):
        raise HTTPException(status_code=404, detail="Session introuvable.")
    return {"deleted": True, "session_id": session_id}


@router.post("/mission-sessions/{session_id}/remove", dependencies=[Depends(verify_secret)])
def mission_sessions_remove(session_id: str):
    """Fallback si un proxy bloque DELETE."""
    if not delete_mission_session(session_id):
        raise HTTPException(status_code=404, detail="Session introuvable.")
    return {"deleted": True, "session_id": session_id}


@router.post("/mission-sessions/{session_id}/message", dependencies=[Depends(verify_secret)])
def mission_sessions_message(session_id: str, body: MissionSessionMessageBody):
    s = get_mission_session(session_id)
    if not s:
        raise HTTPException(status_code=404, detail="Session introuvable.")
    if s["status"] != "draft":
        raise HTTPException(status_code=400, detail="Session figée : crée une nouvelle session pour continuer.")
    msg = (body.message or "").strip()
    if not msg:
        raise HTTPException(status_code=400, detail="Message vide.")
    append_session_message(session_id, "user", msg)
    s2 = get_mission_session(session_id)
    if not s2:
        raise HTTPException(status_code=500, detail="Session perdue.")
    reply, ti, to = _session_planning_llm_turn(s2)
    _add_daily_svc(ti, to)
    append_session_message(session_id, "assistant", reply)
    return get_mission_session(session_id)


@router.post("/mission-sessions/{session_id}/validate", dependencies=[Depends(verify_secret)])
def mission_sessions_validate(
    session_id: str,
    body: MissionSessionValidateBody,
    background_tasks: BackgroundTasks,
):
    s = get_mission_session(session_id)
    if not s:
        raise HTTPException(status_code=404, detail="Session introuvable.")
    if s["status"] != "draft":
        raise HTTPException(status_code=400, detail="Déjà validée ou clôturée.")
    agent_key = s["agent"] if s["agent"] in agents_def() else "coordinateur"
    try:
        brief = _compose_mission_brief_from_session(s, body.brief)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    if agent_key == "coordinateur":
        brief = _append_session_exchange_for_delegation(s, brief)
    elif not (body.brief and str(body.brief).strip()):
        brief = _append_session_exchange_for_delegation(s, brief)
    job_id = str(uuid.uuid4())[:8]
    mcfg = _mission_config_from_payload(body.mission_config)
    _schedule_mission_execution(
        background_tasks, job_id, agent_key, brief, None, "mission_session", mission_config=mcfg,
    )
    note = f"[Système] Mission validée — exécution lancée (job #{job_id}). Tu peux suivre le flux d'interactions dans le QG."
    mission_session_commit(session_id, job_id, brief, closing_message=note)
    return {"job_id": job_id, "session_id": session_id, "agent": agent_key, "brief": brief}
