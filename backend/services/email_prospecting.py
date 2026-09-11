"""
Prospection e-mail : fils CRM, envois HITL, sync réponses Gmail, annulation relances.
"""
from __future__ import annotations

import html
import json
import logging
import re
import secrets
from datetime import datetime
from typing import Any

from database import get_conn
from services.business_db import (
    _now,
    _new_id,
    _ws,
    get_contact,
    is_crm_follow_up_title,
    list_calendar_events,
    log_interaction,
    update_calendar_event,
)
from services.email_files import parse_attachments, serialize_attachments

logger = logging.getLogger(__name__)

THREAD_STATUSES = frozenset({"open", "replied", "closed"})
EMAIL_DIRECTIONS = frozenset({"outbound", "inbound"})


def _workspace_brand_label() -> str:
    from services.workspace_brand import workspace_sender_name

    return workspace_sender_name("Korymb")


def _mail_mid_domain() -> str:
    from services.workspace_brand import mail_message_id_domain

    return mail_message_id_domain()


_GMAIL_SEND_RE = re.compile(
    r"id:\s*([^\s,)]+)(?:.*?thread:\s*([^\s,)]+))?",
    re.IGNORECASE | re.DOTALL,
)
_FR_DAY = r"(?:lun|mar|mer|jeu|ven|sam|dim)"
_QUOTE_HEAD = re.compile(
    rf"(?is)(?:^|\n)\s*(Le\s+{_FR_DAY}\.?\s+\d{{1,2}}\s+\S+\.?\s+\d{{4}}\s+à\s+\d{{1,2}}:\d{{2}}\b)"
)
_QUOTE_HEAD_SNIPPET = re.compile(
    r"(?i)\s+(Le\s+\S{2,12}\.?\s+\d{1,2}\s+\S+\.?\s+\d{4}\s+[àa]\s+\d{1,2}:\d{2}\b)"
)
_QUOTE_WROTE_FR = re.compile(r"(?i)\ba écrit\s*:")
_QUOTE_ON_WROTE = re.compile(r"(?im)^On\s+.+wrote:\s*$")
_QUOTE_ORIG = re.compile(r"(?im)^-{2,}\s*Original Message\s*-{2,}\s*$")


def isolate_email_reply(text: str) -> tuple[str, str]:
    """Sépare le nouveau texte d'une réponse du mail cité (Gmail FR/EN)."""
    raw = html.unescape((text or "").replace("\r\n", "\n").replace("\r", "\n"))
    raw = html.unescape(raw).strip()
    if not raw:
        return "", ""
    if "\n" not in raw:
        hit = _QUOTE_HEAD_SNIPPET.search(raw)
        if hit:
            return raw[: hit.start()].strip(), raw[hit.start() :].strip()
        wrote = _QUOTE_WROTE_FR.search(raw)
        le_at = re.search(r"(?i)\sLe\s+", raw)
        if wrote and le_at and le_at.start() > 0 and le_at.start() < wrote.start():
            return raw[: le_at.start()].strip(), raw[le_at.start() :].strip()
        return raw, ""
    for pattern in (_QUOTE_HEAD, _QUOTE_ON_WROTE, _QUOTE_ORIG):
        m = pattern.search(raw)
        if m:
            start = m.start(1) if pattern is _QUOTE_HEAD and m.lastindex else m.start()
            reply = raw[:start].strip()
            quoted = raw[start:].strip()
            return (reply or raw, quoted if reply else "")
    lines = raw.split("\n")
    cut = next((i for i, line in enumerate(lines) if line.startswith(">")), -1)
    if cut > 0:
        return "\n".join(lines[:cut]).strip(), "\n".join(lines[cut:]).strip()
    return raw, ""


def clean_outgoing_body(text: str) -> str:
    """Nouveau texte seulement — jamais les messages cités (Gmail / '>')."""
    raw = html.unescape((text or "").replace("\r\n", "\n").replace("\r", "\n")).strip()
    if not raw:
        return ""
    reply, _quoted = isolate_email_reply(raw)
    cleaned = (reply or raw).strip()
    kept: list[str] = []
    for line in cleaned.split("\n"):
        if line.startswith(">"):
            continue
        if re.match(r"(?i)^\s*-{2,}\s*Original Message\s*-{2,}", line):
            break
        kept.append(line)
    cleaned = "\n".join(kept).strip()
    head = _QUOTE_HEAD.search(cleaned)
    if head:
        cleaned = cleaned[: head.start()].strip()
    snippet = _QUOTE_HEAD_SNIPPET.search(" " + cleaned)
    if snippet and snippet.start() > 1:
        cleaned = cleaned[: snippet.start() - 1].strip()
    wrote = _QUOTE_WROTE_FR.search(cleaned)
    if wrote and wrote.start() > 8:
        le_at = re.search(r"(?i)(?:^|\n)\s*Le\s+", cleaned)
        cut = le_at.start() if le_at and 0 < le_at.start() < wrote.start() else wrote.start()
        cleaned = cleaned[:cut].strip()
    return re.sub(r"\n{3,}", "\n\n", cleaned).strip()


def parse_send_provider_ids(result_text: str) -> dict[str, str]:
    """Extrait gmail_message_id / gmail_thread_id du texte outil d'envoi."""
    text = result_text or ""
    out: dict[str, str] = {"gmail_message_id": "", "gmail_thread_id": ""}
    m = _GMAIL_SEND_RE.search(text)
    if m:
        out["gmail_message_id"] = (m.group(1) or "").strip()
        if m.group(2):
            out["gmail_thread_id"] = (m.group(2) or "").strip()
    return out


def _hydrate_thread(row: dict | None) -> dict | None:
    if not row:
        return None
    return dict(row)


def _hydrate_message(row: dict | None) -> dict | None:
    if not row:
        return None
    d = dict(row)
    body = html.unescape(str(d.get("body") or ""))
    reply, quoted = isolate_email_reply(body)
    d["body"] = body
    d["reply_text"] = reply or body
    d["quoted_text"] = quoted
    d["attachments"] = parse_attachments(d.get("attachments_json") or d.get("attachments"))
    d.pop("attachments_json", None)
    return d


def get_email_thread(thread_id: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM biz_email_threads WHERE id=? AND workspace_id=?",
            (thread_id, _ws()),
        ).fetchone()
    return _hydrate_thread(dict(row) if row else None)


def get_email_message(message_id: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM biz_email_messages WHERE id=? AND workspace_id=?",
            (message_id, _ws()),
        ).fetchone()
    return _hydrate_message(dict(row) if row else None)


def list_email_threads(
    *,
    contact_id: str | None = None,
    status: str | None = None,
    limit: int = 50,
) -> list[dict]:
    clauses = ["workspace_id=?"]
    params: list[Any] = [_ws()]
    if contact_id:
        clauses.append("contact_id=?")
        params.append(contact_id)
    if status:
        clauses.append("status=?")
        params.append(status)
    params.append(max(1, min(200, int(limit or 50))))
    sql = (
        f"SELECT * FROM biz_email_threads WHERE {' AND '.join(clauses)} "
        "ORDER BY COALESCE(NULLIF(last_message_at,''), updated_at) DESC LIMIT ?"
    )
    with get_conn() as conn:
        rows = conn.execute(sql, tuple(params)).fetchall()
    return [_hydrate_thread(dict(r)) for r in rows]  # type: ignore[misc]


