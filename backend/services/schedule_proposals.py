"""Propositions d'agenda (time blocking assisté) — jamais d'écriture sans acceptation.

Classe des candidats (tâches clarifiées / importantes sans due_at, jalons ouverts)
avec des créneaux libres dérivés du calendrier existant. L'acceptation pose
``due_at`` via ``update_work_task`` (sync calendrier existante).
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any

logger = logging.getLogger("korymb.schedule_proposals")

# Créneaux candidats (début) pour trouver un trou dans la journée.
_CANDIDATE_HOURS = (9, 10, 11, 14, 15, 16)
_SLOT_MINUTES = 30
_LOOKAHEAD_DAYS = 5


def _parse_dt(raw: str | None) -> datetime | None:
    text = str(raw or "").strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00").replace("+00:00", ""))
    except ValueError:
        return None


def _busy_intervals(events: list[dict], day: datetime) -> list[tuple[datetime, datetime]]:
    day0 = day.replace(hour=0, minute=0, second=0, microsecond=0)
    day1 = day0 + timedelta(days=1)
    out: list[tuple[datetime, datetime]] = []
    for row in events:
        status = str(row.get("status") or "").strip().lower()
        if status in {"cancelled", "canceled"}:
            continue
        start = _parse_dt(str(row.get("starts_at") or ""))
        if not start or start < day0 or start >= day1:
            continue
        end = _parse_dt(str(row.get("ends_at") or "")) or (start + timedelta(minutes=_SLOT_MINUTES))
        if end <= start:
            end = start + timedelta(minutes=_SLOT_MINUTES)
        out.append((start, end))
    out.sort(key=lambda pair: pair[0])
    return out


def _overlaps(start: datetime, end: datetime, busy: list[tuple[datetime, datetime]]) -> bool:
    for b0, b1 in busy:
        if start < b1 and end > b0:
            return True
    return False


def find_free_slots(
    events: list[dict],
    *,
    from_day: datetime | None = None,
    days: int = _LOOKAHEAD_DAYS,
    limit: int = 12,
) -> list[dict[str, Any]]:
    """Créneaux libres naïfs (30 min) sur les prochains jours ouvrés-ish."""
    base = (from_day or datetime.utcnow()).replace(hour=0, minute=0, second=0, microsecond=0)
    slots: list[dict[str, Any]] = []
    for offset in range(max(1, days)):
        day = base + timedelta(days=offset)
        # Sauter le week-end (samedi=5, dimanche=6) pour le coaching.
        if day.weekday() >= 5:
            continue
        busy = _busy_intervals(events, day)
        for hour in _CANDIDATE_HOURS:
            start = day.replace(hour=hour, minute=0, second=0, microsecond=0)
            end = start + timedelta(minutes=_SLOT_MINUTES)
            if _overlaps(start, end, busy):
                continue
            slots.append({
                "starts_at": start.strftime("%Y-%m-%dT%H:%M:%S"),
                "ends_at": end.strftime("%Y-%m-%dT%H:%M:%S"),
                "due_at": start.strftime("%Y-%m-%dT%H:%M:%S"),
                "label": "",
            })
            if len(slots) >= limit:
                return _localize_slot_labels(slots)
    return _localize_slot_labels(slots)


_WEEKDAY_FR = ("lun", "mar", "mer", "jeu", "ven", "sam", "dim")


def _localize_slot_labels(slots: list[dict[str, Any]]) -> list[dict[str, Any]]:
    for slot in slots:
        start = _parse_dt(str(slot.get("starts_at") or ""))
        if not start:
            continue
        slot["label"] = f"{_WEEKDAY_FR[start.weekday()]} {start.strftime('%d/%m %H:%M')}"
    return slots


def _task_rank(task: dict) -> tuple[int, int, str]:
    """Plus petit = plus prioritaire."""
    urgent = 0 if task.get("urgent") else 1
    important = 0 if task.get("important") else 1
    # clarifiée (a un projet) avant orpheline si on élargit plus tard
    clarified = 0 if str(task.get("project_id") or "").strip() else 1
    return (urgent + important, clarified, str(task.get("updated_at") or task.get("created_at") or ""))


def rank_schedule_candidates(
    *,
    tasks: list[dict] | None = None,
    milestones_open: list[dict] | None = None,
    events: list[dict] | None = None,
    limit: int = 8,
) -> list[dict[str, Any]]:
    """Construit des propositions sans écrire le calendrier.

    Candidats = tâches open clarifiées (project_id) ou importantes, sans ``due_at``.
    Chaque proposition cite un créneau libre et une cible (projet / jalon).
    """
    from services.work_tasks import list_work_tasks

    if tasks is None:
        tasks = list_work_tasks(status="open", limit=200)
    if events is None:
        try:
            from services.business_db import list_calendar_events

            now = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
            events = list_calendar_events(
                from_at=now.isoformat(),
                to_at=(now + timedelta(days=_LOOKAHEAD_DAYS + 1)).isoformat(),
                limit=200,
            )
        except Exception:
            events = []

    free = find_free_slots(events or [], limit=max(limit, 8))
    if not free:
        return []

    candidates: list[dict] = []
    for task in tasks or []:
        if not isinstance(task, dict):
            continue
        if str(task.get("status") or "") != "open":
            continue
        if str(task.get("due_at") or "").strip():
            continue
        has_project = bool(str(task.get("project_id") or "").strip())
        important = bool(task.get("important"))
        urgent = bool(task.get("urgent"))
        # clarifiée (triage) ou marquée importante/urgente
        if not (has_project or important or urgent):
            continue
        candidates.append(task)

    candidates.sort(key=_task_rank)

    # Index jalons ouverts par projet pour contextualiser
    milestone_by_project: dict[str, dict] = {}
    for row in milestones_open or []:
        if not isinstance(row, dict):
            continue
        pid = str(row.get("project_id") or "").strip()
        if pid and pid not in milestone_by_project:
            milestone_by_project[pid] = row

    proposals: list[dict[str, Any]] = []
    for index, task in enumerate(candidates[:limit]):
        slot = free[index % len(free)]
        pid = str(task.get("project_id") or "").strip()
        milestone = milestone_by_project.get(pid) if pid else None
        target = ""
        if milestone:
            target = str(milestone.get("title") or milestone.get("label") or "")[:120]
        project_title = ""
        if pid:
            try:
                from services.business_db import get_project

                project = get_project(pid)
                if project:
                    project_title = str(project.get("title") or "")[:120]
            except Exception:
                project_title = ""
        reason_bits: list[str] = []
        if task.get("urgent") and task.get("important"):
            reason_bits.append("urgent et important")
        elif task.get("urgent"):
            reason_bits.append("urgent")
        elif task.get("important"):
            reason_bits.append("important")
        if pid:
            reason_bits.append("liée à un projet")
        proposals.append({
            "id": f"sched-{task.get('id')}-{slot.get('due_at', '')[:10]}",
            "task_id": task.get("id"),
            "title": str(task.get("title") or "Tâche")[:200],
            "project_id": pid or None,
            "project_title": project_title,
            "milestone_title": target,
            "suggested_due_at": slot["due_at"],
            "slot_label": slot.get("label") or "",
            "reason": ", ".join(reason_bits) or "à placer",
            "href": "/gestion/taches",
        })
    return proposals


def list_schedule_proposals(*, limit: int = 8) -> dict[str, Any]:
    """Payload briefing / API — propositions seules, zéro écriture."""
    milestones_open: list[dict] = []
    try:
        from services.director_platform import build_project_milestones

        block = build_project_milestones()
        milestones_open = list(block.get("open") or [])
    except Exception:
        milestones_open = []
    proposals = rank_schedule_candidates(milestones_open=milestones_open, limit=limit)
    return {
        "proposals": proposals,
        "count": len(proposals),
        "auto_slot_note": (
            "Accepter pose une date (et un créneau calendrier). "
            "Sans validation, rien n'est écrit. "
            "Une date sans heure utilise 09:00–09:30 automatiquement — pas un bloc volontaire."
        ),
    }


def accept_schedule_proposal(*, task_id: str, due_at: str) -> dict[str, Any]:
    """Écrit ``due_at`` seulement après acceptation explicite."""
    from services.work_tasks import get_work_task, update_work_task

    tid = (task_id or "").strip()
    if not tid:
        raise ValueError("task_id obligatoire.")
    when = (due_at or "").strip()
    if not when:
        raise ValueError("due_at obligatoire.")
    current = get_work_task(tid)
    if not current:
        raise ValueError("Tâche introuvable.")
    if str(current.get("status") or "") != "open":
        raise ValueError("Seules les tâches ouvertes peuvent être placées.")
    updated = update_work_task(tid, due_at=when)
    if not updated:
        raise ValueError("Impossible de mettre à jour la tâche.")
    return updated
