"""Exécution chat Assistant (atelier — sans orchestration multi-agents)."""
from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime
from typing import Any, Iterator

from agent_tool_use import llm_chat_maybe_tools
from database import get_chat_session_summary, save_job, update_job
from services.agent_groups import ASSISTANT_SYSTEM
from services.agents import FLEUR_CONTEXT
from services.chat_surface import surface_chat_result
from services.chat_topic_guard import is_guard_fallback, user_asks_product_ops
from services.memory import compress_chat_session
from services.mission import _add_daily as _add_daily_svc
from services.llm_degraded import DEGRADED_MARKER, degraded_chat_reply, llm_outage_kind, llm_outage_reason
from services.mission import _user_visible_job_failure_markdown
from state import active_jobs
from tenant_context import spawn_thread

logger = logging.getLogger(__name__)

CHAT_USE_MODE_QUOTIDIEN = "quotidien"
CHAT_USE_MODE_OPERATIONNEL = "operationnel"


def normalize_chat_use_mode(raw: Any) -> str:
    return (
        CHAT_USE_MODE_OPERATIONNEL
        if str(raw or "").strip().lower() == CHAT_USE_MODE_OPERATIONNEL
        else CHAT_USE_MODE_QUOTIDIEN
    )


def history_limit_for_mode(chat_use_mode: Any) -> int:
    return 24 if normalize_chat_use_mode(chat_use_mode) == CHAT_USE_MODE_QUOTIDIEN else 12


def _is_degraded_replay(content: str) -> bool:
    """Le mode dégradé recopié fait croire au modèle que le service est encore coupé."""
    text = content or ""
    if DEGRADED_MARKER in text or "Mode dégradé" in text:
        return True
    folded = text.lower()
    if "modèle est indisponible" in folded or "modele est indisponible" in folded:
        return True
    service_down = "service n'est pas disponible" in folded or "service n’est pas disponible" in folded
    asks_retry = "modèle sera" in folded or "modele sera" in folded or "conversation est enregistrée" in folded
    return service_down and asks_retry


def messages_for_assistant(
    history: list[dict] | None,
    message: str,
    *,
    limit: int | None = None,
) -> list[dict]:
    """Historique modèle sans les refus anti-dérive ni le mode dégradé, qui sinon se recopient."""
    hist_limit = 12 if limit is None else max(1, int(limit))
    messages: list[dict] = []
    for item in (history or [])[-hist_limit:]:
        role = item.get("role")
        if role not in ("user", "assistant"):
            continue
        content = str(item.get("content") or "")
        if is_guard_fallback(content) or _is_degraded_replay(content):
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
    "Si le travail exige une flotte d'agents, propose-la avec l'outil d'équipe. "
    "N'invente pas le bouton « Créer l'équipe » : il n'existe que si un blueprint a été créé. "
    "Ne lance pas l'orchestration toi-même.\n"
)