def list_email_messages(thread_id: str, *, limit: int = 100) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM biz_email_messages WHERE thread_id=? AND workspace_id=? "
            "ORDER BY created_at ASC LIMIT ?",
            (thread_id, _ws(), max(1, min(500, int(limit or 100)))),
        ).fetchall()
    return [_hydrate_message(dict(r)) for r in rows]  # type: ignore[misc]


def list_contact_email_threads(contact_id: str, *, limit: int = 30) -> list[dict]:
    """Fils d'un contact avec messages inclus."""
    threads = list_email_threads(contact_id=contact_id, limit=limit)
    out: list[dict] = []
    for t in threads:
        item = dict(t)
        item["messages"] = list_email_messages(str(t.get("id") or ""), limit=100)
        out.append(item)
    return out


def _mailbox_bucket(thread: dict, messages: list[dict]) -> str:
    if str(thread.get("status") or "") == "closed":
        return "closed"
    last = messages[-1] if messages else None
    if last and str(last.get("direction") or "") == "inbound":
        return "needs_reply"
    return "awaiting"


def _preview_from_message(msg: dict | None) -> str:
    if not msg:
        return ""
    body = str(msg.get("reply_text") or msg.get("body") or "")
    reply, _ = isolate_email_reply(body)
    text = re.sub(r"\s+", " ", (reply or body).strip())
    return text[:220]


def _contact_card(contact_id: str | None) -> dict | None:
    cid = str(contact_id or "").strip()
    if not cid:
        return None
    row = get_contact(cid)
    if not row:
        return {"id": cid, "name": "", "email": ""}
    return {
        "id": str(row.get("id") or cid),
        "name": str(row.get("name") or ""),
        "email": str(row.get("email") or ""),
    }


def list_pending_email_drafts(*, limit: int = 40) -> list[dict]:
    """Brouillons HITL e-mail encore en attente de validation inbox."""
    try:
        from services.action_queue import list_actions
    except Exception:
        return []
    tickets = list_actions(status="pending", limit=max(1, min(200, int(limit or 40) * 3)))
    out: list[dict] = []
    for ticket in tickets:
        if str(ticket.get("kind") or "") != "email":
            continue
        payload = ticket.get("payload") if isinstance(ticket.get("payload"), dict) else {}
        cid = str(payload.get("contact_id") or "").strip()
        atts = payload.get("attachments") if isinstance(payload.get("attachments"), list) else []
        out.append(
            {
                "id": ticket.get("id"),
                "title": ticket.get("title") or "",
                "subject": str(payload.get("subject") or ""),
                "to": str(payload.get("to") or ""),
                "contact_id": cid,
                "contact": _contact_card(cid) if cid else None,
                "created_at": ticket.get("created_at") or "",
                "attachment_count": len(atts),
            }
        )
        if len(out) >= max(1, min(80, int(limit or 40))):
            break
    return out


def _mailbox_sync_meta() -> dict[str, Any]:
    try:
        from database import list_scheduled_tasks

        for task in list_scheduled_tasks():
            if str(task.get("task_type") or "") == "gmail_prospect_sync":
                return {
                    "last_run_at": task.get("last_run_at") or "",
                    "enabled": bool(task.get("enabled")),
                    "interval_minutes": int((task.get("schedule_config") or {}).get("minutes") or 0),
                }
    except Exception:
        logger.debug("mailbox sync meta unavailable", exc_info=True)
    return {"last_run_at": "", "enabled": False, "interval_minutes": 0}


def list_mailbox(*, bucket: str = "all", limit: int = 80) -> dict[str, Any]:
    """Vue courrier : tous les fils CRM + brouillons HITL, sans passer par une fiche."""
    wanted = (bucket or "all").strip().lower()
    if wanted not in {"all", "needs_reply", "awaiting", "closed"}:
        wanted = "all"
    raw = list_email_threads(limit=max(1, min(200, int(limit or 80))))
    items: list[dict] = []
    counts = {"needs_reply": 0, "awaiting": 0, "closed": 0, "all": 0}
    for thread in raw:
        msgs = list_email_messages(str(thread.get("id") or ""), limit=100)
        bkt = _mailbox_bucket(thread, msgs)
        counts["all"] += 1
        counts[bkt] = int(counts.get(bkt) or 0) + 1
        if wanted != "all" and bkt != wanted:
            continue
        last = msgs[-1] if msgs else None
        item = dict(thread)
        item["bucket"] = bkt
        item["contact"] = _contact_card(str(thread.get("contact_id") or "") or None)
        item["last_direction"] = str((last or {}).get("direction") or "")
        item["preview"] = _preview_from_message(last)
        item["message_count"] = len(msgs)
        item["has_attachments"] = any(bool(m.get("attachments")) for m in msgs)
        items.append(item)
    drafts = list_pending_email_drafts(limit=40)
    return {
        "threads": items,
        "drafts": drafts,
        "counts": {**counts, "drafts": len(drafts)},
        "sync": _mailbox_sync_meta(),
    }


def workspace_ids_with_email_threads() -> list[str]:
    with get_conn() as conn:
        rows = conn.execute("SELECT DISTINCT workspace_id FROM biz_email_threads").fetchall()
    out: list[str] = []
    for row in rows or []:
        wid = str(dict(row).get("workspace_id") or "").strip()
        if wid:
            out.append(wid)
    return out


def _thread_owned_by_contact(thread: dict | None, contact_id: str) -> bool:
    if not thread:
        return False
    return str(thread.get("contact_id") or "") == (contact_id or "").strip()


def _refresh_thread_after_messages_changed(thread_id: str) -> dict | None:
    """Recalcule statut / dernier message, ou supprime le fil s'il est vide."""
    msgs = list_email_messages(thread_id, limit=500)
    if not msgs:
        with get_conn() as conn:
            conn.execute(
                "DELETE FROM biz_email_threads WHERE id=? AND workspace_id=?",
                (thread_id, _ws()),
            )
            conn.commit()
        return None
    last_at = str(msgs[-1].get("created_at") or "") or _now()
    status = "replied" if any(m.get("direction") == "inbound" for m in msgs) else "open"
    return update_email_thread(thread_id, last_message_at=last_at, status=status)


