"""Copie un extrait de la MariaDB de prod vers la SQLite de dev.

Le tunnel SSH (127.0.0.1:3307) ne sert que pendant cette commande.
Les clés API présentes dans llm_runtime_settings sont vidées : le backend
local continue d'utiliser les clés de backend/.env. Le fichier
backend/data/korymb.db reste ignoré par git.
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import sys
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import pymysql

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
ENV_FILE = ROOT / ".env"
DB_FILE = ROOT / "data" / "korymb.db"

# Tables de réglage et de référentiel, petites, copiées en entier.
FULL_TABLES = (
    "korymb_workspaces",
    "korymb_users",
    "korymb_memberships",
    "enterprise_memory",
    "behavior_settings",
    "orchestration_prompts",
    "playbooks",
    "scheduled_tasks",
    "custom_agents",
    "agent_groups",
    "team_blueprints",
    "agent_group_memory",
    "mission_templates",
    "agent_tool_permissions",
    "inbox_dismissals",
    "reprise_checklist_actions",
    "llm_runtime_settings",
)

# (table, colonne de tri, plafond)
LIMITED_TABLES = (
    ("jobs", "updated_at", 50),
    ("mission_sessions", "updated_at", 25),
    ("chat_sessions", "updated_at", 12),
    ("chat_conversations", "updated_at", 12),
    ("director_notifications", "created_at", 60),
    ("biz_contacts", "updated_at", 400),
    ("biz_projects", "updated_at", 200),
    ("biz_quotes", "updated_at", 100),
    ("biz_external_invoices", "updated_at", 80),
    ("biz_work_tasks", "updated_at", 150),
    ("biz_calendar_events", "updated_at", 80),
    ("biz_interactions", "created_at", 80),
    ("classique_tasks", "updated_at", 80),
    ("action_tickets", "updated_at", 40),
    ("autonomous_outputs", "created_at", 20),
    ("memory_history", "created_at", 5),
    ("knowledge_entities", "updated_at", 200),
    ("biz_email_threads", "updated_at", 25),
)

_SECRET_KEY = re.compile(r"(api_key|password|secret|token)$", re.IGNORECASE)


def adapt_value(value: Any) -> Any:
    """Rend une valeur PyMySQL acceptable pour SQLite."""
    if isinstance(value, datetime):
        return value.isoformat(sep=" ")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, memoryview):
        return bytes(value)
    return value


def redact_json_secrets(raw: Any) -> Any:
    """Vide les champs secret d'un JSON objet. Une chaîne vide ne masque pas le .env."""
    if not isinstance(raw, str) or not raw.strip():
        return raw
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return raw
    if not isinstance(data, dict):
        return raw
    changed = False
    for key, val in list(data.items()):
        if isinstance(val, str) and val.strip() and _SECRET_KEY.search(str(key)):
            data[key] = ""
            changed = True
    if not changed:
        return raw
    return json.dumps(data, ensure_ascii=False)


