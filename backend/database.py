"""
database.py — Persistance SQLite pour l'historique des jobs.
"""
import sqlite3
import json
from pathlib import Path
from datetime import datetime

DB_PATH = Path(__file__).parent / "data" / "korymb.db"


def get_conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS jobs (
                id           TEXT PRIMARY KEY,
                agent        TEXT NOT NULL,
                mission      TEXT NOT NULL,
                status       TEXT NOT NULL DEFAULT 'running',
                result       TEXT,
                logs         TEXT DEFAULT '[]',
                tokens_in    INTEGER DEFAULT 0,
                tokens_out   INTEGER DEFAULT 0,
                created_at   TEXT NOT NULL,
                updated_at   TEXT NOT NULL
            )
        """)
        conn.commit()


def save_job(job_id: str, agent: str, mission: str):
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO jobs (id, agent, mission, status, logs, created_at, updated_at) "
            "VALUES (?, ?, ?, 'running', '[]', ?, ?)",
            (job_id, agent, mission, now, now)
        )
        conn.commit()


def update_job(job_id: str, status: str, result: str | None = None, logs: list | None = None,
               tokens_in: int = 0, tokens_out: int = 0):
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        conn.execute(
            "UPDATE jobs SET status=?, result=?, logs=?, tokens_in=?, tokens_out=?, updated_at=? WHERE id=?",
            (status, result, json.dumps(logs or [], ensure_ascii=False), tokens_in, tokens_out, now, job_id)
        )
        conn.commit()


def get_job(job_id: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
    if not row:
        return None
    d = dict(row)
    d["logs"] = json.loads(d.get("logs") or "[]")
    return d


def list_jobs(limit: int = 50) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
    result = []
    for row in rows:
        d = dict(row)
        d["logs"] = json.loads(d.get("logs") or "[]")
        result.append(d)
    return result
