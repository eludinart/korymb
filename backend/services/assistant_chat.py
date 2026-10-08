"""Exécution chat Assistant (atelier — sans orchestration multi-agents)."""
from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime

from agent_tool_use import llm_chat_maybe_tools
from database import get_chat_session_summary, save_job, update_job
from services.agent_groups import ASSISTANT_SYSTEM
from services.agents import FLEUR_CONTEXT
from services.chat_surface import surface_chat_result
from services.chat_topic_guard import is_guard_fallback, user_asks_product_ops
from services.memory import compress_chat_session
from services.mission import _add_daily as _add_daily_svc
from services.llm_degraded import degraded_chat_reply, llm_outage_kind, llm_outage_reason
from services.mission import _user_visible_job_failure_markdown
from state import active_jobs
from tenant_context import spawn_thread

logger = logging.getLogger(__name__)


def messages_for_assistant(history: list[dict] | None, message: str) -> list[dict]:
    """Historique modèle sans les refus anti-dérive, qui sinon se recopient."""
    messages: list[dict] = []
    for item in (history or [])[-12:]:
        role = item.get("role")
        if role not in ("user", "assistant"):
            continue
        content = str(item.get("content") or "")
        if is_guard_fallback(content):
            continue
        messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": message})
    return messages


_PRECISION = (
    "\n### Précision\n"
    "Réponds d'abord, de façon concrète. "
    "N'invente pas de contact, chiffre, fichier, écran ou URL. "
    "Si un fait n'est pas dans le contexte ou un outil de ce tour, dis-le. "
    "Tu es généraliste : le métier, la prospection et la technique sont des sujets valides. "
    "Si le travail exige une flotte d'agents, propose-la et attends la confirmation "
    "(bouton **Créer l'équipe**). Ne lance pas l'orchestration toi-même.\n"
)


