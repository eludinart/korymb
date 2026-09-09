"""
Prospection e-mail : fils CRM, envois HITL, sync réponses Gmail, annulation relances.
"""
from __future__ import annotations

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

logger = logging.getLogger(__name__)

THREAD_STATUSES = frozenset({"open", "replied", "closed"})
EMAIL_DIRECTIONS = frozenset({"outbound", "inbound"})

_GMAIL_SEND_RE = re.compile(
    r"id:\s*([^\s,)]+)(?:.*?thread:\s*([^\s,)]+))?",
    re.IGNORECASE | re.DOTALL,
)


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
    return dict(row)


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
) -> dict | None:
    if not get_email_thread(thread_id):
        return None
    direction_clean = direction if direction in EMAIL_DIRECTIONS else "outbound"
    mid = _new_id("emsg")
    now = created_at or _now()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO biz_email_messages "
            "(id, workspace_id, thread_id, direction, subject, body, from_email, to_email, "
            "message_id_header, gmail_message_id, in_reply_to, ticket_id, created_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
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
                now,
            ),
        )
        conn.commit()
    update_email_thread(thread_id, last_message_at=now)
    return get_email_message(mid)


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
        or (f"<korymb-{secrets.token_hex(8)}@eludein.art>" if not gmail_message_id else ""),
        gmail_message_id=gmail_message_id,
        ticket_id=ticket_id,
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


def prepare_contact_email_ticket(
    contact_id: str,
    *,
    subject: str = "",
    body: str = "",
    job_id: str = "",
    thread_id: str = "",
) -> dict[str, Any]:
    """Prépare un ticket e-mail HITL depuis la fiche contact."""
    from services.action_queue import enqueue_action

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
    if (subject or "").strip():
        subj = subject.strip()
    elif coach_like or company:
        angle = company or name_clean or "votre pratique"
        subj = f"Proposition Fleur d'ÅmÔurs — enrichir {angle}"[:160]
    else:
        subj = f"Élude In Art — échange avec {name_clean}"[:160]
    if (body or "").strip():
        mail_body = body.strip()
    elif outreach:
        mail_body = outreach[:3500]
    else:
        mail_body = (
            f"Bonjour {name_clean},\n\n"
            "Je me permets de vous écrire au sujet d'Élude In Art / Fleur d'ÅmÔurs.\n\n"
            "Bien cordialement"
        )

    existing = (thread_id or "").strip()
    if existing and not get_email_thread(existing):
        return {"success": False, "error": "Fil e-mail introuvable.", "status_code": 404}

    ticket = enqueue_action(
        kind="email",
        title=f"E-mail — {name_clean}"[:120],
        summary=f"À : {to}\nObjet : {subj}\n\n{mail_body}"[:800],
        payload={
            "to": to,
            "subject": subj,
            "body": mail_body,
            "tool": "send_gmail",
            "contact_id": str(contact.get("id") or ""),
            "agent_key": "commercial",
            "thread_id": existing,
            "job_id": (job_id or "").strip(),
        },
        job_id=(job_id or "").strip() or None,
        source="contact_email",
    )
    return {
        "success": True,
        "ticket": ticket,
        "contact": {
            "id": contact.get("id"),
            "name": contact.get("name"),
            "email": to,
        },
        "chain": {
            "steps": [
                "Brouillon e-mail préparé dans l'inbox (validation avant envoi)",
            ],
        },
    }


def email_prospecting_stats(*, limit_open: int = 8) -> dict[str, Any]:
    """Stats pour briefing commercial."""
    open_threads = list_email_threads(status="open", limit=limit_open)
    replied = list_email_threads(status="replied", limit=5)
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
    return {
        "open_threads": awaiting,
        "counts": {
            "email_threads_open": len(open_threads),
            "email_threads_replied_recent": len(replied),
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
    skipped = 0
    details: list[dict] = []
    for item in inbound or []:
        if not isinstance(item, dict):
            continue
        gmid = str(item.get("gmail_message_id") or "").strip()
        if gmid and find_message_by_gmail_id(gmid):
            skipped += 1
            continue
        gtid = str(item.get("gmail_thread_id") or "").strip()
        thread = find_thread_by_gmail_thread_id(gtid) if gtid else None
        if not thread:
            # Rattacher au fil open le plus récent du contact
            opens = list_email_threads(contact_id=contact_id, status="open", limit=1)
            thread = opens[0] if opens else None
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
            body=str(item.get("snippet") or item.get("body") or ""),
            from_email=str(item.get("from") or email),
            to_email=str(item.get("to") or ""),
            gmail_message_id=gmid,
            gmail_thread_id=gtid,
            message_id_header=str(item.get("message_id_header") or ""),
            in_reply_to=str(item.get("in_reply_to") or ""),
            created_at=str(item.get("internal_date") or "") or None,
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
        "skipped": skipped,
        "details": details,
        "threads": list_contact_email_threads(contact_id, limit=20),
    }
