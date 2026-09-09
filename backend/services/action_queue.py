"""File d'actions dirigeant — préparation en fond, exécution uniquement après validation."""
from __future__ import annotations

import json
import logging
import secrets
from datetime import datetime
from typing import Any

from database import _is_mariadb, get_conn, _ws

logger = logging.getLogger(__name__)

ALLOWED_KINDS = frozenset({"email", "calendar", "wordpress", "social", "crm_note"})
RESOLVE_FROM = frozenset({"pending", "failed"})


def init_action_tables() -> None:
    text_pk = "VARCHAR(191)" if _is_mariadb() else "TEXT"
    event_pk = "BIGINT PRIMARY KEY AUTO_INCREMENT" if _is_mariadb() else "INTEGER PRIMARY KEY AUTOINCREMENT"
    payload_type = "LONGTEXT" if _is_mariadb() else "TEXT"
    with get_conn() as conn:
        conn.execute(f"""
            CREATE TABLE IF NOT EXISTS action_tickets (
                id                {text_pk} PRIMARY KEY,
                workspace_id      {text_pk} NOT NULL,
                kind              TEXT NOT NULL,
                title             TEXT NOT NULL,
                summary           TEXT NOT NULL DEFAULT '',
                payload_json      {payload_type} NOT NULL DEFAULT '{{}}',
                preview_url       TEXT,
                job_id            TEXT,
                source            TEXT NOT NULL DEFAULT 'korymb',
                status            TEXT NOT NULL DEFAULT 'pending',
                telegram_chat_id TEXT,
                telegram_msg_id  TEXT,
                error             TEXT,
                approved_at      TEXT,
                executed_at      TEXT,
                created_at       TEXT NOT NULL,
                updated_at       TEXT NOT NULL
            )
        """)
        conn.execute(f"""
            CREATE TABLE IF NOT EXISTS action_events (
                id           {event_pk},
                ticket_id    {text_pk} NOT NULL,
                event        TEXT NOT NULL,
                detail_json  TEXT NOT NULL DEFAULT '{{}}',
                created_at   TEXT NOT NULL
            )
        """)
        conn.commit()


def _now() -> str:
    return datetime.utcnow().isoformat()


def _new_id() -> str:
    return f"act-{secrets.token_hex(6)}"


def _hydrate(row: dict | None) -> dict | None:
    if not row:
        return None
    out = dict(row)
    raw = out.pop("payload_json", None)
    try:
        out["payload"] = json.loads(raw or "{}") if isinstance(raw, str) else (raw or {})
    except (json.JSONDecodeError, TypeError):
        out["payload"] = {}
    if not isinstance(out.get("payload"), dict):
        out["payload"] = {}
    return out


def _append_event(conn, ticket_id: str, event: str, detail: dict | None = None) -> None:
    conn.execute(
        "INSERT INTO action_events (ticket_id, event, detail_json, created_at) VALUES (?, ?, ?, ?)",
        (ticket_id, event, json.dumps(detail or {}, ensure_ascii=False), _now()),
    )


def enqueue_action(
    *,
    kind: str,
    title: str,
    summary: str = "",
    payload: dict | None = None,
    job_id: str | None = None,
    source: str = "korymb",
    preview_url: str | None = None,
) -> dict:
    kind_clean = (kind or "").strip().lower()
    if kind_clean not in ALLOWED_KINDS:
        raise ValueError(f"kind invalide: {kind!r}")
    ticket_id = _new_id()
    now = _now()
    wid = _ws()
    body = payload if isinstance(payload, dict) else {}
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO action_tickets (id, workspace_id, kind, title, summary, payload_json, preview_url, "
            "job_id, source, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                ticket_id,
                wid,
                kind_clean,
                (title or "")[:255],
                (summary or "")[:2000],
                json.dumps(body, ensure_ascii=False),
                (preview_url or "")[:2000] or None,
                (job_id or "").strip()[:64] or None,
                (source or "korymb")[:64],
                "pending",
                now,
                now,
            ),
        )
        _append_event(conn, ticket_id, "prepared", {"kind": kind_clean, "source": source})
        conn.commit()
    ticket = get_action(ticket_id)
    try:
        from services.director_platform import emit_director_notification

        emit_director_notification(
            kind="action_ticket",
            title=(title or "Action à valider")[:120],
            body=(summary or "")[:400],
            job_id=(job_id or "").strip() or None,
            action_url=f"/inbox?triage=1&focus={ticket_id}",
        )
    except Exception:
        logger.exception("Notification action_ticket failed for %s", ticket_id)
    try:
        from services.action_telegram import notify_action_ticket

        tg = notify_action_ticket(ticket or {"id": ticket_id, "kind": kind_clean, "title": title, "summary": summary})
        if tg.get("telegram_msg_id"):
            _store_telegram_meta(ticket_id, tg.get("telegram_chat_id"), tg.get("telegram_msg_id"))
            if ticket:
                ticket["telegram_msg_id"] = tg.get("telegram_msg_id")
                ticket["telegram_chat_id"] = tg.get("telegram_chat_id")
    except Exception:
        logger.warning("Telegram notify skipped for %s", ticket_id, exc_info=True)
    return ticket or {"id": ticket_id, "status": "pending"}


