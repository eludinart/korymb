"""Pont agent_bus → tâches quotidiennes Corimb + notifications.

Grokbot / Cursor échangent via le bus ; Corimb matérialise les plans to=cursor
en tâches. Aucun code app n'est écrit ici — texte et suivi uniquement.
"""
from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

ORIGIN_PREFIX = "agent-bus:"


def origin_key_for(message_id: str) -> str:
    return f"{ORIGIN_PREFIX}{(message_id or '').strip()}"[:80]


def _title_from_message(msg: dict[str, Any]) -> str:
    topic = str(msg.get("topic") or "").strip()
    body = str(msg.get("body") or "").strip()
    first = body.splitlines()[0].strip() if body else ""
    if topic and first:
        return f"{topic}: {first}"[:800]
    return (topic or first or "Plan bus")[:800]


def sync_task_on_bus_create(msg: dict[str, Any]) -> dict[str, Any] | None:
    """Crée une tâche open quand un plan arrive pour Cursor."""
    if str(msg.get("to") or "").lower() != "cursor":
        return None
    mid = str(msg.get("id") or "").strip()
    if not mid:
        return None
    try:
        from services.work_tasks import create_work_task
        from services.director_platform import emit_director_notification

        task = create_work_task(
            title=_title_from_message(msg),
            notes=str(msg.get("body") or ""),
            origin_key=origin_key_for(mid),
            urgent=True,
            important=True,
            assignee="cursor",
        )
        emit_director_notification(
            kind="bus_plan",
            title="Plan reçu pour Cursor",
            body=f"{msg.get('topic')}: {str(msg.get('body') or '')[:240]}",
            action_url="/gestion/taches",
        )
        return task
    except Exception:
        logger.exception("agent_bus_bridge: sync create échoué pour %s", mid)
        return None


def append_progress(message_id: str, note: str) -> dict[str, Any]:
    """Avancement Cursor en parallèle — enrichit la tâche liée."""
    from datetime import datetime

    from services.director_platform import emit_director_notification
    from services.work_tasks import get_work_task_by_origin, update_work_task

    text = (note or "").strip()
    if not text:
        raise ValueError("note requise")
    mid = (message_id or "").strip()
    task = get_work_task_by_origin(origin_key_for(mid))
    if not task:
        raise KeyError(mid)
    prev = str(task.get("notes") or "").rstrip()
    stamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    block = f"{prev}\n\n--- avancement {stamp} ---\n{text}".strip()
    updated = update_work_task(str(task["id"]), notes=block)
    emit_director_notification(
        kind="bus_progress",
        title="Avancement Cursor",
        body=text[:400],
        action_url="/gestion/taches",
    )
    return {"task": updated, "message_id": mid}


def sync_task_on_bus_done(msg: dict[str, Any]) -> dict[str, Any] | None:
    """Clôture la tâche liée + notifie le résultat (done.comment)."""
    mid = str(msg.get("id") or "").strip()
    if not mid:
        return None
    try:
        from services.director_platform import emit_director_notification
        from services.work_tasks import get_work_task_by_origin, update_work_task

        task = get_work_task_by_origin(origin_key_for(mid))
        if not task:
            return None
        comment = str(msg.get("comment") or "").strip()
        prev = str(task.get("notes") or "").rstrip()
        notes = f"{prev}\n\n--- done ---\n{comment}".strip() if comment else prev
        updated = update_work_task(str(task["id"]), status="done", notes=notes)
        emit_director_notification(
            kind="bus_done",
            title="Plan Cursor terminé",
            body=(comment or str(msg.get("topic") or ""))[:400],
            action_url="/gestion/taches",
        )
        return updated
    except Exception:
        logger.exception("agent_bus_bridge: sync done échoué pour %s", mid)
        return None
