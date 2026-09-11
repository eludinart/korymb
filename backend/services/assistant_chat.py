"""Exécution chat Assistant (atelier — sans orchestration multi-agents)."""
from __future__ import annotations

import logging
import re
import threading
import uuid
from datetime import datetime

from agent_tool_use import llm_chat_maybe_tools
from database import save_job, update_job
from services.agent_groups import ASSISTANT_SYSTEM
from services.agents import FLEUR_CONTEXT
from services.chat_surface import surface_chat_result
from services.memory import compress_chat_session
from services.mission import _add_daily as _add_daily_svc
from services.mission import _user_visible_job_failure_markdown
from state import active_jobs

logger = logging.getLogger(__name__)


def _extract_blueprint_id(*texts: str) -> str | None:
    for t in texts:
        m = re.search(r"bp-[a-f0-9]{12}", t or "")
        if m:
            return m.group(0)
    return None


def start_assistant_chat_job(
    *,
    message: str,
    history: list[dict],
    linked_job_id: str | None,
    chat_session_id: str | None,
) -> dict:
    job_id = str(uuid.uuid4())[:8]
    now_iso = datetime.utcnow().isoformat()
    linked_parent_id = (linked_job_id or "").strip()[:16]
    session_id = (chat_session_id or "").strip()[:64] or ""
    msg_snap = message

    save_job(
        job_id,
        "assistant",
        (message or "")[:500],
        source="chat",
        parent_job_id=linked_parent_id or None,
        chat_session_id=session_id or None,
    )
    job_logs: list[str] = []
    active_jobs[job_id] = {
        "status": "running",
        "agent": "assistant",
        "mission": (message or "")[:500],
        "result": None,
        "result_surface": None,
        "logs": job_logs,
        "tokens_in": 0,
        "tokens_out": 0,
        "team": [{"key": "assistant", "label": "Assistant", "status": "running", "phase": "chat"}],
        "events": [],
        "plan": {},
        "source": "chat",
        "created_at": now_iso,
        "parent_job_id": linked_parent_id or None,
        "chat_session_id": session_id or None,
        "pending_blueprint_id": None,
    }

    def execute() -> None:
        try:
            from services.memory_directives import apply_user_memory_directive

            directive = apply_user_memory_directive(msg_snap)
            if directive:
                action = directive.get("action")
                key = directive.get("key", "global")
                pending = "Proposition envoyée dans **Décisions** (pas encore écrite)."
                if action == "remember":
                    text = (
                        f"**À mémoriser** dans `{key}` (en attente de validation) :\n\n"
                        f"{directive.get('detail', '')}\n\n{pending}"
                    )
                elif action == "forget_all":
                    text = f"**À effacer** — volet `{key}` (en attente de validation). {pending}"
                else:
                    text = f"**À retirer** dans `{key}` : {directive.get('detail', '')}\n\n{pending}"
                surface = surface_chat_result(text)
                _add_daily_svc(0, 0)
                if job_id in active_jobs:
                    active_jobs[job_id].update({"status": "completed", "result": text, "result_surface": surface})
                update_job(job_id, "completed", text, job_logs, 0, 0, source="chat", result_surface=surface)
                return

            system_prompt = (
                ASSISTANT_SYSTEM
                + FLEUR_CONTEXT
                + "\nSois conversationnel et utile. "
                "Ne propose une équipe que si c'est clairement demandé ou nécessaire. "
                "Pour « qui es-tu ? » : courte présentation d'Assistant Korymb (chatbot), sans te dire CIO.\n"
            )
            messages = []
            for h in history[-12:]:
                if h.get("role") in ("user", "assistant"):
                    messages.append({"role": h["role"], "content": h["content"]})
            messages.append({"role": "user", "content": msg_snap})
            tool_tags = ["web", "drive", "teams", "workspace"]
            reply, ti, to = llm_chat_maybe_tools(
                system_prompt,
                messages,
                tool_tags,
                job_logs=job_logs,
                max_tokens=3072,
                usage_context="chat_sync:assistant",
                usage_job_id=job_id,
            )
            pending_bp = _extract_blueprint_id(reply, "\n".join(str(x) for x in job_logs[-50:]))
            surface = surface_chat_result(reply)
            if pending_bp:
                surface = (
                    f"{surface}\n\n---\n"
                    f"**Équipe proposée** (`{pending_bp}`) — valide avec le bouton "
                    f"**Créer l'équipe** sous ce message."
                )
            _add_daily_svc(ti, to)
            if job_id in active_jobs:
                active_jobs[job_id].update({
                    "status": "completed",
                    "result": reply,
                    "result_surface": surface,
                    "tokens_in": ti,
                    "tokens_out": to,
                    "pending_blueprint_id": pending_bp,
                    "team": [{"key": "assistant", "label": "Assistant", "status": "done", "phase": "chat"}],
                })
            update_job(
                job_id,
                "completed",
                reply,
                job_logs,
                ti,
                to,
                team_trace=active_jobs.get(job_id, {}).get("team"),
                source="chat",
                result_surface=surface,
            )
            if session_id:
                try:
                    turn_count = len([h for h in history if h.get("role") == "user"]) + 1
                    compress_chat_session(
                        session_id,
                        user_message=msg_snap,
                        assistant_message=surface,
                        turn_count=turn_count,
                    )
                except Exception:
                    logger.exception("compress_chat_session (assistant)")
            try:
                from services.director_platform import emit_director_notification

                emit_director_notification(
                    kind="chat_result",
                    title="Réponse Assistant prête",
                    body=(surface or "").replace("\n", " ").strip()[:180],
                    job_id=job_id,
                    action_url=(
                        f"/chat?session={session_id}&job={job_id}" if session_id else f"/chat?job={job_id}"
                    ),
                )
            except Exception:
                logger.exception("emit_director_notification (assistant)")
        except Exception as e:
            user_result = _user_visible_job_failure_markdown(e)
            surface_err = surface_chat_result(user_result)
            job_logs.append(f"[korymb] Erreur : {e}")
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
                job_logs,
                0,
                0,
                source="chat",
                result_surface=surface_err,
            )
        finally:
            active_jobs.pop(job_id, None)

    threading.Thread(target=execute, name=f"korymb-assistant-{job_id[:24]}", daemon=True).start()
    return {"status": "accepted", "job_id": job_id, "agent": "assistant", "mirror_ack": None}