def delete_email_message_for_contact(contact_id: str, message_id: str) -> dict[str, Any]:
    """Retire un e-mail envoyé du suivi CRM (Gmail n'est pas modifié)."""
    cid = (contact_id or "").strip()
    mid = (message_id or "").strip()
    if not cid or not mid:
        return {"success": False, "error": "Identifiants manquants.", "status_code": 400}
    msg = get_email_message(mid)
    if not msg:
        return {"success": False, "error": "Message introuvable.", "status_code": 404}
    thread = get_email_thread(str(msg.get("thread_id") or ""))
    if not _thread_owned_by_contact(thread, cid):
        return {"success": False, "error": "Message introuvable.", "status_code": 404}
    if str(msg.get("direction") or "") != "outbound":
        return {
            "success": False,
            "error": "Seuls les e-mails envoyés se retirent un par un. Pour une réponse reçue, retirez le fil.",
            "status_code": 422,
        }
    with get_conn() as conn:
        conn.execute(
            "DELETE FROM biz_email_messages WHERE id=? AND workspace_id=?",
            (mid, _ws()),
        )
        conn.commit()
    remaining = _refresh_thread_after_messages_changed(str(thread["id"]))
    return {
        "success": True,
        "deleted": "message",
        "message_id": mid,
        "thread": remaining,
        "thread_deleted": remaining is None,
        "threads": list_contact_email_threads(cid, limit=30),
    }


def delete_email_thread_for_contact(contact_id: str, thread_id: str) -> dict[str, Any]:
    """Retire un fil (envois + réponses) du suivi CRM. Gmail n'est pas modifié."""
    cid = (contact_id or "").strip()
    tid = (thread_id or "").strip()
    if not cid or not tid:
        return {"success": False, "error": "Identifiants manquants.", "status_code": 400}
    thread = get_email_thread(tid)
    if not _thread_owned_by_contact(thread, cid):
        return {"success": False, "error": "Fil introuvable.", "status_code": 404}
    with get_conn() as conn:
        conn.execute(
            "DELETE FROM biz_email_messages WHERE thread_id=? AND workspace_id=?",
            (tid, _ws()),
        )
        conn.execute(
            "DELETE FROM biz_email_threads WHERE id=? AND workspace_id=?",
            (tid, _ws()),
        )
        conn.commit()
    return {
        "success": True,
        "deleted": "thread",
        "thread_id": tid,
        "threads": list_contact_email_threads(cid, limit=30),
    }


def find_thread_by_gmail_thread_id(gmail_thread_id: str) -> dict | None:
    gid = (gmail_thread_id or "").strip()
    if not gid:
        return None
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM biz_email_threads WHERE workspace_id=? AND gmail_thread_id=? "
            "ORDER BY updated_at DESC LIMIT 1",
            (_ws(), gid),
        ).fetchone()
    return _hydrate_thread(dict(row) if row else None)


def find_message_by_gmail_id(gmail_message_id: str) -> dict | None:
    mid = (gmail_message_id or "").strip()
    if not mid:
        return None
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM biz_email_messages WHERE workspace_id=? AND gmail_message_id=? LIMIT 1",
            (_ws(), mid),
        ).fetchone()
    return _hydrate_message(dict(row) if row else None)


def create_email_thread(
    *,
    contact_id: str | None,
    subject: str,
    to_email: str,
    gmail_thread_id: str = "",
    ticket_id: str = "",
    job_id: str = "",
) -> dict:
    tid = _new_id("eth")
    now = _now()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO biz_email_threads "
            "(id, workspace_id, contact_id, subject, to_email, status, gmail_thread_id, "
            "last_message_at, follow_up_event_id, ticket_id, job_id, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                tid,
                _ws(),
                contact_id or None,
                (subject or "").strip()[:500],
                (to_email or "").strip()[:320],
                "open",
                (gmail_thread_id or "").strip()[:191],
                now,
                "",
                (ticket_id or "").strip()[:64],
                (job_id or "").strip()[:64],
                now,
                now,
            ),
        )
        conn.commit()
    return get_email_thread(tid)  # type: ignore[return-value]


def update_email_thread(thread_id: str, **fields: Any) -> dict | None:
    allowed = {
        "subject",
        "to_email",
        "status",
        "gmail_thread_id",
        "last_message_at",
        "follow_up_event_id",
        "ticket_id",
        "job_id",
        "contact_id",
    }
    updates = {k: v for k, v in fields.items() if k in allowed}
    if not updates:
        return get_email_thread(thread_id)
    if "status" in updates and str(updates["status"]) not in THREAD_STATUSES:
        updates.pop("status")
    updates["updated_at"] = _now()
    cols = ", ".join(f"{k}=?" for k in updates)
    vals = list(updates.values()) + [thread_id, _ws()]
    with get_conn() as conn:
        conn.execute(
            f"UPDATE biz_email_threads SET {cols} WHERE id=? AND workspace_id=?",
            tuple(vals),
        )
        conn.commit()
    return get_email_thread(thread_id)


def append_email_message(
    *,
    thread_id: str,
    direction: str,
    subject: str = "",
    body: str = "",
    from_email: str = "",
    to_email: str = "",
    message_id_header: str = "",
    gmail_message_id: str = "",
    in_reply_to: str = "",
    ticket_id: str = "",
    created_at: str | None = None,
    attachments: list | None = None,
) -> dict | None:
    if not get_email_thread(thread_id):
        return None
    direction_clean = direction if direction in EMAIL_DIRECTIONS else "outbound"
    mid = _new_id("emsg")
    now = created_at or _now()
    att_json = serialize_attachments(attachments if isinstance(attachments, list) else [])
    with get_conn() as conn:
        from services.business_db import _ensure_biz_email_messages_columns

        _ensure_biz_email_messages_columns(conn)
        conn.execute(
            "INSERT INTO biz_email_messages "
            "(id, workspace_id, thread_id, direction, subject, body, from_email, to_email, "
            "message_id_header, gmail_message_id, in_reply_to, ticket_id, attachments_json, created_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                mid,
                _ws(),
                thread_id,
                direction_clean,
                (subject or "").strip()[:500],
                (body or "").strip()[:12000],
                (from_email or "").strip()[:320],
                (to_email or "").strip()[:320],
                (message_id_header or "").strip()[:500],
                (gmail_message_id or "").strip()[:191],
                (in_reply_to or "").strip()[:500],
                (ticket_id or "").strip()[:64],
                att_json,
                now,
            ),
        )
        conn.commit()
    update_email_thread(thread_id, last_message_at=now)
    return get_email_message(mid)


def update_email_message(message_id: str, **fields: Any) -> dict | None:
    allowed = {"subject", "body", "from_email", "to_email", "message_id_header", "in_reply_to", "attachments_json"}
    if "attachments" in fields:
        fields["attachments_json"] = serialize_attachments(
            fields.pop("attachments") if isinstance(fields.get("attachments"), list) else []
        )
    updates = {k: v for k, v in fields.items() if k in allowed}
    if "body" in updates:
        updates["body"] = str(updates["body"] or "").strip()[:12000]
    if not updates:
        return get_email_message(message_id)
    cols = ", ".join(f"{k}=?" for k in updates)
    vals = list(updates.values()) + [message_id, _ws()]
    with get_conn() as conn:
        conn.execute(
            f"UPDATE biz_email_messages SET {cols} WHERE id=? AND workspace_id=?",
            tuple(vals),
        )
        conn.commit()
    return get_email_message(message_id)


