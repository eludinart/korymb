"""Tâches à faire, avec ou sans projet.

Une date d'exécution crée ou met à jour un créneau interne du calendrier.
Le projet « Tâches d'Eric » est converti une fois, puis retiré.
"""
from __future__ import annotations

import hashlib
import logging
import re
import secrets
import unicodedata
from datetime import datetime, timedelta
from typing import Any

from database import LONG_TEXT_CHARS, _is_mariadb, clip_long_text, get_conn
from services.director_platform import emit_director_notification
from workspace_db import ws_id

logger = logging.getLogger("korymb.work_tasks")

TASK_STATUSES = ("open", "done")
_DUE_HINT = re.compile(
    r"(?:échéance|echeance|le|mer\.?|mercredi|jeu\.?|jeudi|ven\.?|vendredi|"
    r"lun\.?|lundi|mar\.?|mardi|sam\.?|samedi|dim\.?|dimanche)\s+"
    r"(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2,4}))?",
    re.IGNORECASE,
)


def _now() -> str:
    return datetime.utcnow().isoformat()


def _new_id() -> str:
    return f"wtk-{secrets.token_hex(6)}"


def _ws() -> str:
    return ws_id()


def _pk() -> str:
    return "VARCHAR(191)" if _is_mariadb() else "TEXT"


def _column_names(conn, table: str) -> set[str]:
    if _is_mariadb():
        cur = conn.execute(f"SHOW COLUMNS FROM {table}")
        return {str(row["Field"]) for row in cur.fetchall()}
    cur = conn.execute(f"PRAGMA table_info({table})")
    return {str(row[1]) for row in cur.fetchall()}