def product_ops_prompt_addon(user_text: str) -> str:
    """Ancre une question produit sur l'état plateforme, sans interdire le métier."""
    if not user_asks_product_ops(user_text):
        return ""
    lock = (
        "\n### Sujet de ce tour\n"
        "Le dirigeant demande des priorités sur Korymb. "
        "Donne-les, ordonnées et actionnables, sans questionnaire. "
        "Appuie-toi sur l'état plateforme ci-dessous et ne le contredis pas. "
        "Tu peux mentionner le métier si c'est utile, sans inventer de fiche ni de tableau.\n"
    )
    try:
        from services.chat_intelligence import product_snapshot_state_text

        snap = (product_snapshot_state_text(max_chars=1200) or "").strip()
    except Exception:
        snap = ""
    if snap:
        lock += "\n" + snap + "\n"
    return lock


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
                surface = surface_chat_result(text, user_text=msg_snap)
                _add_daily_svc(0, 0)
                if job_id in active_jobs:
                    active_jobs[job_id].update({"status": "completed", "result": text, "result_surface": surface})
                update_job(job_id, "completed", text, job_logs, 0, 0, source="chat", result_surface=surface)
                return

            from services.chat_intelligence import (
                CHAT_LEAD_SHAPE,
                user_forces_direct_answer,
                user_wants_choice_questionnaire,
            )
            from services.choice_questionnaire import QCM_INSTRUCTION, QCM_INSTRUCTION_DEFAULT

            qcm_block = (
                QCM_INSTRUCTION
                if user_wants_choice_questionnaire(msg_snap) and not user_forces_direct_answer(msg_snap)
                else QCM_INSTRUCTION_DEFAULT
            )
            force = (
                "\nLe dirigeant exige une **conclusion opérationnelle** maintenant "
                "(pas de nouveau questionnaire).\n"
                if user_forces_direct_answer(msg_snap)
                else ""
            )
            system_prompt = (
                ASSISTANT_SYSTEM
                + str(FLEUR_CONTEXT)
                + "\nSois conversationnel et utile. "
                "Ne propose une équipe que si c'est clairement demandé ou nécessaire. "
                "Pour « qui es-tu ? » : courte présentation d'Assistant Korymb (chatbot), sans te dire CIO.\n"
                + _PRECISION
                + qcm_block
                + force
                + product_ops_prompt_addon(msg_snap)
                + CHAT_LEAD_SHAPE
            )
            if session_id:
                summary = (get_chat_session_summary(session_id) or "").strip()
                if summary:
                    system_prompt += f"\n### Mémoire de la conversation\n{summary[:2500]}\n"
            messages = messages_for_assistant(history, msg_snap)
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
            keep_q = user_wants_choice_questionnaire(msg_snap) and not user_forces_direct_answer(msg_snap)
            surface = surface_chat_result(
                reply, keep_questionnaire=keep_q, user_text=msg_snap
            )
            if is_guard_fallback(surface):
                job_logs.append(
                    "[korymb] Ancien refus de filtre recopié — nouvel essai pour répondre vraiment."
                )
                reply2, ti2, to2 = llm_chat_maybe_tools(
                    system_prompt
                    + "\nLa phrase « je me suis écarté du sujet » est une erreur d'un ancien filtre. "
                    "Ne la répète pas. Réponds à la demande, en puces concrètes, sans inventer de faits.\n",
                    [{"role": "user", "content": msg_snap}],
                    [],
                    job_logs=job_logs,
                    max_tokens=3072,
                    usage_context="chat_sync:assistant",
                    usage_job_id=job_id,
                )
                ti += int(ti2 or 0)
                to += int(to2 or 0)
                surface2 = surface_chat_result(
                    reply2, keep_questionnaire=keep_q, user_text=msg_snap
                )
                if surface2.strip() and not is_guard_fallback(surface2):
                    reply, surface = reply2, surface2
            pending_bp = _extract_blueprint_id(reply, "\n".join(str(x) for x in job_logs[-50:]))
            if pending_bp:
                surface = (
                    f"{surface}\n\n---\n"
                    f"**Équipe proposée** (`{pending_bp}`) — valide avec le bouton "
                    f"**Créer l'équipe** sous ce message."
                )
            from services.claim_guard import seal_chat_texts

            reply, surface, _claims = seal_chat_texts(
                reply,
                surface,
                user_text=msg_snap,
                history=history,
                job_logs=job_logs,
                job_id=job_id,
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
                events=active_jobs.get(job_id, {}).get("events"),
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
            outage = llm_outage_kind(e)
            if outage:
                user_result = degraded_chat_reply(
                    msg_snap,
                    agent_label="Assistant",
                    reason=llm_outage_reason(e),
                )
                surface_err = surface_chat_result(user_result, user_text=msg_snap)
                job_status = "completed"
                job_logs.append(f"[korymb] Mode dégradé ({outage}) : {e}")
                logger.warning("chat assistant mode dégradé (%s) : %s", outage, e)
            else:
                user_result = _user_visible_job_failure_markdown(e)
                surface_err = surface_chat_result(user_result, user_text=msg_snap)
                job_status = f"error: {e}"
                job_logs.append(f"[korymb] Erreur : {e}")
            if job_id in active_jobs:
                active_jobs[job_id].update({
                    "status": job_status,
                    "result": user_result,
                    "result_surface": surface_err,
                    "degraded": bool(outage),
                })
            update_job(
                job_id,
                job_status,
                user_result,
                job_logs,
                0,
                0,
                source="chat",
                result_surface=surface_err,
            )
            if outage:
                try:
                    from services.director_platform import emit_director_notification

                    emit_director_notification(
                        kind="chat_result",
                        title="Réponse en mode dégradé",
                        body=(surface_err or "").replace("\n", " ").strip()[:180],
                        job_id=job_id,
                        action_url=(
                            f"/chat?session={session_id}&job={job_id}" if session_id else f"/chat?job={job_id}"
                        ),
                    )
                except Exception:
                    logger.exception("emit_director_notification (assistant degraded)")
        finally:
            active_jobs.pop(job_id, None)

    spawn_thread(execute, name=f"korymb-assistant-{job_id[:24]}")
    return {"status": "accepted", "job_id": job_id, "agent": "assistant", "mirror_ack": None}