def record_outbound_email(
    *,
    contact_id: str | None,
    to_email: str,
    subject: str,
    body: str,
    ticket_id: str = "",
    job_id: str = "",
    gmail_message_id: str = "",
    gmail_thread_id: str = "",
    message_id_header: str = "",
    existing_thread_id: str | None = None,
    attachments: list | None = None,
) -> dict[str, Any]:
    """Après envoi réussi : crée/relie un fil + message outbound."""
    thread = None
    eth_id = (existing_thread_id or "").strip()
    if eth_id:
        thread = get_email_thread(eth_id)
    if not thread and gmail_thread_id:
        thread = find_thread_by_gmail_thread_id(gmail_thread_id)
    if not thread:
        thread = create_email_thread(
            contact_id=contact_id,
            subject=subject,
            to_email=to_email,
            gmail_thread_id=gmail_thread_id,
            ticket_id=ticket_id,
            job_id=job_id,
        )
    else:
        patch: dict[str, Any] = {"status": "open"}
        if gmail_thread_id and not str(thread.get("gmail_thread_id") or "").strip():
            patch["gmail_thread_id"] = gmail_thread_id
        if ticket_id:
            patch["ticket_id"] = ticket_id
        if job_id:
            patch["job_id"] = job_id
        if contact_id and not thread.get("contact_id"):
            patch["contact_id"] = contact_id
        thread = update_email_thread(str(thread["id"]), **patch) or thread

    msg = append_email_message(
        thread_id=str(thread["id"]),
        direction="outbound",
        subject=subject,
        body=body,
        from_email="",
        to_email=to_email,
        message_id_header=message_id_header
        or (
            f"<korymb-{secrets.token_hex(8)}@{_mail_mid_domain()}>"
            if not gmail_message_id
            else ""
        ),
        gmail_message_id=gmail_message_id,
        ticket_id=ticket_id,
        attachments=attachments if isinstance(attachments, list) else [],
    )
    return {"thread": thread, "message": msg}


def cancel_pending_email_follow_ups(
    contact_id: str,
    *,
    reason: str = "Réponse e-mail reçue",
) -> list[dict]:
    """Annule les créneaux Relance —… planned/confirmed pour ce contact."""
    cid = (contact_id or "").strip()
    if not cid:
        return []
    cancelled: list[dict] = []
    # Large fenêtre : relances passées / futures
    rows = list_calendar_events(from_at="1970-01-01T00:00:00", to_at="2099-12-31T23:59:59", limit=200)
    for ev in rows:
        if str(ev.get("contact_id") or "").strip() != cid:
            continue
        if str(ev.get("status") or "") not in ("planned", "confirmed"):
            continue
        if not is_crm_follow_up_title(str(ev.get("title") or "")):
            continue
        # Ne pas toucher aux suivis contenu (Mesurer / Relayer)
        title = str(ev.get("title") or "")
        if not title.lower().startswith("relance"):
            continue
        notes = str(ev.get("notes") or "")
        note_extra = f"\n[{_now()[:16]}] Annulé auto : {reason}"[:400]
        updated = update_calendar_event(
            str(ev["id"]),
            status="cancelled",
            notes=(notes + note_extra)[:2000],
        )
        if updated:
            cancelled.append(updated)
    return cancelled


def attach_follow_up_to_thread(thread_id: str, event_id: str) -> dict | None:
    return update_email_thread(thread_id, follow_up_event_id=(event_id or "").strip())


def record_inbound_reply(
    *,
    contact_id: str | None,
    thread: dict,
    subject: str,
    body: str,
    from_email: str,
    to_email: str = "",
    gmail_message_id: str = "",
    gmail_thread_id: str = "",
    message_id_header: str = "",
    in_reply_to: str = "",
    created_at: str | None = None,
    attachments: list | None = None,
) -> dict[str, Any]:
    """Enregistre une réponse entrante, marque le fil, annule relances, journalise."""
    tid = str(thread.get("id") or "")
    if gmail_thread_id and not str(thread.get("gmail_thread_id") or "").strip():
        update_email_thread(tid, gmail_thread_id=gmail_thread_id)
    msg = append_email_message(
        thread_id=tid,
        direction="inbound",
        subject=subject,
        body=body,
        from_email=from_email,
        to_email=to_email,
        message_id_header=message_id_header,
        gmail_message_id=gmail_message_id,
        in_reply_to=in_reply_to,
        created_at=created_at,
        attachments=attachments if isinstance(attachments, list) else [],
    )
    update_email_thread(tid, status="replied")
    cancelled: list[dict] = []
    cid = (contact_id or str(thread.get("contact_id") or "")).strip()
    if cid:
        cancelled = cancel_pending_email_follow_ups(cid, reason="Réponse e-mail reçue (sync Gmail)")
        try:
            log_interaction(
                contact_id=cid,
                interaction_type="email",
                summary=f"Réponse reçue — {subject or '(sans objet)'}"[:500],
                details=(body or "")[:4000],
                agent_key="gmail_sync",
            )
        except Exception:
            logger.warning("CRM log after inbound email failed", exc_info=True)
        try:
            _notify_inbound_email(
                contact_id=cid,
                thread_id=tid,
                subject=subject,
                body=body or "",
                from_email=from_email,
            )
        except Exception:
            logger.warning("Inbound email notification failed", exc_info=True)
    # Annuler aussi le follow_up lié au fil
    fu = str(thread.get("follow_up_event_id") or "").strip()
    if fu:
        try:
            update_calendar_event(fu, status="cancelled")
        except Exception:
            pass
    return {
        "thread": get_email_thread(tid),
        "message": msg,
        "cancelled_follow_ups": cancelled,
    }


def _notify_inbound_email(
    *,
    contact_id: str,
    thread_id: str,
    subject: str,
    body: str,
    from_email: str,
) -> None:
    """Alerte dirigeant (cloche + SSE) pour une réponse Gmail nouvellement importée."""
    try:
        from services.director_platform import emit_director_notification
    except Exception:
        return
    contact = get_contact(contact_id) if contact_id else None
    name = re.sub(
        r"^\s*\[TEST\]\s*",
        "",
        str((contact or {}).get("name") or from_email or "un contact"),
        flags=re.IGNORECASE,
    ).strip() or "un contact"
    reply, _ = isolate_email_reply(body or "")
    preview = re.sub(r"\s+", " ", (reply or body or "").strip())[:220]
    title = f"Réponse de {name}"
    if (subject or "").strip():
        title = f"{title} — {(subject or '').strip()[:80]}"
    try:
        emit_director_notification(
            kind="email_reply",
            title=title[:180],
            body=preview or "Nouveau message reçu.",
            action_url=f"/gestion/courrier?thread={thread_id}" if thread_id else "/gestion/courrier",
        )
    except Exception:
        logger.warning("Notification e-mail inbound failed", exc_info=True)


