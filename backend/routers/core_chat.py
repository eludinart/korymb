"""
routers/core_chat.py — Route /chat.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, ConfigDict

from auth import verify_secret
from database import (
    save_job,
    update_job,
    append_recent_mission,
    append_job_mission_thread,
)
from services.agents import agents_def, FLEUR_CONTEXT, SUB_AGENT_COORDINATION_FR
from services.mission import (
    orchestrate_coordinateur_mission,
    _mission_followup_context_from_parent,
    _user_visible_job_failure_markdown,
    _user_visible_chat_sync_failure_text,
    _add_daily as _add_daily_svc,
)
from state import active_jobs, emit_job_event as _emit_job_event
from agent_tool_use import llm_chat_maybe_tools

logger = logging.getLogger(__name__)
router = APIRouter()


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    message: str
    agent: str = "coordinateur"
    history: list[dict] = []
    linked_job_id: str | None = None
    chat_session_id: str | None = None


@router.post("/chat", dependencies=[Depends(verify_secret)])
async def chat(request: ChatRequest, background_tasks: BackgroundTasks):
    agent_cfg = agents_def().get(request.agent, agents_def()["coordinateur"])

    try:
        if request.agent == "coordinateur":
            job_id = str(uuid.uuid4())[:8]
            now_iso = datetime.utcnow().isoformat()
            linked_parent_id = (request.linked_job_id or "").strip()[:16]
            hist_snap = [] if linked_parent_id else list(request.history[-6:])
            msg_snap = request.message
            save_job(
                job_id,
                "coordinateur",
                (request.message or "")[:500],
                source="chat",
                parent_job_id=linked_parent_id or None,
                chat_session_id=(request.chat_session_id or "").strip()[:64] or None,
            )
            job_logs: list[str] = []
            active_jobs[job_id] = {
                "status": "running",
                "agent": "coordinateur",
                "mission": (request.message or "")[:500],
                "result": None,
                "logs": job_logs,
                "tokens_in": 0,
                "tokens_out": 0,
                "team": [],
                "events": [],
                "plan": {},
                "source": "chat",
                "created_at": now_iso,
                "parent_job_id": linked_parent_id or None,
            }
            job_logs_ref = active_jobs[job_id]["logs"]

            def execute_chat_cio():
                try:
                    _emit_job_event(
                        job_id,
                        "mission_start",
                        "coordinateur",
                        {"label": agent_cfg["label"], "mode": "chat", "preview": (msg_snap or "")[:240]},
                    )
                    hist_lines: list[str] = []
                    for h in hist_snap:
                        if h.get("role") in ("user", "assistant"):
                            role = "Utilisateur" if h["role"] == "user" else "CIO"
                            c = h.get("content", "")
                            if isinstance(c, str):
                                hist_lines.append(f"{role}: {c[:800]}")
                    conv = "\n".join(hist_lines) if hist_lines else "(début de conversation)"
                    parent_blob = (
                        _mission_followup_context_from_parent(linked_parent_id)
                        if linked_parent_id
                        else ""
                    )
                    if parent_blob:
                        mission_txt = (
                            parent_blob
                            + (
                                "Échanges récents dans cette session (chat) :\n"
                                + conv
                                + "\n\nDernière demande à traiter maintenant :\n"
                                + msg_snap
                                if hist_snap
                                else "Nouvelle demande du dirigeant (à traiter maintenant) :\n" + msg_snap
                            )
                        )
                    else:
                        mission_txt = (
                            f"Échanges récents :\n{conv}\n\n"
                            f"Dernière demande à traiter maintenant :\n{msg_snap}"
                        )
                    text, ti, to = orchestrate_coordinateur_mission(
                        mission_txt, msg_snap, job_logs_ref, chat_mode=True, job_id=job_id,
                    )
                    _add_daily_svc(ti, to)
                    team_snap = active_jobs[job_id].get("team", [])
                    pl = active_jobs[job_id].get("plan") or {}
                    ev = active_jobs[job_id].get("events") or []
                    if job_id in active_jobs:
                        active_jobs[job_id].update({
                            "status": "completed",
                            "result": text,
                            "tokens_in": ti,
                            "tokens_out": to,
                        })
                    update_job(
                        job_id,
                        "completed",
                        text,
                        job_logs_ref,
                        ti,
                        to,
                        team_trace=team_snap,
                        plan=pl,
                        events=ev,
                        source="chat",
                    )
                    try:
                        append_recent_mission(job_id, msg_snap, text or "")
                    except Exception:
                        logger.exception("append_recent_mission (chat)")
                    if linked_parent_id and linked_parent_id != job_id:
                        try:
                            append_job_mission_thread(
                                linked_parent_id,
                                role="user",
                                agent="dirigeant",
                                content=(msg_snap or "")[:8000],
                                source="chat_suivi_mission",
                            )
                            append_job_mission_thread(
                                linked_parent_id,
                                role="assistant",
                                agent="coordinateur",
                                content=(text or "")[:14000],
                                source="chat_suivi_mission",
                            )
                        except Exception:
                            logger.exception("append_job_mission_thread (chat → mission liée)")
                except Exception as e:
                    user_result = _user_visible_job_failure_markdown(e)
                    team_snap = active_jobs.get(job_id, {}).get("team", [])
                    pl = active_jobs.get(job_id, {}).get("plan") or {}
                    ev = active_jobs.get(job_id, {}).get("events") or []
                    _emit_job_event(job_id, "error", None, {"message": str(e)[:500]})
                    job_logs_ref.append(f"[korymb] Erreur : {e}")
                    if job_id in active_jobs:
                        active_jobs[job_id].update({"status": f"error: {e}", "result": user_result})
                    update_job(
                        job_id,
                        f"error: {e}",
                        user_result,
                        job_logs_ref,
                        0,
                        0,
                        team_trace=team_snap,
                        plan=pl,
                        events=ev,
                        source="chat",
                    )
                finally:
                    active_jobs.pop(job_id, None)

            background_tasks.add_task(execute_chat_cio)
            return {"status": "accepted", "job_id": job_id, "agent": "coordinateur"}

        system_prompt = (
            agent_cfg["system"]
            + FLEUR_CONTEXT
            + SUB_AGENT_COORDINATION_FR
            + "\nRéponds de façon concise et directe."
        )
        messages = []
        for h in request.history[-10:]:
            if h.get("role") in ("user", "assistant"):
                messages.append({"role": h["role"], "content": h["content"]})
        messages.append({"role": "user", "content": request.message})

        link_th = (request.linked_job_id or "").strip()[:16]
        usage_kw: dict = {"usage_context": f"chat_sync:{request.agent}"}
        if link_th:
            usage_kw["usage_job_id"] = link_th
        reply, ti, to = llm_chat_maybe_tools(
            system_prompt,
            messages,
            agent_cfg.get("tools"),
            job_logs=None,
            max_tokens=2048,
            **usage_kw,
        )
        _add_daily_svc(ti, to)
        if link_th:
            try:
                append_job_mission_thread(
                    link_th,
                    role="user",
                    agent="dirigeant",
                    content=(request.message or "")[:8000],
                    source=f"chat_{request.agent}",
                )
                append_job_mission_thread(
                    link_th,
                    role="assistant",
                    agent=request.agent,
                    content=(reply or "")[:14000],
                    source=f"chat_{request.agent}",
                )
            except Exception:
                logger.exception("append_job_mission_thread (chat synchrone)")
        return {"response": reply, "agent": request.agent}
    except Exception as e:
        raise HTTPException(status_code=500, detail=_user_visible_chat_sync_failure_text(e)) from e