def _read_env_value(key: str) -> str:
    if not ENV_FILE.is_file():
        raise SystemExit(f"Fichier manquant : {ENV_FILE}")
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        if line.startswith(f"{key}="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit(f"{key} manquant dans {ENV_FILE.name}")


def _source_conn():
    return pymysql.connect(
        host="127.0.0.1",
        port=int(os.getenv("KORYMB_SQLITE_IMPORT_PORT") or "3307"),
        user=_read_env_value("KORYMB_DB_USER"),
        password=_read_env_value("KORYMB_DB_PASSWORD"),
        database=_read_env_value("KORYMB_DB_NAME"),
        charset="utf8mb4",
        connect_timeout=10,
        read_timeout=120,
        cursorclass=pymysql.cursors.DictCursor,
    )


def _maria_columns(cur, table: str) -> list[str] | None:
    try:
        cur.execute(f"SHOW COLUMNS FROM `{table}`")
    except pymysql.err.ProgrammingError:
        return None
    return [str(row["Field"]) for row in cur.fetchall()]


def _sqlite_columns(conn: sqlite3.Connection, table: str) -> list[str] | None:
    rows = conn.execute(f"PRAGMA table_info('{table}')").fetchall()
    if not rows:
        return None
    return [str(row[1]) for row in rows]


def _shared_columns(maria_cols: list[str], sqlite_cols: list[str]) -> list[str]:
    sqlite_set = set(sqlite_cols)
    return [name for name in maria_cols if name in sqlite_set]


def _fetch(cur, table: str, columns: list[str], order: str | None, limit: int | None) -> list[dict]:
    col_sql = ", ".join(f"`{name}`" for name in columns)
    if limit is None:
        cur.execute(f"SELECT {col_sql} FROM `{table}`")
        return list(cur.fetchall())
    if order and order in columns:
        cur.execute(
            f"SELECT {col_sql} FROM `{table}` ORDER BY `{order}` DESC LIMIT %s",
            (int(limit),),
        )
        return list(cur.fetchall())
    cur.execute(f"SELECT {col_sql} FROM `{table}` LIMIT %s", (int(limit),))
    return list(cur.fetchall())


def _fetch_in(
    cur,
    table: str,
    columns: list[str],
    key: str,
    ids: list[str],
    limit: int,
) -> list[dict]:
    if not ids or key not in columns:
        return []
    col_sql = ", ".join(f"`{name}`" for name in columns)
    placeholders = ", ".join(["%s"] * len(ids))
    order = "id" if "id" in columns else key
    cur.execute(
        f"SELECT {col_sql} FROM `{table}` WHERE `{key}` IN ({placeholders}) "
        f"ORDER BY `{order}` DESC LIMIT %s",
        (*ids, int(limit)),
    )
    return list(cur.fetchall())


def _replace(conn: sqlite3.Connection, table: str, columns: list[str], rows: list[dict]) -> int:
    conn.execute("PRAGMA foreign_keys=OFF")
    conn.execute(f'DELETE FROM "{table}"')
    if rows:
        col_sql = ", ".join(f'"{name}"' for name in columns)
        marks = ", ".join("?" * len(columns))
        payload = []
        for row in rows:
            values = []
            for name in columns:
                value = adapt_value(row.get(name))
                if table == "llm_runtime_settings" and name == "value_json":
                    value = redact_json_secrets(value)
                values.append(value)
            payload.append(tuple(values))
        conn.executemany(
            f'INSERT INTO "{table}" ({col_sql}) VALUES ({marks})',
            payload,
        )
    conn.commit()
    return len(rows)


def _copy_table(
    cur,
    dest: sqlite3.Connection,
    table: str,
    *,
    order: str | None = None,
    limit: int | None = None,
) -> list[dict]:
    maria_cols = _maria_columns(cur, table)
    sqlite_cols = _sqlite_columns(dest, table)
    if maria_cols is None:
        print(f"  {table}: absente sur MariaDB")
        return []
    if sqlite_cols is None:
        print(f"  {table}: absente sur SQLite")
        return []
    columns = _shared_columns(maria_cols, sqlite_cols)
    if not columns:
        print(f"  {table}: aucune colonne commune")
        return []
    try:
        rows = _fetch(cur, table, columns, order, limit)
        count = _replace(dest, table, columns, rows)
    except Exception as exc:
        dest.rollback()
        print(f"  {table}: echec ({exc})")
        return []
    print(f"  {table}: {count}")
    return rows


def _ids(rows: list[dict], key: str = "id") -> list[str]:
    out: list[str] = []
    for row in rows:
        val = row.get(key)
        if val is None:
            continue
        text = str(val).strip()
        if text:
            out.append(text)
    return out


def _align_enterprise_memory(conn: sqlite3.Connection) -> None:
    """L'ancienne SQLite locale n'accepte qu'une ligne id=1. Le schéma courant est une ligne par espace."""
    cols = _sqlite_columns(conn, "enterprise_memory") or []
    if cols and "id" not in cols and "workspace_id" in cols:
        return
    conn.execute("DROP TABLE IF EXISTS enterprise_memory")
    conn.execute(
        """
        CREATE TABLE enterprise_memory (
            workspace_id TEXT PRIMARY KEY,
            contexts_json TEXT NOT NULL DEFAULT '{}',
            recent_missions_json TEXT NOT NULL DEFAULT '[]',
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.commit()


def main() -> int:
    os.environ["KORYMB_DB_ENGINE"] = "sqlite"
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))

    print("Connexion MariaDB 127.0.0.1:3307 (tunnel)...")
    try:
        source = _source_conn()
    except pymysql.err.OperationalError as exc:
        print(f"MariaDB injoignable : {exc}")
        print("Ouvrez le tunnel : .\\scripts\\mariadb-vps-tunnel.ps1")
        return 1

    from database import DB_ENGINE, init_db

    if DB_ENGINE != "sqlite":
        print(f"KORYMB_DB_ENGINE={DB_ENGINE}. backend/.env.local doit valoir sqlite.")
        source.close()
        return 1

    print("Initialisation du schema SQLite...")
    DB_FILE.parent.mkdir(parents=True, exist_ok=True)
    init_db()
    dest = sqlite3.connect(str(DB_FILE))
    _align_enterprise_memory(dest)
    try:
        with source.cursor() as cur:
            print("Copie...")
            for table in FULL_TABLES:
                _copy_table(cur, dest, table)
            limited_rows: dict[str, list[dict]] = {}
            for table, order, limit in LIMITED_TABLES:
                limited_rows[table] = _copy_table(cur, dest, table, order=order, limit=limit)

            dependents = (
                ("mission_events", "job_id", _ids(limited_rows.get("jobs") or []), 1500),
                ("action_events", "ticket_id", _ids(limited_rows.get("action_tickets") or []), 200),
                (
                    "biz_email_messages",
                    "thread_id",
                    _ids(limited_rows.get("biz_email_threads") or []),
                    80,
                ),
            )
            for table, key, ids, limit in dependents:
                maria_cols = _maria_columns(cur, table)
                sqlite_cols = _sqlite_columns(dest, table)
                if maria_cols is None:
                    print(f"  {table}: absente sur MariaDB")
                    continue
                if sqlite_cols is None:
                    print(f"  {table}: absente sur SQLite")
                    continue
                columns = _shared_columns(maria_cols, sqlite_cols)
                try:
                    rows = _fetch_in(cur, table, columns, key, ids, limit)
                    count = _replace(dest, table, columns, rows)
                except Exception as exc:
                    dest.rollback()
                    print(f"  {table}: echec ({exc})")
                    continue
                print(f"  {table}: {count}")
    finally:
        dest.close()
        source.close()

    print(f"Extrait ecrit dans {DB_FILE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
