"""API partagée Classique <-> Korymb : authentification, tâches persistées, webhooks signés.

Classique est l'agent personnel/technique d'Eric (hors Korymb). Il dépose des tâches
via `POST /classique/tasks` ; le routeur de catégories décide qui traite. Les tâches
longues sont asynchrones : polling `GET /classique/tasks/{id}` ou webhook signé HMAC.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import secrets
import time
from datetime import datetime
from typing import Any

from database import _is_mariadb, get_conn
from services.classique_router import route

logger = logging.getLogger(__name__)

CLASSIQUE_AGENT_ID = "classique"
CLASSIQUE_IDENTITY: dict[str, Any] = {
    "id": CLASSIQUE_AGENT_ID,
    "name": "Classique",
    "kind": "external_agent",
    "role": "Assistant personnel et technique d'Eric (voix, chat, code).",
    "handles": ["personal_technical"],
    "peers": [
        {"id": "korymb", "name": "Korymb (Fleur d'Amours, Mandala…)", "handles": ["business"]},
        {"id": "hermes", "name": "Hermès", "handles": ["briefing", "veille logs", "smoke post-déploiement", "Telegram"]},
    ],
}

TASK_STATUSES = frozenset({
    "queued", "routed_to_classique", "awaiting_eric", "concertation",
    "running", "completed", "failed", "cancelled",
})
TERMINAL = frozenset({"completed", "failed", "cancelled"})
INITIAL_STATUS_BY_TARGET = {
    "korymb": "queued",
    "classique": "routed_to_classique",
    "concertation": "concertation",
    "eric": "awaiting_eric",
}


# ── Auth ─────────────────────────────────────────────────────────────────────

def _expected_key_hash() -> str:
    h = (os.getenv("CLASSIQUE_API_KEY_SHA256") or "").strip().lower()
    if h:
        return h
    plain = (os.getenv("CLASSIQUE_API_KEY") or "").strip()
    return hashlib.sha256(plain.encode()).hexdigest() if plain else ""


def is_configured() -> bool:
    return bool(_expected_key_hash())


def verify_api_key(presented: str) -> bool:
    expected = _expected_key_hash()
    if not expected or not presented:
        return False
    got = hashlib.sha256(presented.strip().encode()).hexdigest()
    return hmac.compare_digest(got, expected)


def default_workspace_id() -> str:
    return (os.getenv("CLASSIQUE_WORKSPACE_ID") or "ws-default-legacy").strip()


# ── Webhook HMAC ─────────────────────────────────────────────────────────────

def _webhook_secret() -> str:
    return (os.getenv("CLASSIQUE_WEBHOOK_SECRET") or "").strip()


def sign_payload(body: bytes, timestamp: str, secret: str | None = None) -> str:
    key = (secret if secret is not None else _webhook_secret()).encode()
    mac = hmac.new(key, f"{timestamp}.".encode() + body, hashlib.sha256).hexdigest()
    return f"sha256={mac}"


def send_callback(task: dict, *, http_post=None) -> bool:
    url = str(task.get("callback_url") or "").strip()
    secret = _webhook_secret()
    if not url:
        return False
    if not secret:
        logger.warning("Classique: callback ignoré (CLASSIQUE_WEBHOOK_SECRET absent) task=%s", task.get("id"))
        return False
    body = json.dumps(public_envelope(task), ensure_ascii=False, sort_keys=True).encode()
    ts = str(int(time.time()))
    headers = {
        "Content-Type": "application/json",
        "X-Korymb-Timestamp": ts,
        "X-Korymb-Signature": sign_payload(body, ts, secret),
        "X-Korymb-Task-Id": str(task.get("id") or ""),
    }
    try:
        if http_post is None:
            import httpx

            http_post = httpx.post
        r = http_post(url, content=body, headers=headers, timeout=10)
        ok = 200 <= int(getattr(r, "status_code", 0)) < 300
    except Exception:
        logger.warning("Classique: callback en échec task=%s", task.get("id"), exc_info=True)
        ok = False
    _set_callback_state(str(task["id"]), "delivered" if ok else "failed")
    return ok


# ── Persistence ──────────────────────────────────────────────────────────────

def init_classique_tables() -> None:
    pk = "VARCHAR(191)" if _is_mariadb() else "TEXT"
    big = "LONGTEXT" if _is_mariadb() else "TEXT"
    with get_conn() as conn:
        conn.execute(f"""
            CREATE TABLE IF NOT EXISTS classique_tasks (
                id              {pk} PRIMARY KEY,
                workspace_id    {pk} NOT NULL,
                external_id     TEXT,
                category        TEXT NOT NULL,
                target          TEXT NOT NULL,
                routing_json    TEXT NOT NULL DEFAULT '{{}}',
                intent          TEXT NOT NULL DEFAULT '',
                payload_json    {big} NOT NULL DEFAULT '{{}}',
                callback_url    TEXT NOT NULL DEFAULT '',
                callback_state  TEXT NOT NULL DEFAULT '',
                status          TEXT NOT NULL,
                result_json     {big},
                error           TEXT,
                created_at      TEXT NOT NULL,
                updated_at      TEXT NOT NULL
            )
        """)
        conn.commit()


def _now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _loads(raw: Any, default: Any) -> Any:
    if raw is None or raw == "":
        return default
    if not isinstance(raw, str):
        return raw
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return default


def _hydrate(row: Any) -> dict | None:
    if not row:
        return None
    d = dict(row)
    d["payload"] = _loads(d.pop("payload_json", None), {})
    d["routing"] = _loads(d.pop("routing_json", None), {})
    d["result"] = _loads(d.pop("result_json", None), None)
    return d


def public_envelope(task: dict) -> dict[str, Any]:
    """Enveloppe standard requête/réponse."""
    return {
        "id": task.get("id"),
        "external_id": task.get("external_id") or None,
        "workspace": task.get("workspace_id"),
        "category": task.get("category"),
        "target": task.get("target"),
        "routing": task.get("routing") or {},
        "intent": task.get("intent") or "",
        "payload": task.get("payload") or {},
        "callback_url": task.get("callback_url") or None,
        "status": task.get("status"),
        "result": task.get("result"),
        "error": task.get("error"),
        "created_at": task.get("created_at"),
        "updated_at": task.get("updated_at"),
    }


def create_task(
    *,
    workspace_id: str,
    intent: str,
    payload: dict | None = None,
    category: str | None = None,
    callback_url: str | None = None,
    external_id: str | None = None,
) -> dict:
    decision = route(category=category, intent=intent, payload=payload)
    tid = f"clq-{secrets.token_hex(8)}"
    now = _now()
    status = INITIAL_STATUS_BY_TARGET[decision["target"]]
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO classique_tasks (id, workspace_id, external_id, category, target, routing_json, "
            "intent, payload_json, callback_url, callback_state, status, result_json, error, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, NULL, NULL, ?, ?)",
            (
                tid, workspace_id, external_id or "", decision["category"], decision["target"],
                json.dumps(decision, ensure_ascii=False), intent or "",
                json.dumps(payload or {}, ensure_ascii=False), callback_url or "", status, now, now,
            ),
        )
        conn.commit()
    task = get_task(tid, workspace_id=workspace_id)
    assert task is not None
    return task


def get_task(task_id: str, *, workspace_id: str | None = None) -> dict | None:
    sql = "SELECT * FROM classique_tasks WHERE id=?"
    params: list[Any] = [task_id]
    if workspace_id:
        sql += " AND workspace_id=?"
        params.append(workspace_id)
    with get_conn() as conn:
        row = conn.execute(sql, tuple(params)).fetchone()
    return _hydrate(row)


def list_tasks(*, workspace_id: str | None = None, status: str | None = None, limit: int = 50) -> list[dict]:
    sql = "SELECT * FROM classique_tasks WHERE 1=1"
    params: list[Any] = []
    if workspace_id:
        sql += " AND workspace_id=?"
        params.append(workspace_id)
    if status:
        sql += " AND status=?"
        params.append(status)
    sql += " ORDER BY created_at DESC LIMIT ?"
    params.append(max(1, min(int(limit or 50), 200)))
    with get_conn() as conn:
        rows = conn.execute(sql, tuple(params)).fetchall()
    return [t for t in (_hydrate(r) for r in rows) if t]


def update_task(
    task_id: str,
    *,
    workspace_id: str | None = None,
    status: str,
    result: Any = None,
    error: str | None = None,
) -> dict | None:
    if status not in TASK_STATUSES:
        raise ValueError(f"Statut inconnu : {status}")
    current = get_task(task_id, workspace_id=workspace_id)
    if not current:
        return None
    if current["status"] in TERMINAL:
        raise ValueError("Tâche déjà terminée.")
    with get_conn() as conn:
        conn.execute(
            "UPDATE classique_tasks SET status=?, result_json=?, error=?, updated_at=? WHERE id=?",
            (
                status,
                json.dumps(result, ensure_ascii=False) if result is not None
                else (json.dumps(current["result"], ensure_ascii=False) if current.get("result") is not None else None),
                error,
                _now(),
                task_id,
            ),
        )
        conn.commit()
    task = get_task(task_id)
    if task and status in TERMINAL and task.get("callback_url"):
        send_callback(task)
        task = get_task(task_id)
    return task


def _set_callback_state(task_id: str, state: str) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE classique_tasks SET callback_state=? WHERE id=?", (state, task_id))
        conn.commit()


def stats(workspace_id: str | None = None) -> dict[str, int]:
    out: dict[str, int] = {}
    for t in list_tasks(workspace_id=workspace_id, limit=200):
        out[t["status"]] = out.get(t["status"], 0) + 1
    return out