def prepare_contact_email_ticket(
    contact_id: str,
    *,
    subject: str = "",
    body: str = "",
    job_id: str = "",
    thread_id: str = "",
    in_reply_to: str = "",
    gmail_thread_id: str = "",
    attachment_ids: list[str] | None = None,
    send_now: bool = False,
) -> dict[str, Any]:
    """Prépare un ticket e-mail HITL, ou envoie immédiatement depuis le rédacteur (`send_now`)."""
    from services.action_queue import enqueue_action, resolve_action

    contact = get_contact(contact_id)
    if not contact:
        return {"success": False, "error": "Contact introuvable.", "status_code": 404}
    to = str(contact.get("email") or "").strip()
    if not to:
        return {
            "success": False,
            "error": "Aucun e-mail sur la fiche — ajoutez une adresse avant de préparer l'envoi.",
            "status_code": 422,
        }

    name = str(contact.get("name") or to).strip()
    name_clean = re.sub(r"^\s*\[TEST\]\s*", "", name, flags=re.IGNORECASE).strip() or name
    outreach = str(contact.get("outreach_suggestions") or "").strip()
    company = str(contact.get("company") or "").strip()
    tags = contact.get("tags") if isinstance(contact.get("tags"), list) else []
    tags_l = [str(t).strip().lower() for t in tags]
    coach_like = any(
        t in tags_l for t in ("coach", "thérapeute", "therapeute", "bien-être", "bien-etre")
    )
    brand = _workspace_brand_label()
    if (subject or "").strip():
        subj = subject.strip()
    elif coach_like or company:
        angle = company or name_clean or "votre pratique"
        subj = f"Proposition — enrichir {angle}"[:160]
    else:
        subj = f"{brand} — échange avec {name_clean}"[:160]
    if (body or "").strip():
        mail_body = body.strip()
    elif outreach and not send_now:
        mail_body = outreach[:3500]
    elif send_now:
        return {
            "success": False,
            "error": "Le message est vide — écrivez le texte avant d'envoyer.",
            "status_code": 422,
        }
    else:
        mail_body = (
            f"Bonjour {name_clean},\n\n"
            f"Je me permets de vous écrire au sujet de {brand}.\n\n"
            "Bien cordialement"
        )
    mail_body = clean_outgoing_body(mail_body) or mail_body
    if send_now and not mail_body.strip():
        return {
            "success": False,
            "error": "Le message est vide — écrivez le texte avant d'envoyer.",
            "status_code": 422,
        }

    existing = (thread_id or "").strip()
    if existing and not get_email_thread(existing):
        return {"success": False, "error": "Fil e-mail introuvable.", "status_code": 404}

    from services.email_files import MAX_FILES, payload_attachments_from_ids

    ids = [str(x or "").strip() for x in (attachment_ids or []) if str(x or "").strip()]
    if len(ids) > MAX_FILES:
        return {
            "success": False,
            "error": f"Trop de pièces jointes (max {MAX_FILES}).",
            "status_code": 422,
        }
    attachments = payload_attachments_from_ids(ids)
    if ids and len(attachments) != len(ids):
        return {
            "success": False,
            "error": "Une pièce jointe est introuvable ou a expiré. Réessayez l'ajout.",
            "status_code": 422,
        }
    att_summary = ""
    if attachments:
        names = ", ".join(str(a.get("filename") or "fichier") for a in attachments)
        att_summary = f"\nPièces jointes ({len(attachments)}) : {names}"

    ticket = enqueue_action(
        kind="email",
        title=f"E-mail — {name_clean}"[:120],
        summary=f"À : {to}\nObjet : {subj}{att_summary}\n\n{mail_body}"[:800],
        payload={
            "to": to,
            "subject": subj,
            "body": mail_body,
            "tool": "send_gmail",
            "contact_id": str(contact.get("id") or ""),
            "agent_key": "commercial",
            "thread_id": existing,
            "job_id": (job_id or "").strip(),
            "in_reply_to": (in_reply_to or "").strip(),
            "gmail_thread_id": (gmail_thread_id or "").strip(),
            "attachments": attachments,
        },
        job_id=(job_id or "").strip() or None,
        source="composer" if send_now else "contact_email",
        notify=not send_now,
    )
    contact_card = {
        "id": contact.get("id"),
        "name": contact.get("name"),
        "email": to,
    }
    if not send_now:
        return {
            "success": True,
            "ticket": ticket,
            "contact": contact_card,
            "chain": {
                "steps": [
                    "Brouillon e-mail préparé dans Décisions (validation avant envoi)",
                ],
            },
        }

    result = resolve_action(str(ticket.get("id") or ""), decision="approve", source="composer")
    if not result.get("success"):
        return {
            "success": False,
            "error": result.get("error") or "Envoi impossible.",
            "status_code": int(result.get("status_code") or 502),
            "ticket": result.get("ticket") or ticket,
            "result": result.get("result"),
        }
    chain = result.get("chain") if isinstance(result.get("chain"), dict) else {}
    steps = list(chain.get("steps") or [])
    if not steps:
        steps = ["E-mail envoyé"]
    return {
        "success": True,
        "ticket": result.get("ticket") or ticket,
        "result": result.get("result"),
        "contact": contact_card,
        "chain": {**chain, "steps": steps},
        "threads": list_contact_email_threads(contact_id, limit=20),
    }


def email_prospecting_stats(*, limit_open: int = 8) -> dict[str, Any]:
    """Stats pour briefing commercial."""
    mailbox = list_mailbox(bucket="all", limit=80)
    counts = mailbox.get("counts") or {}
    open_threads = list_email_threads(status="open", limit=limit_open)
    awaiting: list[dict] = []
    for t in open_threads:
        awaiting.append(
            {
                "id": t.get("id"),
                "contact_id": t.get("contact_id"),
                "subject": t.get("subject"),
                "to_email": t.get("to_email"),
                "last_message_at": t.get("last_message_at") or t.get("updated_at"),
            }
        )
    needs = [t for t in (mailbox.get("threads") or []) if t.get("bucket") == "needs_reply"]
    return {
        "open_threads": awaiting,
        "needs_reply": [
            {
                "id": t.get("id"),
                "contact_id": t.get("contact_id"),
                "subject": t.get("subject"),
                "to_email": t.get("to_email"),
                "preview": t.get("preview"),
            }
            for t in needs[:8]
        ],
        "counts": {
            "email_threads_open": int(counts.get("awaiting") or len(open_threads)),
            "email_threads_needs_reply": int(counts.get("needs_reply") or 0),
            "email_threads_replied_recent": int(counts.get("needs_reply") or 0),
            "email_drafts_pending": int(counts.get("drafts") or 0),
        },
    }