def ensure_work_task_tables(conn) -> None:
    pk = _pk()
    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS biz_work_tasks (
            id                {pk} PRIMARY KEY,
            workspace_id      {pk} NOT NULL,
            project_id        {pk},
            title             TEXT NOT NULL,
            status            TEXT NOT NULL DEFAULT 'open',
            due_at            TEXT,
            priority          TEXT NOT NULL DEFAULT '',
            urgent            INTEGER NOT NULL DEFAULT 0,
            notes             TEXT NOT NULL DEFAULT '',
            calendar_event_id TEXT NOT NULL DEFAULT '',
            origin_key        TEXT NOT NULL DEFAULT '',
            assignee          TEXT NOT NULL DEFAULT '',
            created_at        TEXT NOT NULL,
            updated_at        TEXT NOT NULL
        )
    """)
    columns = _column_names(conn, "biz_work_tasks")
    if "urgent" not in columns:
        conn.execute("ALTER TABLE biz_work_tasks ADD COLUMN urgent INTEGER NOT NULL DEFAULT 0")
    if "assignee" not in columns:
        conn.execute("ALTER TABLE biz_work_tasks ADD COLUMN assignee TEXT NOT NULL DEFAULT ''")
    if "reply" not in columns:
        conn.execute("ALTER TABLE biz_work_tasks ADD COLUMN reply TEXT NOT NULL DEFAULT ''")
    if "reply_at" not in columns:
        conn.execute("ALTER TABLE biz_work_tasks ADD COLUMN reply_at TEXT NOT NULL DEFAULT ''")
    if "chat_conversation_id" not in columns:
        conn.execute("ALTER TABLE biz_work_tasks ADD COLUMN chat_conversation_id TEXT NOT NULL DEFAULT ''")


def normalize_due(value: str | None) -> str | None:
    """YYYY-MM-DD ou date-heure naïve. Vide efface la date."""
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
        datetime.fromisoformat(raw)
        return raw
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?", raw):
        datetime.fromisoformat(raw[:19])
        return raw[:19]
    raise ValueError("Date invalide — attendu AAAA-MM-JJ.")


def _slot(due: str) -> tuple[str, str]:
    raw = due.strip()
    if len(raw) == 10:
        return f"{raw}T09:00:00", f"{raw}T09:30:00"
    start = raw[:19]
    try:
        end = (datetime.fromisoformat(start) + timedelta(minutes=30)).strftime("%Y-%m-%dT%H:%M:%S")
    except ValueError:
        day = raw[:10]
        return f"{day}T09:00:00", f"{day}T09:30:00"
    return start, end


def _assignee(value: str | None) -> str:
    return str(value or "").strip()[:120]


def _notify_assigned(row: dict, previous: str = "") -> None:
    name = str(row.get("assignee") or "").strip()
    if not name or name == previous.strip():
        return
    try:
        emit_director_notification(
            kind="task_assigned",
            title=f"Tâche assignée à {name[:80]}",
            body=str(row.get("title") or "")[:300],
            action_url="/gestion/taches",
        )
    except Exception:
        logger.warning("notification d'assignation non envoyée pour %s", row.get("id"), exc_info=True)


def _public(row: dict) -> dict:
    out = dict(row)
    out["urgent"] = bool(int(out.get("urgent") or 0))
    out["assignee"] = str(out.get("assignee") or "")
    return out


def _row(task_id: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM biz_work_tasks WHERE id=? AND workspace_id=?",
            (task_id, _ws()),
        ).fetchone()
    return _public(dict(row)) if row else None


def get_work_task(task_id: str) -> dict | None:
    return _row(task_id)


def list_work_tasks(*, status: str | None = None, limit: int = 200) -> list[dict]:
    sql = "SELECT * FROM biz_work_tasks WHERE workspace_id=?"
    params: list[Any] = [_ws()]
    if status:
        sql += " AND status=?"
        params.append(status)
    sql += (
        " ORDER BY CASE WHEN status='done' THEN 1 ELSE 0 END,"
        " CASE WHEN urgent=1 THEN 0 ELSE 1 END,"
        " CASE WHEN due_at IS NULL OR due_at='' THEN 1 ELSE 0 END,"
        " due_at ASC, priority ASC, created_at ASC"
        " LIMIT ?"
    )
    params.append(max(1, min(limit, 500)))
    with get_conn() as conn:
        rows = conn.execute(sql, tuple(params)).fetchall()
    return [_public(dict(r)) for r in rows]


def _find_origin(origin_key: str) -> dict | None:
    key = (origin_key or "").strip()
    if not key:
        return None
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM biz_work_tasks WHERE workspace_id=? AND origin_key=? LIMIT 1",
            (_ws(), key),
        ).fetchone()
    return dict(row) if row else None


def _mirror_google(event: dict | None) -> None:
    """Pousse l'heure ou l'annulation si le créneau est déjà lié à Google."""
    if not event:
        return
    gid = str(event.get("google_event_id") or "").strip()
    if not gid:
        return
    try:
        from services.calendar_sync import GoogleCalendarClient, _save_link, is_enabled
    except Exception:
        return
    if not is_enabled():
        return
    status = "cancelled" if str(event.get("status") or "") == "cancelled" else "confirmed"
    start = str(event.get("starts_at") or "")
    end = str(event.get("ends_at") or "") or start
    try:
        updated = GoogleCalendarClient().patch_event(gid, {
            "summary": str(event.get("title") or "Tâche")[:300],
            "status": status,
            "start": {"dateTime": start},
            "end": {"dateTime": end},
        })
    except Exception:
        logger.warning("tâche: calendrier Google non mis à jour pour %s", event.get("id"), exc_info=True)
        return
    ws = str(event.get("workspace_id") or _ws())
    with get_conn() as conn:
        _save_link(conn, ws, str(event["id"]), gid, str(updated.get("updated") or ""), start, end)
        conn.commit()


def _sync_calendar(task: dict) -> str:
    from services.business_db import create_calendar_event, get_calendar_event, update_calendar_event

    existing_id = str(task.get("calendar_event_id") or "").strip()
    dated_open = str(task.get("status") or "") == "open" and bool(str(task.get("due_at") or "").strip())
    if not dated_open:
        if existing_id:
            update_calendar_event(existing_id, status="cancelled")
            _mirror_google(get_calendar_event(existing_id))
        return existing_id
    start, end = _slot(str(task["due_at"]))
    title = str(task.get("title") or "Tâche").strip()[:300]
    project_id = task.get("project_id") or None
    if existing_id and get_calendar_event(existing_id):
        update_calendar_event(
            existing_id,
            title=title,
            starts_at=start,
            ends_at=end,
            status="planned",
            project_id=project_id,
            event_type="tache",
            notes="Tâche à faire.",
        )
        _mirror_google(get_calendar_event(existing_id))
        return existing_id
    created = create_calendar_event(
        title=title,
        starts_at=start,
        ends_at=end,
        project_id=project_id,
        event_type="tache",
        status="planned",
        notes="Tâche à faire.",
        visibility="internal",
        is_public=False,
    )
    return str(created.get("id") or "")


def _store_event_id(task_id: str, event_id: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE biz_work_tasks SET calendar_event_id=?, updated_at=? WHERE id=? AND workspace_id=?",
            (event_id or "", _now(), task_id, _ws()),
        )
        conn.commit()


def create_work_task(
    *,
    title: str,
    due_at: str | None = None,
    project_id: str | None = None,
    status: str = "open",
    priority: str = "",
    urgent: bool = False,
    notes: str = "",
    origin_key: str = "",
    assignee: str = "",
) -> dict:
    from services.business_db import get_project

    label = (title or "").strip()
    if not label:
        raise ValueError("Le titre est obligatoire.")
    if status not in TASK_STATUSES:
        raise ValueError("Statut invalide.")
    due = normalize_due(due_at)
    pid = (project_id or "").strip() or None
    if pid and not get_project(pid):
        raise ValueError("Projet introuvable.")
    existing = _find_origin(origin_key)
    if existing:
        return _public(existing)
    task_id = _new_id()
    now = _now()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO biz_work_tasks "
            "(id, workspace_id, project_id, title, status, due_at, priority, urgent, notes, "
            "calendar_event_id, origin_key, assignee, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                task_id, _ws(), pid, label[:800], status, due,
                (priority or "").strip()[:8], 1 if urgent else 0, clip_long_text(notes),
                "", (origin_key or "").strip()[:80], _assignee(assignee), now, now,
            ),
        )
        conn.commit()
    row = _row(task_id)
    event_id = _sync_calendar(row or {})
    if event_id:
        _store_event_id(task_id, event_id)
        row = _row(task_id)
    if row:
        _notify_assigned(row)
    return row or {}


def update_work_task(task_id: str, **fields: Any) -> dict | None:
    from services.business_db import get_project

    current = _row(task_id)
    if not current:
        return None
    assignee_before = str(current.get("assignee") or "")
    allowed = {
        "title", "status", "due_at", "project_id", "priority", "urgent", "notes", "assignee",
        "reply", "chat_conversation_id",
    }
    sets = ["updated_at=?"]
    vals: list[Any] = [_now()]
    for key, val in fields.items():
        if key not in allowed:
            continue
        if key == "title":
            label = str(val or "").strip()
            if not label:
                raise ValueError("Le titre est obligatoire.")
            sets.append("title=?")
            vals.append(label[:800])
        elif key == "status":
            if val not in TASK_STATUSES:
                raise ValueError("Statut invalide.")
            sets.append("status=?")
            vals.append(val)
        elif key == "due_at":
            sets.append("due_at=?")
            vals.append(normalize_due(None if val is None else str(val)))
        elif key == "project_id":
            pid = str(val or "").strip() or None
            if pid and not get_project(pid):
                raise ValueError("Projet introuvable.")
            sets.append("project_id=?")
            vals.append(pid)
        elif key == "priority":
            sets.append("priority=?")
            vals.append(str(val or "").strip()[:8])
        elif key == "urgent":
            sets.append("urgent=?")
            vals.append(1 if bool(val) else 0)
        elif key == "notes":
            sets.append("notes=?")
            vals.append(clip_long_text(val))
        elif key == "assignee":
            sets.append("assignee=?")
            vals.append(_assignee(None if val is None else str(val)))
        elif key == "reply":
            text = str(val or "").strip()[:4000]
            sets.append("reply=?")
            vals.append(text)
            sets.append("reply_at=?")
            vals.append(_now() if text else "")
        elif key == "chat_conversation_id":
            sets.append("chat_conversation_id=?")
            vals.append(str(val or "").strip()[:64])
    if len(sets) > 1:
        vals.extend([task_id, _ws()])
        with get_conn() as conn:
            conn.execute(
                f"UPDATE biz_work_tasks SET {', '.join(sets)} WHERE id=? AND workspace_id=?",
                tuple(vals),
            )
            conn.commit()
    row = _row(task_id)
    if not row:
        return None
    event_id = _sync_calendar(row)
    if event_id != str(row.get("calendar_event_id") or ""):
        _store_event_id(task_id, event_id)
        row = _row(task_id)
    if row and "assignee" in fields:
        _notify_assigned(row, assignee_before)
    return row


def delete_work_task(task_id: str) -> bool:
    row = _row(task_id)
    if not row:
        return False
    row = dict(row)
    row["status"] = "done"
    row["due_at"] = None
    _sync_calendar(row)
    with get_conn() as conn:
        cur = conn.execute(
            "DELETE FROM biz_work_tasks WHERE id=? AND workspace_id=?",
            (task_id, _ws()),
        )
        conn.commit()
    return bool(getattr(cur, "rowcount", 0))


def _fold(text: str) -> str:
    raw = unicodedata.normalize("NFKD", text or "")
    ascii_text = "".join(ch for ch in raw if not unicodedata.combining(ch))
    return re.sub(r"\s+", " ", ascii_text).strip().lower()


def _is_eric_task_bucket(title: str) -> bool:
    folded = _fold(title).replace("'", " ").replace("'", " ")
    return "tache" in folded and "eric" in folded


def _year_of(*texts: str) -> int:
    for text in texts:
        match = re.search(r"20\d{2}", text or "")
        if match:
            return int(match.group(0))
    return datetime.utcnow().year


def _extract_due(line: str, year: int) -> str | None:
    match = _DUE_HINT.search(line or "")
    if not match:
        return None
    day, month = int(match.group(1)), int(match.group(2))
    raw_year = match.group(3)
    if raw_year:
        parsed = int(raw_year)
        year = parsed + 2000 if parsed < 100 else parsed
    try:
        datetime(year, month, day)
    except ValueError:
        return None
    return f"{year:04d}-{month:02d}-{day:02d}"


def parse_checkbox_line(line: str) -> dict | None:
    match = re.match(r"^\[([ xX])\]\s*(.*)$", (line or "").strip())
    if not match:
        return None
    rest = match.group(2).strip()
    priority = ""
    prio = re.match(r"^(P\d+)\s*[·•.\-]\s*(.*)$", rest, re.IGNORECASE)
    if prio:
        priority = prio.group(1).upper()
        rest = prio.group(2).strip()
    state = ""
    title = rest
    for sep in (" — ", " – ", " - ", "—", "–"):
        if sep in rest:
            state, title = rest.split(sep, 1)
            state = state.strip()
            title = title.strip()
            break
    title = re.sub(r"\s+", " ", title).strip()
    if len(title) < 2:
        return None
    state_folded = _fold(state)
    done = match.group(1).lower() == "x" or state_folded.startswith("fait") or state_folded.startswith("livre")
    return {"title": title[:800], "done": done, "priority": priority, "notes": state[:LONG_TEXT_CHARS]}


def parse_task_blob(text: str, *, year: int | None = None) -> list[dict]:
    """Découpe une description « [ ] P1 · À faire — … » en tâches."""
    used_year = year or _year_of(text)
    chunks = re.split(r"(?=\[(?: |x|X)\])", text or "")
    items: list[dict] = []
    for chunk in chunks:
        line = ""
        for candidate in chunk.splitlines():
            if candidate.strip():
                line = candidate.strip()
                break
        parsed = parse_checkbox_line(line)
        if not parsed:
            continue
        parsed["due_at"] = None if parsed["done"] else _extract_due(line, used_year)
        items.append(parsed)
    return items


def _origin_for(project_id: str, title: str) -> str:
    digest = hashlib.sha1(f"{project_id}|{_fold(title)}".encode()).hexdigest()[:16]
    return f"eric:{digest}"


def _detach_project(project_id: str) -> None:
    from services.business_db import delete_project

    ws = _ws()
    with get_conn() as conn:
        for table in (
            "biz_calendar_events",
            "biz_quotes",
            "biz_interactions",
            "biz_external_invoices",
            "biz_work_tasks",
        ):
            conn.execute(
                f"UPDATE {table} SET project_id=NULL WHERE project_id=? AND workspace_id=?",
                (project_id, ws),
            )
        conn.commit()
    delete_project(project_id)


def import_eric_task_buckets() -> dict[str, int]:
    """Convertit chaque projet « Tâches d'Eric » en tâches, puis le supprime.

    Sans lignes reconnues, le projet reste en place.
    """
    from tenant_context import get_workspace_id, set_tenant_context

    summary = {"projects": 0, "tasks": 0, "skipped": 0}
    try:
        with get_conn() as conn:
            rows = conn.execute(
                "SELECT id, workspace_id, title, description FROM biz_projects"
            ).fetchall()
    except Exception:
        logger.exception("lecture des projets pour l'import des tâches")
        return summary
    previous = get_workspace_id()
    try:
        for row in rows:
            item = dict(row)
            title = str(item.get("title") or "")
            if not _is_eric_task_bucket(title):
                continue
            project_id = str(item.get("id") or "")
            workspace_id = str(item.get("workspace_id") or "")
            description = str(item.get("description") or "")
            parsed = parse_task_blob(description, year=_year_of(title, description))
            if not parsed:
                summary["skipped"] += 1
                logger.warning("projet %s conservé : aucune tâche reconnue", project_id)
                continue
            set_tenant_context(workspace_id=workspace_id)
            for task in parsed:
                create_work_task(
                    title=task["title"],
                    status="done" if task["done"] else "open",
                    due_at=task.get("due_at"),
                    priority=task.get("priority") or "",
                    notes=task.get("notes") or "",
                    origin_key=_origin_for(project_id, task["title"]),
                )
                summary["tasks"] += 1
            _detach_project(project_id)
            summary["projects"] += 1
    except Exception:
        logger.exception("import des tâches d'Eric interrompu")
    finally:
        if previous:
            set_tenant_context(workspace_id=previous)
        else:
            from tenant_context import clear_tenant_context

            clear_tenant_context()
    if summary["projects"]:
        logger.info(
            "tâches hors projet : %s projet(s), %s tâche(s)",
            summary["projects"],
            summary["tasks"],
        )
    return summary