def _store_telegram_meta(ticket_id: str, chat_id: str | None, msg_id: str | None) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE action_tickets SET telegram_chat_id=?, telegram_msg_id=?, updated_at=? "
            "WHERE id=? AND workspace_id=?",
            (chat_id or None, msg_id or None, _now(), ticket_id, _ws()),
        )
        conn.commit()


def enqueue_from_tool(*, tool_name: str, inp: dict[str, Any], job_id: str = "", agent_key: str = "") -> str:
    name = (tool_name or "").strip()
    if name in ("send_email", "send_gmail"):
        return enqueue_email_from_tool(tool_name=name, inp=inp, job_id=job_id, agent_key=agent_key)
    if name == "create_calendar_event":
        return enqueue_calendar_from_tool(inp=inp, job_id=job_id, agent_key=agent_key)
    if name in ("post_instagram", "post_facebook", "schedule_instagram_post", "schedule_facebook_post"):
        return enqueue_social_from_tool(tool_name=name, inp=inp, job_id=job_id, agent_key=agent_key)
    if name == "wordpress_create_post":
        return enqueue_wordpress_from_tool(inp=inp, job_id=job_id, agent_key=agent_key)
    return f"Erreur: outil `{name}` non pris en charge par la file d'actions."


def enqueue_email_from_tool(*, tool_name: str, inp: dict[str, Any], job_id: str = "", agent_key: str = "") -> str:
    """Intercepte send_email / send_gmail : file d'arbitrage, aucun envoi live."""
    to = str(inp.get("to") or "").strip()
    subject = str(inp.get("subject") or "").strip()
    body = str(inp.get("body") or "").strip()
    if not to or not subject:
        return "Erreur: destinataire (to) et objet (subject) requis pour mettre l'e-mail en file d'arbitrage."
    contact_id = ""
    try:
        from services.business_db import find_contact_by_email

        contact = find_contact_by_email(to)
        if contact:
            contact_id = str(contact.get("id") or "")
    except Exception:
        pass
    summary = f"À : {to}\nObjet : {subject}\n\n{body}".strip()
    if len(summary) > 800:
        summary = summary[:797] + "…"
    ticket = enqueue_action(
        kind="email",
        title=f"E-mail — {subject[:80]}",
        summary=summary,
        payload={
            "to": to,
            "subject": subject,
            "body": body,
            "tool": tool_name,
            "agent_key": (agent_key or "")[:64],
            "contact_id": contact_id,
        },
        job_id=job_id or None,
        source="tool",
    )
    tid = ticket.get("id") or ""
    return (
        f"[en file] E-mail en attente de validation dirigeant (ticket {tid}). "
        "Aucun envoi tant que le dirigeant n'a pas cliqué Valider dans l'inbox."
    )


def enqueue_calendar_from_tool(*, inp: dict[str, Any], job_id: str = "", agent_key: str = "") -> str:
    summary = str(inp.get("summary") or inp.get("title") or "").strip()
    start_at = str(inp.get("start_at") or inp.get("start") or "").strip()
    end_at = str(inp.get("end_at") or inp.get("end") or "").strip()
    if not summary or not start_at or not end_at:
        return "Erreur: summary, start_at et end_at requis pour l'agenda."
    text = f"{summary}\n{start_at} → {end_at}\n{inp.get('description') or ''}".strip()
    ticket = enqueue_action(
        kind="calendar",
        title=f"Agenda — {summary[:80]}",
        summary=text[:800],
        payload={
            "summary": summary,
            "start_at": start_at,
            "end_at": end_at,
            "description": str(inp.get("description") or ""),
            "attendees": str(inp.get("attendees") or ""),
            "tool": "create_calendar_event",
            "agent_key": (agent_key or "")[:64],
        },
        job_id=job_id or None,
        source="tool",
    )
    tid = ticket.get("id") or ""
    return (
        f"[en file] Événement agenda en attente de validation (ticket {tid}). "
        "Aucun créneau créé tant que le dirigeant n'a pas validé."
    )