def sync_gmail_replies_for_contact(contact_id: str, *, limit: int = 15) -> dict[str, Any]:
    """Tire les réponses Gmail du contact et les rattache aux fils CRM."""
    contact = get_contact(contact_id)
    if not contact:
        return {"success": False, "error": "Contact introuvable.", "status_code": 404}
    email = str(contact.get("email") or "").strip()
    if not email:
        return {"success": False, "error": "Contact sans e-mail.", "status_code": 422}

    try:
        from tools.google_api import list_gmail_messages_from
    except Exception as e:
        return {"success": False, "error": f"Gmail indisponible : {e}", "status_code": 503}

    try:
        inbound = list_gmail_messages_from(email, limit=limit)
    except Exception as e:
        logger.warning("Gmail sync failed for contact %s", contact_id, exc_info=True)
        return {"success": False, "error": str(e), "status_code": 502}

    if isinstance(inbound, str):
        # message d'erreur outil
        return {"success": False, "error": inbound, "status_code": 502}

    imported = 0
    updated = 0
    skipped = 0
    details: list[dict] = []
    for item in inbound or []:
        if not isinstance(item, dict):
            continue
        gmid = str(item.get("gmail_message_id") or "").strip()
        full_body = str(item.get("body") or item.get("snippet") or "").strip()
        inbound_atts = item.get("attachments") if isinstance(item.get("attachments"), list) else []
        existing = find_message_by_gmail_id(gmid) if gmid else None
        if existing:
            old = str(existing.get("body") or "").strip()
            better = bool(full_body) and (not old or ("\n" not in old and len(full_body) > len(old)))
            missing_atts = inbound_atts and not (existing.get("attachments") or [])
            if better or missing_atts:
                patch: dict[str, Any] = {}
                if better:
                    patch["body"] = full_body
                if missing_atts:
                    patch["attachments"] = inbound_atts
                update_email_message(str(existing["id"]), **patch)
                updated += 1
            else:
                skipped += 1
            continue
        gtid = str(item.get("gmail_thread_id") or "").strip()
        thread = find_thread_by_gmail_thread_id(gtid) if gtid else None
        if not thread:
            # Rattacher au fil open le plus récent du contact
            opens = list_email_threads(contact_id=contact_id, status="open", limit=1)
            thread = opens[0] if opens else None
        if not thread:
            replied = list_email_threads(contact_id=contact_id, status="replied", limit=1)
            thread = replied[0] if replied else None
        if not thread:
            thread = create_email_thread(
                contact_id=contact_id,
                subject=str(item.get("subject") or "Réponse"),
                to_email=email,
                gmail_thread_id=gtid,
            )
        result = record_inbound_reply(
            contact_id=contact_id,
            thread=thread,
            subject=str(item.get("subject") or ""),
            body=full_body,
            from_email=str(item.get("from") or email),
            to_email=str(item.get("to") or ""),
            gmail_message_id=gmid,
            gmail_thread_id=gtid,
            message_id_header=str(item.get("message_id_header") or ""),
            in_reply_to=str(item.get("in_reply_to") or ""),
            created_at=str(item.get("internal_date") or "") or None,
            attachments=inbound_atts,
        )
        imported += 1
        details.append(
            {
                "thread_id": (result.get("thread") or {}).get("id"),
                "message_id": (result.get("message") or {}).get("id"),
                "cancelled_follow_ups": len(result.get("cancelled_follow_ups") or []),
            }
        )

    return {
        "success": True,
        "contact_id": contact_id,
        "imported": imported,
        "updated": updated,
        "skipped": skipped,
        "details": details,
        "threads": list_contact_email_threads(contact_id, limit=20),
    }


def sync_gmail_replies_mailbox(*, limit_per_contact: int = 10, max_contacts: int = 40) -> dict[str, Any]:
    """Sync Gmail pour tous les contacts qui ont un fil CRM non clos."""
    threads = list_email_threads(limit=200)
    contact_ids: list[str] = []
    seen: set[str] = set()
    for thread in threads:
        if str(thread.get("status") or "") == "closed":
            continue
        cid = str(thread.get("contact_id") or "").strip()
        if not cid or cid in seen:
            continue
        seen.add(cid)
        contact_ids.append(cid)
        if len(contact_ids) >= max(1, min(80, int(max_contacts or 40))):
            break

    imported = 0
    updated = 0
    skipped = 0
    synced = 0
    errors: list[dict] = []
    for cid in contact_ids:
        result = sync_gmail_replies_for_contact(cid, limit=limit_per_contact)
        if not result.get("success"):
            errors.append({"contact_id": cid, "error": result.get("error") or "sync failed"})
            continue
        synced += 1
        imported += int(result.get("imported") or 0)
        updated += int(result.get("updated") or 0)
        skipped += int(result.get("skipped") or 0)

    mailbox = list_mailbox(limit=80)
    return {
        "success": True,
        "contacts_synced": synced,
        "contacts_attempted": len(contact_ids),
        "imported": imported,
        "updated": updated,
        "skipped": skipped,
        "errors": errors[:8],
        "threads": mailbox.get("threads") or [],
        "drafts": mailbox.get("drafts") or [],
        "counts": mailbox.get("counts") or {},
        "sync": mailbox.get("sync") or {},
    }


async def run_gmail_prospect_sync_task(task: dict) -> None:
    """Tâche planifiée : sync Gmail de tous les workspaces qui ont des fils CRM."""
    import asyncio

    from tenant_context import clear_tenant_context, set_tenant_context

    task_id = str((task or {}).get("id") or "")
    ids = workspace_ids_with_email_threads()
    if not ids:
        logger.info("Gmail prospect sync (%s) : aucun fil CRM", task_id)
        return

    def _run_one(wid: str) -> dict[str, Any]:
        set_tenant_context(workspace_id=wid)
        try:
            return sync_gmail_replies_mailbox()
        finally:
            clear_tenant_context()

    for wid in ids:
        try:
            result = await asyncio.to_thread(_run_one, wid)
            logger.info(
                "Gmail prospect sync ws=%s imported=%s updated=%s",
                wid,
                (result or {}).get("imported"),
                (result or {}).get("updated"),
            )
        except Exception:
            logger.exception("Gmail prospect sync failed ws=%s task=%s", wid, task_id)


def _contact_first_name(contact: dict) -> str:
    name = re.sub(r"^\s*\[TEST\]\s*", "", str(contact.get("name") or ""), flags=re.IGNORECASE).strip()
    return (name.split()[0] if name else "").strip()


def _reply_subject(subject: str) -> str:
    raw = (subject or "").strip() or "votre message"
    return raw if re.match(r"(?i)^re:\s*", raw) else f"Re: {raw}"


def _normalize_suggestion(raw: Any, *, fallback_subject: str, index: int) -> dict[str, str] | None:
    if not isinstance(raw, dict):
        return None
    body = clean_outgoing_body(str(raw.get("body") or ""))
    if not body:
        return None
    labels = ("Chaleureux", "Concret", "Prudent")
    return {
        "id": str(raw.get("id") or f"s{index + 1}"),
        "label": str(raw.get("label") or labels[index % 3]).strip()[:80],
        "angle": str(raw.get("angle") or "").strip()[:160],
        "subject": str(raw.get("subject") or fallback_subject).strip()[:160],
        "body": body[:4000],
    }


