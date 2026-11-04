"""Bus messages inter-agents (Cursor / Hermes / Grokbot / Grok) — hors HITL."""
from __future__ import annotations

import secrets
from datetime import datetime
from typing import Any

from database import LONG_TEXT_CHARS, _is_mariadb, get_conn, _ws

ALLOWED_NODES = frozenset({"cursor", "grokbot", "hermes", "grok"})
ALLOWED_TO = ALLOWED_NODES | {"*"}
ALLOWED_STATUS = frozenset({"open", "acked", "done"})


def init_agent_bus_tables() -> None:
    text_pk = "VARCHAR(191)" if _is_mariadb() else "TEXT"
    body_type = "LONGTEXT" if _is_mariadb() else "TEXT"
    with get_conn() as conn:
        conn.execute(f"""
            CREATE TABLE IF NOT EXISTS agent_bus_messages (
                id            {text_pk} PRIMARY KEY,
                workspace_id  {text_pk} NOT NULL,
                from_node     TEXT NOT NULL,
                to_node       TEXT NOT NULL,
                topic         TEXT NOT NULL,
                body          {body_type} NOT NULL,
                status        TEXT NOT NULL DEFAULT 'open',
                reply_to      TEXT,
                comment       TEXT NOT NULL DEFAULT '',
                created_at    TEXT NOT NULL,
                updated_at    TEXT NOT NULL
            )
        """)
        conn.commit()


def _now() -> str:
    return datetime.utcnow().isoformat()


def _new_id() -> str:
    return f"bus-{secrets.token_hex(6)}"


def _row_to_dict(row: dict | None) -> dict | None:
    if not row:
        return None
    return {
        "id": row["id"],
        "from": row["from_node"],
        "to": row["to_node"],
        "topic": row["topic"],
        "body": row["body"],
        "status": row["status"],
        "reply_to": row.get("reply_to"),
        "comment": row.get("comment") or "",
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def create_message(
    *,
    from_node: str,
    to_node: str,
    topic: str,
    body: str,
    reply_to: str | None = None,
) -> dict:
    fr = (from_node or "").strip().lower()
    to = (to_node or "").strip().lower()
    topic_clean = (topic or "").strip()[:128]
    body_clean = (body or "").strip()[:LONG_TEXT_CHARS]
    if fr not in ALLOWED_NODES:
        raise ValueError(f"from invalide: {from_node}")
    if to not in ALLOWED_TO:
        raise ValueError(f"to invalide: {to_node}")
    if not topic_clean:
        raise ValueError("topic requis")
    if not body_clean:
        raise ValueError("body requis")
    mid = _new_id()
    now = _now()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO agent_bus_messages "
            "(id, workspace_id, from_node, to_node, topic, body, status, reply_to, comment, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, 'open', ?, '', ?, ?)",
            (mid, _ws(), fr, to, topic_clean, body_clean, reply_to, now, now),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM agent_bus_messages WHERE id=?", (mid,)
        ).fetchone()
    return _row_to_dict(dict(row))  # type: ignore[arg-type]


def get_message(message_id: str) -> dict | None:
    mid = (message_id or "").strip()
    if not mid:
        return None
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM agent_bus_messages WHERE id=? AND workspace_id=?",
            (mid, _ws()),
        ).fetchone()
    return _row_to_dict(dict(row)) if row else None  # type: ignore[arg-type]


def list_messages(
    *,
    to_node: str | None = None,
    from_node: str | None = None,
    topic: str | None = None,
    status: str | None = "open",
    limit: int = 50,
) -> list[dict]:
    clauses = ["workspace_id = ?"]
    params: list[Any] = [_ws()]
    if to_node:
        clauses.append("to_node = ?")
        params.append(to_node.strip().lower())
    if from_node:
        clauses.append("from_node = ?")
        params.append(from_node.strip().lower())
    if topic:
        clauses.append("topic = ?")
        params.append(topic.strip()[:128])
    if status is not None and str(status).strip() != "":
        st = status.strip().lower()
        if st not in ALLOWED_STATUS:
            raise ValueError(f"status invalide: {status}")
        clauses.append("status = ?")
        params.append(st)
    lim = max(1, min(int(limit or 50), 200))
    sql = (
        "SELECT * FROM agent_bus_messages WHERE "
        + " AND ".join(clauses)
        + " ORDER BY created_at DESC LIMIT ?"
    )
    params.append(lim)
    with get_conn() as conn:
        rows = conn.execute(sql, tuple(params)).fetchall()
    return [_row_to_dict(dict(r)) for r in rows]  # type: ignore[misc]


def _set_status(message_id: str, status: str, comment: str = "") -> dict:
    if status not in ALLOWED_STATUS:
        raise ValueError(f"status invalide: {status}")
    now = _now()
    with get_conn() as conn:
        cur = conn.execute(
            "UPDATE agent_bus_messages SET status=?, comment=CASE WHEN ? != '' THEN ? ELSE comment END, "
            "updated_at=? WHERE id=? AND workspace_id=?",
            (status, comment, comment[:LONG_TEXT_CHARS], now, message_id, _ws()),
        )
        conn.commit()
        if cur.rowcount == 0:
            raise KeyError(message_id)
        row = conn.execute(
            "SELECT * FROM agent_bus_messages WHERE id=?", (message_id,)
        ).fetchone()
    return _row_to_dict(dict(row))  # type: ignore[arg-type]


def ack_message(message_id: str) -> dict:
    return _set_status(message_id, "acked")


def done_message(message_id: str, comment: str = "") -> dict:
    return _set_status(message_id, "done", comment=comment or "")