def enqueue_social_from_tool(*, tool_name: str, inp: dict[str, Any], job_id: str = "", agent_key: str = "") -> str:
    platform = "instagram" if "instagram" in tool_name else "facebook"
    caption = str(inp.get("caption") or inp.get("message") or "").strip()
    if not caption:
        return "Erreur: texte du post (caption/message) requis."
    ticket = enqueue_action(
        kind="social",
        title=f"{platform.title()} — {caption[:60]}",
        summary=caption[:800],
        payload={
            "platform": platform,
            "tool": tool_name,
            "caption": caption,
            "message": str(inp.get("message") or caption),
            "image_url": str(inp.get("image_url") or ""),
            "publish_at": str(inp.get("publish_at") or ""),
            "agent_key": (agent_key or "")[:64],
        },
        job_id=job_id or None,
        source="tool",
    )
    tid = ticket.get("id") or ""
    return (
        f"[en file] Post {platform} en attente de validation (ticket {tid}). "
        "Aucune publication tant que le dirigeant n'a pas validé."
    )


def enqueue_wordpress_from_tool(*, inp: dict[str, Any], job_id: str = "", agent_key: str = "") -> str:
    title = str(inp.get("title") or "").strip()
    content = str(inp.get("content") or inp.get("html") or "").strip()
    excerpt = str(inp.get("excerpt") or "").strip()
    if not title or not content:
        return "Erreur: titre et contenu WordPress requis."
    preview_url = None
    wp_post_id = ""
    try:
        from tools.wordpress import parse_wordpress_result, run_wordpress_create_post, wordpress_configured

        if wordpress_configured():
            draft = run_wordpress_create_post(title, content, excerpt, status="draft")
            parsed = parse_wordpress_result(draft)
            wp_post_id = str(parsed.get("wp_post_id") or "")
            preview_url = parsed.get("link")
    except Exception:
        logger.warning("WordPress draft on enqueue failed", exc_info=True)
    ticket = enqueue_action(
        kind="wordpress",
        title=f"Article — {title[:80]}",
        summary=f"{title}\n\n{content}"[:800],
        payload={
            "title": title,
            "content": content,
            "excerpt": excerpt,
            "wp_post_id": wp_post_id,
            "tool": "wordpress_create_post",
            "agent_key": (agent_key or "")[:64],
        },
        job_id=job_id or None,
        source="tool",
        preview_url=preview_url,
    )
    tid = ticket.get("id") or ""
    extra = f" Brouillon : {preview_url}" if preview_url else ""
    return (
        f"[en file] Article WordPress en attente de publication (ticket {tid}).{extra} "
        "Aucun publish tant que le dirigeant n'a pas validé."
    )


def get_action_unscoped(ticket_id: str) -> dict | None:
    """Lookup hors tenant — webhook Telegram."""
    tid = (ticket_id or "").strip()
    if not tid:
        return None
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM action_tickets WHERE id = ?", (tid,)).fetchone()
    return _hydrate(dict(row) if row else None)


def get_action(ticket_id: str) -> dict | None:
    tid = (ticket_id or "").strip()
    if not tid:
        return None
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM action_tickets WHERE id = ? AND workspace_id = ?",
            (tid, _ws()),
        ).fetchone()
    return _hydrate(dict(row) if row else None)


def list_actions(*, status: str | None = "pending", limit: int = 50) -> list[dict]:
    lim = max(1, min(int(limit or 50), 200))
    wid = _ws()
    with get_conn() as conn:
        if status:
            rows = conn.execute(
                "SELECT * FROM action_tickets WHERE workspace_id = ? AND status = ? "
                "ORDER BY created_at ASC LIMIT ?",
                (wid, status, lim),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM action_tickets WHERE workspace_id = ? "
                "ORDER BY created_at DESC LIMIT ?",
                (wid, lim),
            ).fetchall()
    return [_hydrate(dict(r)) for r in rows or [] if r]