def _fallback_email_suggestions(
    *,
    first_name: str,
    inbound: str,
    outbound: str,
    subject: str,
    guidance: str = "",
    seed_body: str = "",
) -> list[dict[str, str]]:
    who = first_name or "vous"
    hello = f"Bonjour {who}," if first_name else "Bonjour,"
    inbound_l = inbound.lower()
    interested = any(w in inbound_l for w in ("oui", "ok", "oké", "intéresse", "interesse", "volontiers", "avec plaisir"))
    question = "?" in inbound
    brand = _workspace_brand_label()
    subj = _reply_subject(subject) if inbound else (subject or f"{brand} — proposition de collaboration")
    sign = f"Bien à vous,\n{brand}"
    intent = (guidance or "").strip() or (seed_body or "").strip()[:800]
    if intent:
        a = (
            f"{hello}\n\n{intent}\n\n"
            "Dites-moi simplement si cela vous convient, ou ce qui serait plus confortable de votre côté.\n\n"
            f"{sign}"
        )
        b = (
            f"{hello}\n\n{intent}\n\n"
            "Pour rester concret : quel créneau vous irait pour un échange de 20 minutes, ou préférez-vous un point écrit ?\n\n"
            f"{sign}"
        )
        c = (
            f"{hello}\n\n{intent}\n\n"
            "Pas d'urgence de notre côté — je m'adapte à votre rythme.\n\n"
            f"{sign}"
        )
        _ = outbound
        _ = seed_body
        return [
            {"id": "s1", "label": "Chaleureux", "angle": "Dire cela avec chaleur", "subject": subj, "body": a},
            {"id": "s2", "label": "Concret", "angle": "Dire cela avec une prochaine étape", "subject": subj, "body": b},
            {"id": "s3", "label": "Prudent", "angle": "Dire cela sans pousser", "subject": subj, "body": c},
        ]
    if interested:
        a = (
            f"{hello}\n\nMerci pour votre retour — je suis ravi que ça résonne.\n\n"
            "Souhaitez-vous qu'on en parle 20 minutes cette semaine, ou préférez-vous que je vous envoie "
            "d'abord un déroulé court (intention, format, suite possible) ?\n\n"
            f"{sign}"
        )
        b = (
            f"{hello}\n\nMerci. Pour avancer concrètement, je vous propose un échange de 20 minutes "
            "sur votre pratique et ce qu'une de nos propositions pourrait y ajouter — sans engagement.\n\n"
            "Quel créneau vous irait en début de semaine ?\n\n"
            f"{sign}"
        )
        c = (
            f"{hello}\n\nMerci pour ce message. Je reste à votre rythme : dites-moi simplement "
            "si vous préférez un appel court ou un mail plus détaillé.\n\n"
            f"{sign}"
        )
    elif question:
        a = (
            f"{hello}\n\nMerci pour votre question. Je vous réponds volontiers, et je préfère le faire "
            "en m'appuyant sur votre contexte plutôt que par une fiche générique.\n\n"
            "On peut en parler 15–20 minutes, ou je vous envoie un point écrit si c'est plus simple.\n\n"
            f"{sign}"
        )
        b = (
            f"{hello}\n\nMerci. En deux mots : notre offre est un module à intégrer à votre accompagnement "
            "(pas un outil à plaquer). Je peux vous montrer un déroulé type et comment ça s'articule chez vous.\n\n"
            "Quel format vous convient le mieux ?\n\n"
            f"{sign}"
        )
        c = (
            f"{hello}\n\nMerci. Je peux préciser par mail, ou on s'en parle de vive voix — à vous de voir "
            "ce qui est le plus confortable.\n\n"
            f"{sign}"
        )
    else:
        a = (
            f"{hello}\n\nMerci pour votre message. J'ai bien lu votre retour.\n\n"
            "Dites-moi comment vous préférez poursuivre : un échange court, ou quelques précisions par mail.\n\n"
            f"{sign}"
        )
        b = (
            f"{hello}\n\nMerci. Pour rester concret, je peux vous envoyer un mini-déroulé "
            "(intention, format, prochaine étape) adapté à votre pratique.\n\n"
            "Est-ce que cela vous irait ?\n\n"
            f"{sign}"
        )
        c = (
            f"{hello}\n\nMerci. Pas d'urgence de notre côté : je reste disponible quand le moment sera le bon.\n\n"
            f"{sign}"
        )
    _ = outbound  # contexte disponible pour un raffinement futur
    return [
        {"id": "s1", "label": "Chaleureux", "angle": "Accuser réception et ouvrir le dialogue", "subject": subj, "body": a},
        {"id": "s2", "label": "Concret", "angle": "Proposer une prochaine étape claire", "subject": subj, "body": b},
        {"id": "s3", "label": "Prudent", "angle": "Laisser la main sans pousser", "subject": subj, "body": c},
    ]


def _parse_llm_suggestions(text: str, *, fallback_subject: str) -> list[dict[str, str]]:
    blob = (text or "").strip()
    if blob.startswith("```"):
        blob = re.sub(r"^```(?:json)?\s*", "", blob)
        blob = re.sub(r"\s*```$", "", blob)
    try:
        start, end = blob.find("{"), blob.rfind("}")
        data = json.loads(blob[start : end + 1] if start >= 0 and end > start else blob)
    except Exception:
        return []
    rows = data.get("suggestions") if isinstance(data, dict) else data
    if not isinstance(rows, list):
        return []
    out: list[dict[str, str]] = []
    for i, row in enumerate(rows[:3]):
        item = _normalize_suggestion(row, fallback_subject=fallback_subject, index=i)
        if item:
            out.append(item)
    return out


def _thread_transcript(messages: list[dict], *, limit: int = 10) -> str:
    """Fil compact pour orienter les suggestions (ordre chronologique)."""
    rows = [m for m in (messages or []) if isinstance(m, dict)][-max(1, min(20, int(limit or 10))):]
    blocks: list[str] = []
    for msg in rows:
        inbound = str(msg.get("direction") or "") == "inbound"
        who = "Eux" if inbound else "Vous"
        from_addr = str(msg.get("from_email") or "").strip()
        if inbound and from_addr:
            who = f"Eux ({from_addr})"
        raw = str(msg.get("reply_text") or msg.get("body") or "")
        text, _quoted = isolate_email_reply(raw)
        text = (text or "").strip()
        if not text:
            continue
        when = str(msg.get("created_at") or "")[:16].replace("T", " ")
        stamp = f" — {when}" if when else ""
        blocks.append(f"{who}{stamp} :\n{text[:900]}")
    return "\n\n".join(blocks).strip()