_QUOTIDIEN_SHAPE = (
    "\n### Forme de la réponse\n"
    "Réponds naturellement, comme un assistant quotidien. "
    "Sois clair, utile et conversationnel. "
    "N'impose pas le format « décision / prochain pas / ce qui manque » "
    "sauf si l'utilisateur le demande.\n"
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


def build_assistant_system_prompt(
    message: str,
    *,
    chat_use_mode: Any = CHAT_USE_MODE_OPERATIONNEL,
    session_id: str | None = None,
    tools_enabled: bool = True,
) -> str:
    from services.chat_intelligence import (
        CHAT_LEAD_SHAPE,
        user_forces_direct_answer,
        user_wants_choice_questionnaire,
    )
    from services.choice_questionnaire import QCM_INSTRUCTION, QCM_INSTRUCTION_DEFAULT

    mode = normalize_chat_use_mode(chat_use_mode)
    qcm_block = (
        QCM_INSTRUCTION
        if user_wants_choice_questionnaire(message) and not user_forces_direct_answer(message)
        else QCM_INSTRUCTION_DEFAULT
    )
    force = (
        "\nLe dirigeant exige une **conclusion opérationnelle** maintenant "
        "(pas de nouveau questionnaire).\n"
        if user_forces_direct_answer(message)
        else ""
    )
    shape = CHAT_LEAD_SHAPE if mode == CHAT_USE_MODE_OPERATIONNEL else _QUOTIDIEN_SHAPE
    tone = (
        "\nSois conversationnel et utile. "
        "Ne propose une équipe que si c'est clairement demandé ou nécessaire. "
        "Pour « qui es-tu ? » : courte présentation d'Assistant Korymb (chatbot), sans te dire CIO.\n"
    )
    if mode == CHAT_USE_MODE_QUOTIDIEN:
        tone = (
            "\nTu es l'assistant quotidien de Korymb (remplacement Gemini). "
            "Réponds vite et naturellement. "
            "Ne propose une équipe / flotte que si l'utilisateur le demande clairement. "
            "Pour « qui es-tu ? » : courte présentation d'Assistant Korymb, sans te dire CIO.\n"
        )
    system_prompt = (
        ASSISTANT_SYSTEM
        + str(FLEUR_CONTEXT)
        + tone
        + _PRECISION
        + qcm_block
        + force
        + product_ops_prompt_addon(message)
        + shape
    )
    sid = (session_id or "").strip()[:64]
    if sid:
        summary = (get_chat_session_summary(sid) or "").strip()
        if summary:
            system_prompt += f"\n### Mémoire de la conversation\n{summary[:2500]}\n"
    if not tools_enabled:
        system_prompt += (
            "\n### Équipe (ce tour)\n"
            "Tu n'as pas l'outil de création d'équipe. "
            "Tu peux esquisser une idée, puis demander d'écrire « crée l'équipe » "
            "pour la proposer vraiment. "
            "Interdit : bouton « Créer l'équipe », blueprint_id, ou JSON d'appel d'outil.\n"
        )
    return system_prompt


def _extract_blueprint_id(*texts: str) -> str | None:
    for t in texts:
        m = re.search(r"bp-[a-f0-9]{12}", t or "")
        if m:
            return m.group(0)
    return None


def resolve_pending_blueprint_id(*texts: str, direct: str | None = None) -> str | None:
    """Id encore « proposed », ou l'id déjà posé sur le job."""
    direct_id = (direct or "").strip()
    if re.fullmatch(r"bp-[a-f0-9]{12}", direct_id):
        return direct_id
    found: list[str] = []
    for t in texts:
        for match in re.findall(r"bp-[a-f0-9]{12}", t or ""):
            if match not in found:
                found.append(match)
    if not found:
        return None
    try:
        from services.agent_groups import get_blueprint
    except Exception:
        return None
    for bid in reversed(found):
        try:
            bp = get_blueprint(bid)
        except Exception:
            bp = None
        if bp and str(bp.get("status") or "") == "proposed":
            return bid
    return None


def _memory_directive_reply(message: str) -> str | None:
    from services.memory_directives import apply_user_memory_directive

    directive = apply_user_memory_directive(message)
    if not directive:
        return None
    action = directive.get("action")
    key = directive.get("key", "global")
    pending = "Proposition envoyée dans **Décisions** (pas encore écrite)."
    if action == "remember":
        return (
            f"**À mémoriser** dans `{key}` (en attente de validation) :\n\n"
            f"{directive.get('detail', '')}\n\n{pending}"
        )
    if action == "forget_all":
        return f"**À effacer** — volet `{key}` (en attente de validation). {pending}"
    return f"**À retirer** dans `{key}` : {directive.get('detail', '')}\n\n{pending}"


def _maybe_seal(
    reply: str,
    surface: str,
    *,
    message: str,
    history: list[dict] | None,
    chat_use_mode: Any,
    job_logs: list[str] | None,
    job_id: str | None,
) -> tuple[str, str, dict | None]:
    mode = normalize_chat_use_mode(chat_use_mode)
    if mode == CHAT_USE_MODE_QUOTIDIEN and not user_asks_product_ops(message):
        return reply, surface, None
    from services.claim_guard import seal_chat_texts

    reply2, surface2, claims = seal_chat_texts(
        reply,
        surface,
        user_text=message,
        history=history,
        job_logs=job_logs,
        job_id=job_id,
    )
    payload = claims.payload() if hasattr(claims, "payload") else None
    return reply2, surface2, payload


def run_assistant_turn(
    *,
    message: str,
    history: list[dict] | None,
    chat_use_mode: Any = CHAT_USE_MODE_OPERATIONNEL,
    chat_session_id: str | None = None,
    use_tools: bool = True,
    or_profile: str = "lite",
    max_tokens: int = 3072,
    job_id: str | None = None,
    job_logs: list[str] | None = None,
) -> dict[str, Any]:
    """Tour Assistant partagé (sync, stream final, ou job)."""
    mode = normalize_chat_use_mode(chat_use_mode)
    logs = job_logs if job_logs is not None else []
    session_id = (chat_session_id or "").strip()[:64] or ""

    directive_text = _memory_directive_reply(message)
    if directive_text:
        surface = surface_chat_result(directive_text, user_text=message)
        return {
            "reply": directive_text,
            "surface": surface,
            "tokens_in": 0,
            "tokens_out": 0,
            "pending_blueprint_id": None,
            "claim_guard": None,
            "degraded": False,
            "keep_questionnaire": False,
        }

    from services.chat_intelligence import user_forces_direct_answer, user_wants_choice_questionnaire

    system_prompt = build_assistant_system_prompt(
        message,
        chat_use_mode=mode,
        session_id=session_id or None,
        tools_enabled=use_tools,
    )
    messages = messages_for_assistant(
        history, message, limit=history_limit_for_mode(mode)
    )
    tool_tags = ["web", "drive", "teams", "workspace"] if use_tools else []
    keep_q = user_wants_choice_questionnaire(message) and not user_forces_direct_answer(message)

    if use_tools:
        reply, ti, to = llm_chat_maybe_tools(
            system_prompt,
            messages,
            tool_tags,
            job_logs=logs,
            max_tokens=max_tokens,
            usage_context="chat_sync:assistant",
            usage_job_id=job_id,
            or_profile=or_profile,
        )
    else:
        from llm_client import llm_chat

        reply, ti, to = llm_chat(
            system_prompt,
            messages,
            max_tokens=max_tokens,
            or_profile=or_profile,
            usage_context="chat_sync:assistant",
            usage_job_id=job_id,
        )

    surface = surface_chat_result(reply, keep_questionnaire=keep_q, user_text=message)
    if is_guard_fallback(surface):
        logs.append("[korymb] Ancien refus de filtre recopié — nouvel essai pour répondre vraiment.")
        retry_prompt = (
            system_prompt
            + "\nLa phrase « je me suis écarté du sujet » est une erreur d'un ancien filtre. "
            "Ne la répète pas. Réponds à la demande, en puces concrètes, sans inventer de faits.\n"
        )
        if use_tools:
            reply2, ti2, to2 = llm_chat_maybe_tools(
                retry_prompt,
                [{"role": "user", "content": message}],
                [],
                job_logs=logs,
                max_tokens=max_tokens,
                usage_context="chat_sync:assistant",
                usage_job_id=job_id,
                or_profile=or_profile,
            )
        else:
            from llm_client import llm_chat

            reply2, ti2, to2 = llm_chat(
                retry_prompt,
                [{"role": "user", "content": message}],
                max_tokens=max_tokens,
                or_profile=or_profile,
                usage_context="chat_sync:assistant",
                usage_job_id=job_id,
            )
        ti += int(ti2 or 0)
        to += int(to2 or 0)
        surface2 = surface_chat_result(reply2, keep_questionnaire=keep_q, user_text=message)
        if surface2.strip() and not is_guard_fallback(surface2):
            reply, surface = reply2, surface2

    from services.chat_intelligence import strip_unbacked_team_button

    pending_bp = resolve_pending_blueprint_id(
        reply, "\n".join(str(x) for x in logs[-50:])
    )
    if pending_bp:
        surface = (
            f"{surface}\n\n---\n"
            f"**Équipe proposée** (`{pending_bp}`) — valide avec le bouton "
            f"**Créer l'équipe** sous ce message."
        )
    else:
        surface = strip_unbacked_team_button(surface)

    reply, surface, claim_payload = _maybe_seal(
        reply,
        surface,
        message=message,
        history=history,
        chat_use_mode=mode,
        job_logs=logs,
        job_id=job_id,
    )
    return {
        "reply": reply,
        "surface": surface,
        "tokens_in": int(ti or 0),
        "tokens_out": int(to or 0),
        "pending_blueprint_id": pending_bp,
        "claim_guard": claim_payload,
        "degraded": False,
        "keep_questionnaire": keep_q,
    }


def run_assistant_chat_sync(
    *,
    message: str,
    history: list[dict] | None,
    chat_use_mode: Any = CHAT_USE_MODE_QUOTIDIEN,
    chat_session_id: str | None = None,
    use_tools: bool = False,
) -> dict[str, Any]:
    """Réponse synchrone complète (mode quotidien, tours courts)."""
    mode = normalize_chat_use_mode(chat_use_mode)
    try:
        turn = run_assistant_turn(
            message=message,
            history=history,
            chat_use_mode=mode,
            chat_session_id=chat_session_id,
            use_tools=use_tools,
            or_profile="lite",
            max_tokens=2048 if mode == CHAT_USE_MODE_QUOTIDIEN else 3072,
        )
        _add_daily_svc(turn["tokens_in"], turn["tokens_out"])
        session_id = (chat_session_id or "").strip()[:64]
        if session_id:
            try:
                turn_count = len([h for h in (history or []) if h.get("role") == "user"]) + 1
                compress_chat_session(
                    session_id,
                    user_message=message,
                    assistant_message=turn["surface"],
                    turn_count=turn_count,
                )
            except Exception:
                logger.exception("compress_chat_session (assistant sync)")
        out: dict[str, Any] = {
            "status": "completed",
            "response": turn["surface"],
            "agent": "assistant",
            "pending_blueprint_id": turn.get("pending_blueprint_id"),
        }
        if turn.get("claim_guard"):
            out["claim_guard"] = turn["claim_guard"]
        return out
    except Exception as e:
        outage = llm_outage_kind(e)
        if outage:
            user_result = degraded_chat_reply(
                message, agent_label="Assistant", reason=llm_outage_reason(e)
            )
            surface = surface_chat_result(user_result, user_text=message)
            return {
                "status": "completed",
                "response": surface,
                "agent": "assistant",
                "degraded": True,
                "degraded_reason": llm_outage_reason(e),
            }
        raise


def _sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def iter_assistant_chat_stream(
    *,
    message: str,
    history: list[dict] | None,
    chat_use_mode: Any = CHAT_USE_MODE_QUOTIDIEN,
    chat_session_id: str | None = None,
) -> Iterator[str]:
    """SSE : deltas puis done (sans outils)."""
    mode = normalize_chat_use_mode(chat_use_mode)
    session_id = (chat_session_id or "").strip()[:64] or ""
    try:
        directive_text = _memory_directive_reply(message)
        if directive_text:
            surface = surface_chat_result(directive_text, user_text=message)
            yield _sse("delta", {"text": surface})
            yield _sse("done", {"status": "completed", "response": surface, "agent": "assistant"})
            return

        system_prompt = build_assistant_system_prompt(
            message,
            chat_use_mode=mode,
            session_id=session_id or None,
            tools_enabled=False,
        )
        messages = messages_for_assistant(
            history, message, limit=history_limit_for_mode(mode)
        )
        from llm_client import llm_chat_stream_deltas

        full_parts: list[str] = []
        ti = to = 0
        for kind, payload in llm_chat_stream_deltas(
            system_prompt,
            messages,
            max_tokens=2048,
            or_profile="lite",
            usage_context="chat_stream:assistant",
        ):
            if kind == "delta":
                chunk = str(payload or "")
                if not chunk:
                    continue
                full_parts.append(chunk)
                yield _sse("delta", {"text": chunk})
            elif kind == "usage":
                ti = int((payload or {}).get("tokens_in") or 0)
                to = int((payload or {}).get("tokens_out") or 0)

        raw = "".join(full_parts)
        from services.chat_intelligence import user_forces_direct_answer, user_wants_choice_questionnaire

        keep_q = user_wants_choice_questionnaire(message) and not user_forces_direct_answer(message)
        surface = surface_chat_result(raw, keep_questionnaire=keep_q, user_text=message)
        from services.chat_intelligence import strip_unbacked_team_button

        surface = strip_unbacked_team_button(surface)
        reply, surface, claim_payload = _maybe_seal(
            raw,
            surface,
            message=message,
            history=history,
            chat_use_mode=mode,
            job_logs=None,
            job_id=None,
        )
        _add_daily_svc(ti, to)
        if session_id:
            try:
                turn_count = len([h for h in (history or []) if h.get("role") == "user"]) + 1
                compress_chat_session(
                    session_id,
                    user_message=message,
                    assistant_message=surface,
                    turn_count=turn_count,
                )
            except Exception:
                logger.exception("compress_chat_session (assistant stream)")
        done: dict[str, Any] = {
            "status": "completed",
            "response": surface,
            "agent": "assistant",
            "result": reply,
        }
        if claim_payload:
            done["claim_guard"] = claim_payload
        yield _sse("done", done)
    except Exception as e:
        outage = llm_outage_kind(e)
        if outage:
            user_result = degraded_chat_reply(
                message, agent_label="Assistant", reason=llm_outage_reason(e)
            )
            surface = surface_chat_result(user_result, user_text=message)
            yield _sse(
                "done",
                {
                    "status": "completed",
                    "response": surface,
                    "agent": "assistant",
                    "degraded": True,
                    "degraded_reason": llm_outage_reason(e),
                },
            )
            return
        yield _sse("error", {"detail": str(e)[:500]})


def start_assistant_chat_job(
    *,
    message: str,
    history: list[dict],
    linked_job_id: str | None,
    chat_session_id: str | None,
    chat_use_mode: Any = CHAT_USE_MODE_OPERATIONNEL,
) -> dict:
    job_id = str(uuid.uuid4())[:8]
    now_iso = datetime.utcnow().isoformat()
    linked_parent_id = (linked_job_id or "").strip()[:16]
    session_id = (chat_session_id or "").strip()[:64] or ""
    msg_snap = message
    mode = normalize_chat_use_mode(chat_use_mode)
    hist_snap = list(history or [])

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
        "chat_use_mode": mode,
    }

    def execute() -> None:
        try:
            turn = run_assistant_turn(
                message=msg_snap,
                history=hist_snap,
                chat_use_mode=mode,
                chat_session_id=session_id or None,
                use_tools=True,
                or_profile="lite" if mode == CHAT_USE_MODE_QUOTIDIEN else "standard",
                max_tokens=3072,
                job_id=job_id,
                job_logs=job_logs,
            )
            reply = turn["reply"]
            surface = turn["surface"]
            ti = turn["tokens_in"]
            to = turn["tokens_out"]
            pending_bp = turn.get("pending_blueprint_id")
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
                if turn.get("claim_guard"):
                    active_jobs[job_id]["claim_guard"] = turn["claim_guard"]
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
                    turn_count = len([h for h in hist_snap if h.get("role") == "user"]) + 1
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
