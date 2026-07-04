"""
routers/core_chat.py — Route /chat.
"""
from __future__ import annotations

import logging
import threading
import uuid
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, ConfigDict

from auth import resolve_tenant, require_admin
from database import (
    save_job,
    update_job,
    append_recent_mission,
    append_job_mission_thread,
    get_chat_session_summary,
)
from services.agents import agents_def, FLEUR_CONTEXT, SUB_AGENT_COORDINATION_FR
from services.chat_surface import surface_chat_result
from services.chat_mirror import generate_mirror_ack
from services.memory import compress_chat_session, maybe_refresh_mission_summary
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


def _build_chat_mission_txt(
    msg_snap: str,
    hist_snap: list[dict],
    linked_parent_id: str,
    session_id: str,
) -> str:
    session_summary = get_chat_session_summary(session_id) if session_id else ""
    hist_lines: list[str] = []
    if not session_summary:
        for h in hist_snap:
            if h.get("role") in ("user", "assistant"):
                role = "Utilisateur" if h["role"] == "user" else "CIO"
                c = h.get("content", "")
                if isinstance(c, str):
                    hist_lines.append(f"{role}: {c[:800]}")
    parent_blob = (
        _mission_followup_context_from_parent(linked_parent_id)
        if linked_parent_id
        else ""
    )
    if parent_blob:
        if session_summary:
            return (
                parent_blob
                + f"État compressé de la session chat :\n{session_summary}\n\n"
                f"Dernière demande à traiter maintenant :\n{msg_snap}"
            )
        conv = "\n".join(hist_lines) if hist_lines else "(début de conversation)"
        return (
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
    if session_summary:
        return (
            f"État compressé de la session :\n{session_summary}\n\n"
            f"Dernière demande à traiter maintenant :\n{msg_snap}"
        )
    conv = "\n".join(hist_lines) if hist_lines else "(début de conversation)"
    return (
        f"Échanges récents :\n{conv}\n\n"
        f"Dernière demande à traiter maintenant :\n{msg_snap}"
    )


@router.post("/chat", dependencies=[Depends(resolve_tenant)])
async def chat(request: ChatRequest, background_tasks: BackgroundTasks):
    agent_cfg = agents_def().get(request.agent, agents_def()["coordinateur"])

    try:
        if request.agent == "coordinateur":
            job_id = str(uuid.uuid4())[:8]
            now_iso = datetime.utcnow().isoformat()
            linked_parent_id = (request.linked_job_id or "").strip()[:16]
            session_id = (request.chat_session_id or "").strip()[:64] or ""
            hist_snap = [] if linked_parent_id or session_id else list(request.history[-6:])
            msg_snap = request.message
            save_job(
                job_id,
                "coordinateur",
                (request.message or "")[:500],
                source="chat",
                parent_job_id=linked_parent_id or None,
                chat_session_id=session_id or None,
            )
            job_logs: list[str] = []
            active_jobs[job_id] = {
                "status": "running",
                "agent": "coordinateur",
                "mission": (request.message or "")[:500],
                "result": None,
                "result_surface": None,
                "logs": job_logs,
                "tokens_in": 0,
                "tokens_out": 0,
                "team": [],
                "events": [],
                "plan": {},
                "source": "chat",
                "created_at": now_iso,
                "parent_job_id": linked_parent_id or None,
                "chat_session_id": session_id or None,
            }
            job_logs_ref = active_jobs[job_id]["logs"]

            if linked_parent_id and linked_parent_id != job_id:
                try:
                    append_job_mission_thread(
                        linked_parent_id,
                        role="user",
                        agent="dirigeant",
                        content=(msg_snap or ""),
                        source="chat_suivi_mission",
                    )
                except Exception:
                    logger.exception("append_job_mission_thread (ouverture tour chat → parent)")

            def execute_chat_cio():
                try:
                    from services.memory_directives import apply_user_memory_directive

                    directive = apply_user_memory_directive(msg_snap)
                    if directive:
                        action = directive.get("action")
                        key = directive.get("key", "global")
                        if action == "remember":
                            text = (
                                f"**Mémorisé** dans le contexte `{key}` :\n\n"
                                f"{directive.get('detail', '')}"
                            )
                        elif action == "forget_all":
                            text = f"**Contexte effacé** — volet `{key}` réinitialisé."
                        else:
                            removed = directive.get("removed")
                            text = (
                                f"**Suppression** dans `{key}` : "
                                f"{'phrase retirée' if removed else 'aucune occurrence trouvée'}."
                            )
                        surface = surface_chat_result(text)
                        _add_daily_svc(0, 0)
                        if job_id in active_jobs:
                            active_jobs[job_id].update({
                                "status": "completed",
                                "result": text,
                                "result_surface": surface,
                            })
                        update_job(
                            job_id,
                            "completed",
                            text,
                            job_logs_ref,
                            0,
                            0,
                            source="chat",
                            result_surface=surface,
                        )
                        return

                    _emit_job_event(
                        job_id,
                        "mission_start",
                        "coordinateur",
                        {"label": agent_cfg["label"], "mode": "chat", "preview": (msg_snap or "")[:240]},
                    )
                    mission_txt = _build_chat_mission_txt(
                        msg_snap, hist_snap, linked_parent_id, session_id,
                    )
                    text, ti, to = orchestrate_coordinateur_mission(
                        mission_txt,
                        msg_snap,
                        job_logs_ref,
                        chat_mode=True,
                        job_id=job_id,
                        cio_questions_enabled=False,
                    )
                    surface = surface_chat_result(text)
                    _add_daily_svc(ti, to)
                    team_snap = active_jobs[job_id].get("team", [])
                    pl = active_jobs[job_id].get("plan") or {}
                    ev = active_jobs[job_id].get("events") or []
                    if job_id in active_jobs:
                        active_jobs[job_id].update({
                            "status": "completed",
                            "result": text,
                            "result_surface": surface,
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
                        result_surface=surface,
                    )
                    if session_id:
                        try:
                            turn_count = len([h for h in request.history if h.get("role") == "user"]) + 1
                            compress_chat_session(
                                session_id,
                                user_message=msg_snap,
                                assistant_message=surface,
                                turn_count=turn_count,
                            )
                        except Exception:
                            logger.exception("compress_chat_session (chat)")
                    try:
                        append_recent_mission(job_id, msg_snap, surface or text or "")
                    except Exception:
                        logger.exception("append_recent_mission (chat)")
                    try:
                        maybe_refresh_mission_summary()
                    except Exception:
                        logger.exception("maybe_refresh_mission_summary (chat)")
                    if linked_parent_id and linked_parent_id != job_id:
                        try:
                            append_job_mission_thread(
                                linked_parent_id,
                                role="assistant",
                                agent="coordinateur",
                                content=(surface or text or ""),
                                source="chat_suivi_mission",
                            )
                        except Exception:
                            logger.exception("append_job_mission_thread (réponse CIO → parent)")
                    try:
                        from services.director_platform import emit_director_notification

                        preview = (surface or text or "").replace("\n", " ").strip()[:180]
                        if linked_parent_id and linked_parent_id != job_id:
                            action_url = f"/missions?job={linked_parent_id}"
                        elif session_id:
                            action_url = f"/chat?session={session_id}&job={job_id}"
                        else:
                            action_url = f"/chat?job={job_id}"
                        emit_director_notification(
                            kind="chat_result",
                            title="Réponse CIO prête",
                            body=preview or "La synthèse de votre demande chat est disponible.",
                            job_id=job_id,
                            action_url=action_url,
                        )
                    except Exception:
                        logger.exception("emit_director_notification (chat completed)")
                except Exception as e:
                    user_result = _user_visible_job_failure_markdown(e)
                    surface_err = surface_chat_result(user_result)
                    team_snap = active_jobs.get(job_id, {}).get("team", [])
                    pl = active_jobs.get(job_id, {}).get("plan") or {}
                    ev = active_jobs.get(job_id, {}).get("events") or []
                    _emit_job_event(job_id, "error", None, {"message": str(e)[:500]})
                    job_logs_ref.append(f"[korymb] Erreur : {e}")
                    if job_id in active_jobs:
                        active_jobs[job_id].update({
                            "status": f"error: {e}",
                            "result": user_result,
                            "result_surface": surface_err,
                        })
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
                        result_surface=surface_err,
                    )
                    lp = (linked_parent_id or "").strip()[:16]
                    if lp and lp != job_id:
                        try:
                            append_job_mission_thread(
                                lp,
                                role="assistant",
                                agent="coordinateur",
                                content=(surface_err or user_result or ""),
                                source="chat_suivi_mission_error",
                            )
                        except Exception:
                            logger.exception("append_job_mission_thread (erreur CIO → parent)")
                    try:
                        from services.director_platform import emit_director_notification

                        err_preview = (surface_err or user_result or "").replace("\n", " ").strip()[:160]
                        action_url = (
                            f"/missions?job={lp}" if lp and lp != job_id
                            else f"/chat?session={session_id}&job={job_id}" if session_id
                            else f"/chat?job={job_id}"
                        )
                        emit_director_notification(
                            kind="chat_error",
                            title="Échec de la demande chat",
                            body=err_preview or "La mission chat s'est terminée en erreur.",
                            job_id=job_id,
                            action_url=action_url,
                        )
                    except Exception:
                        logger.exception("emit_director_notification (chat error)")
                finally:
                    active_jobs.pop(job_id, None)

            mirror_ack = generate_mirror_ack(msg_snap)
            if linked_parent_id and linked_parent_id != job_id and mirror_ack:
                try:
                    append_job_mission_thread(
                        linked_parent_id,
                        role="assistant",
                        agent="coordinateur",
                        content=mirror_ack,
                        source="chat_mirror_ack",
                    )
                except Exception:
                    logger.exception("append_job_mission_thread (mirror_ack → parent)")

            threading.Thread(
                target=execute_chat_cio,
                name=f"korymb-chat-{job_id[:24]}",
                daemon=True,
            ).start()
            return {
                "status": "accepted",
                "job_id": job_id,
                "agent": "coordinateur",
                "mirror_ack": mirror_ack,
            }

        system_prompt = (
            agent_cfg["system"]
            + FLEUR_CONTEXT
            + SUB_AGENT_COORDINATION_FR
            + "\nRéponds de façon concise et directe."
        )
        from services.memory_directives import apply_user_memory_directive

        directive = apply_user_memory_directive(request.message)
        if directive:
            action = directive.get("action")
            key = directive.get("key", "global")
            if action == "remember":
                reply = (
                    f"Mémorisé dans le contexte `{key}` : {directive.get('detail', '')}"
                )
            elif action == "forget_all":
                reply = f"Contexte `{key}` effacé."
            else:
                removed = directive.get("removed")
                reply = (
                    f"Suppression dans `{key}` : "
                    f"{'effectuée' if removed else 'aucune occurrence trouvée'}."
                )
            return {"response": reply, "agent": request.agent}

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
                    content=(request.message or ""),
                    source=f"chat_{request.agent}",
                )
                append_job_mission_thread(
                    link_th,
                    role="assistant",
                    agent=request.agent,
                    content=(reply or ""),
                    source=f"chat_{request.agent}",
                )
            except Exception:
                logger.exception("append_job_mission_thread (chat synchrone)")
        return {"response": reply, "agent": request.agent}
    except Exception as e:
        raise HTTPException(status_code=500, detail=_user_visible_chat_sync_failure_text(e)) from e