def resolve_action(
    ticket_id: str,
    *,
    decision: str,
    source: str = "inbox",
    comment: str = "",
) -> dict[str, Any]:
    ticket = get_action(ticket_id)
    if not ticket:
        return {"success": False, "error": "Ticket introuvable.", "status_code": 404}

    dec = (decision or "").strip().lower()
    if dec not in ("approve", "reject"):
        return {"success": False, "error": "decision doit être approve ou reject.", "status_code": 400}

    st = str(ticket.get("status") or "")
    if st == "executed":
        return {"success": False, "error": "Ticket déjà exécuté.", "status_code": 409, "ticket": ticket}
    if st == "rejected":
        return {"success": False, "error": "Ticket déjà rejeté.", "status_code": 409, "ticket": ticket}
    if st == "executing":
        return {"success": False, "error": "Ticket déjà en cours d'exécution.", "status_code": 409, "ticket": ticket}
    if st not in RESOLVE_FROM:
        return {"success": False, "error": f"Statut incompatible ({st}).", "status_code": 409, "ticket": ticket}

    now = _now()
    tid = str(ticket["id"])
    wid = _ws()

    if dec == "reject":
        with get_conn() as conn:
            cur = conn.execute(
                "UPDATE action_tickets SET status=?, error=?, updated_at=? "
                "WHERE id=? AND workspace_id=? AND status=?",
                ("rejected", (comment or "")[:2000], now, tid, wid, st),
            )
            changed = int(getattr(cur, "rowcount", 0) or 0)
            if changed:
                _append_event(conn, tid, "rejected", {"source": source, "comment": comment[:400]})
            conn.commit()
        if not changed:
            return {"success": False, "error": "Ticket déjà traité.", "status_code": 409, "ticket": get_action(tid)}
        return {"success": True, "ticket": get_action(tid)}

    with get_conn() as conn:
        cur = conn.execute(
            "UPDATE action_tickets SET status=?, approved_at=?, updated_at=?, error=NULL "
            "WHERE id=? AND workspace_id=? AND status IN ('pending','failed')",
            ("executing", now, now, tid, wid),
        )
        changed = int(getattr(cur, "rowcount", 0) or 0)
        if changed:
            _append_event(conn, tid, "approved", {"source": source, "comment": comment[:400]})
        conn.commit()
    if not changed:
        return {"success": False, "error": "Ticket déjà traité.", "status_code": 409, "ticket": get_action(tid)}

    from services.action_executor import execute_ticket, result_is_success

    executing = get_action(tid) or ticket
    chain: dict[str, Any] | None = None
    try:
        exec_out = execute_ticket(executing)
        if isinstance(exec_out, tuple):
            result_text, chain = exec_out
        else:
            # Compat si un mock de test renvoie encore une str
            result_text, chain = str(exec_out), None
    except Exception as exc:
        logger.exception("Action execute failed for %s", tid)
        result_text = f"Erreur exécution : {exc}"
        ok = False
        chain = None
    else:
        ok = result_is_success(result_text)

    done_at = _now()
    new_status = "executed" if ok else "failed"
    with get_conn() as conn:
        conn.execute(
            "UPDATE action_tickets SET status=?, executed_at=?, error=?, updated_at=? "
            "WHERE id=? AND workspace_id=?",
            (new_status, done_at if ok else None, None if ok else str(result_text)[:2000], done_at, tid, wid),
        )
        _append_event(
            conn,
            tid,
            new_status,
            {"source": source, "result": str(result_text)[:800], "chain": chain or {}},
        )
        conn.commit()
    updated = get_action(tid)
    if not ok:
        return {
            "success": False,
            "ticket": updated,
            "result": result_text,
            "error": result_text,
            "chain": chain,
            "status_code": 502,
        }
    return {"success": True, "ticket": updated, "result": result_text, "error": None, "chain": chain}


def ensure_sandbox_execute_on() -> None:
    """Force le sandbox outils : aucune écriture externe hors file d'actions."""
    from database import upsert_behavior_setting

    upsert_behavior_setting("orchestration.tools.sandbox_execute", True)