def _contact_profile_block(contact: dict) -> str:
    tags = contact.get("tags") if isinstance(contact.get("tags"), list) else []
    tag_txt = ", ".join(str(t) for t in tags if str(t).strip()) or "—"
    socials = contact.get("socials") if isinstance(contact.get("socials"), dict) else {}
    social_txt = ", ".join(f"{k}={v}" for k, v in socials.items() if str(v or "").strip()) or "—"
    return (
        f"Nom : {contact.get('name') or '—'}\n"
        f"Société / pratique : {contact.get('company') or '—'}\n"
        f"E-mail : {contact.get('email') or '—'}\n"
        f"Tags : {tag_txt}\n"
        f"Ville : {contact.get('city') or '—'} — {contact.get('address') or ''}\n"
        f"Site : {contact.get('website') or '—'}\n"
        f"LinkedIn : {contact.get('linkedin_url') or '—'}\n"
        f"Réseaux : {social_txt}\n"
        f"Notes fiche : {str(contact.get('notes') or '—')[:700]}\n"
        f"Angle déjà noté : {str(contact.get('outreach_suggestions') or '—')[:700]}"
    )


def suggest_email_replies(
    contact_id: str,
    *,
    thread_id: str = "",
    message_id: str = "",
    guidance: str = "",
    seed_body: str = "",
    seed_subject: str = "",
) -> dict[str, Any]:
    """Propose 3 brouillons (premier mail ou réponse), orientés par les consignes dirigeant."""
    contact = get_contact(contact_id)
    if not contact:
        return {"success": False, "error": "Contact introuvable.", "status_code": 404}
    if not str(contact.get("email") or "").strip():
        return {"success": False, "error": "Contact sans e-mail.", "status_code": 422}

    guidance = (guidance or "").strip()[:4000]
    seed_body = (seed_body or "").strip()[:4000]
    seed_subject = (seed_subject or "").strip()[:200]

    thread = get_email_thread(thread_id) if (thread_id or "").strip() else None
    if (thread_id or "").strip() and not thread:
        return {"success": False, "error": "Fil e-mail introuvable.", "status_code": 404}

    messages = list_email_messages(str(thread.get("id") or ""), limit=100) if thread else []
    inbound = None
    if (message_id or "").strip():
        inbound = next((m for m in messages if str(m.get("id") or "") == message_id.strip()), None)
        if not inbound:
            inbound = get_email_message(message_id)
    if not inbound and messages:
        inbound = next((m for m in reversed(messages) if m.get("direction") == "inbound"), None)
    outbound = next((m for m in reversed(messages) if m.get("direction") == "outbound"), None) if messages else None

    inbound_text, _quoted = isolate_email_reply(
        str((inbound or {}).get("reply_text") or (inbound or {}).get("body") or "")
    )
    inbound_text = inbound_text or str((inbound or {}).get("reply_text") or (inbound or {}).get("body") or "").strip()
    inbound_text = clean_outgoing_body(inbound_text) or inbound_text
    outbound_text = clean_outgoing_body(str((outbound or {}).get("reply_text") or (outbound or {}).get("body") or ""))
    seed_body = clean_outgoing_body(seed_body)
    outreach = str(contact.get("outreach_suggestions") or "").strip()
    is_reply = bool(inbound_text or message_id or (thread and inbound))
    if is_reply and seed_body and outreach and seed_body == outreach:
        seed_body = ""
    if is_reply:
        subject = _reply_subject(
            seed_subject or str((thread or {}).get("subject") or (inbound or {}).get("subject") or "")
        )
    else:
        subject = (
            seed_subject
            or str((thread or {}).get("subject") or "")
            or f"{_workspace_brand_label()} — proposition de collaboration"
        )
    first = _contact_first_name(contact)
    fallback = _fallback_email_suggestions(
        first_name=first,
        inbound=inbound_text,
        outbound=outbound_text,
        subject=subject,
        guidance=guidance,
        seed_body=seed_body,
    )

    source = "fallback"
    suggestions = fallback
    try:
        from llm_client import llm_chat

        kind = "une réponse dans un fil existant" if is_reply else "un premier e-mail de prise de contact"
        transcript = _thread_transcript(messages, limit=10)
        user = (
            f"Profil du prospect (contexte, ne pas le recopier) :\n{_contact_profile_block(contact)}\n\n"
            f"Tâche : rédiger {kind}.\n"
            f"Objet actuel : {subject or '—'}\n\n"
        )
        if is_reply and transcript:
            user += (
                "Historique du fil — CONTEXTE UNIQUEMENT. Ne le recopie pas dans le body, "
                "ne cite pas, n'ajoute pas « a écrit », ni de lignes commençant par > :\n"
                f"{transcript}\n\n"
            )
        elif not is_reply:
            user += "Premier contact : t'appuyer sur le profil (pratique, notes, tags), pas sur un fil.\n\n"
        if is_reply and inbound_text:
            user += f"Dernier message reçu à traiter :\n{inbound_text[:1500]}\n\n"
        if guidance:
            user += (
                "Consignes du dirigeant (PRIORITAIRES — chaque piste doit exprimer cela, "
                "avec un ton différent, sans inventer d'autres demandes) :\n"
                f"{guidance}\n\n"
            )
        if seed_body:
            user += (
                "Brouillon déjà dans l'éditeur (s'en inspirer pour le fond ; "
                "les consignes et le fil priment ; ne pas y coller d'historique) :\n"
                f"{seed_body}\n"
            )
        raw, _tin, _tout = llm_chat(
            (
                f"Tu es l'assistant commercial de « {_workspace_brand_label()} ». "
                "Tu rédiges des e-mails en français, tutoiement ou vouvoiement selon le mail reçu "
                "(par défaut vouvoiement). Ton : humain, concret, sans langue de bois. "
                "Pas de HTML. "
                "Le champ body contient UNIQUEMENT le nouveau message : salutations, propos, signature. "
                "INTERDIT d'y coller les mails précédents, les citations, « Le … a écrit : », "
                "« On … wrote: », ou des lignes '>'. L'historique sert à comprendre, pas à être recopié. "
                f"8 à 14 lignes. Signature : {_workspace_brand_label()}. "
                "Si des consignes dirigeant sont fournies, elles priment. "
                "Réponds UNIQUEMENT en JSON : "
                '{"suggestions":[{"label":"Chaleureux","angle":"…","subject":"…","body":"…"},'
                '{"label":"Concret","angle":"…","subject":"…","body":"…"},'
                '{"label":"Prudent","angle":"…","subject":"…","body":"…"}]}'
            ),
            [{"role": "user", "content": user}],
            max_tokens=1400,
            or_profile="lite",
            usage_context="email_reply_suggest",
        )
        parsed = _parse_llm_suggestions(raw, fallback_subject=subject)
        if len(parsed) >= 2:
            suggestions = parsed[:3]
            source = "llm"
    except Exception:
        logger.warning("email reply suggestions LLM failed", exc_info=True)

    return {
        "success": True,
        "contact_id": contact_id,
        "thread_id": (thread or {}).get("id"),
        "message_id": (inbound or {}).get("id"),
        "inbound_text": inbound_text[:1500],
        "guidance": guidance,
        "used_seed": bool(seed_body),
        "source": source,
        "suggestions": suggestions,
    }
