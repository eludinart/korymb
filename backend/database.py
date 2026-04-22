"""
database.py — Persistance backend (SQLite par défaut, MariaDB optionnel).

Colonnes d'observabilité (plan CIO, flux d'événements) : extensibles vers
pagination / table events séparée sans casser l'API si on garde events_json
comme projection matérialisée.
"""
import json
import os
import re
import sqlite3
from pathlib import Path
from datetime import datetime
from typing import Any
from dotenv import load_dotenv

try:
    import pymysql
    _PYMYSQL_OK = True
except Exception:
    pymysql = None  # type: ignore[assignment]
    _PYMYSQL_OK = False

DB_PATH = Path(__file__).parent / "data" / "korymb.db"
# Source de vérité config backend
load_dotenv(Path(__file__).with_name(".env"), override=True)
DB_ENGINE = str(os.getenv("KORYMB_DB_ENGINE", "sqlite")).strip().lower()


def _is_mariadb() -> bool:
    return DB_ENGINE in {"mariadb", "mysql"}


def _maria_cfg() -> dict[str, Any]:
    return {
        "host": str(os.getenv("KORYMB_DB_HOST") or os.getenv("FLEUR_DB_HOST") or "127.0.0.1"),
        "port": int(os.getenv("KORYMB_DB_PORT") or os.getenv("FLEUR_DB_PORT") or "3306"),
        "user": str(os.getenv("KORYMB_DB_USER") or os.getenv("FLEUR_DB_USER") or ""),
        "password": str(os.getenv("KORYMB_DB_PASSWORD") or os.getenv("FLEUR_DB_PASSWORD") or ""),
        "database": str(os.getenv("KORYMB_DB_NAME") or os.getenv("FLEUR_DB_NAME") or "korymb"),
        "charset": "utf8mb4",
        "connect_timeout": 5,
        "read_timeout": 10,
        "write_timeout": 10,
        "autocommit": False,
    }


def _qmark_to_percent(sql: str) -> str:
    return sql.replace("?", "%s")


class _MariaRow(dict):
    def __init__(self, data: dict[str, Any], order: list[str]):
        super().__init__(data)
        self._order = order

    def __getitem__(self, key):  # type: ignore[override]
        if isinstance(key, int):
            if key < 0 or key >= len(self._order):
                raise IndexError(key)
            return dict.__getitem__(self, self._order[key])
        return dict.__getitem__(self, key)


class _MariaCursorAdapter:
    def __init__(self, cur):
        self._cur = cur
        self.rowcount = int(getattr(cur, "rowcount", 0) or 0)

    def _row_to_adapter(self, row: dict[str, Any] | None):
        if row is None:
            return None
        order = list(row.keys())
        return _MariaRow(row, order)

    def fetchone(self):
        return self._row_to_adapter(self._cur.fetchone())

    def fetchall(self):
        rows = self._cur.fetchall() or []
        return [self._row_to_adapter(r) for r in rows]


class _MariaConnAdapter:
    def __init__(self, conn):
        self._conn = conn

    def execute(self, sql: str, params: tuple | list | None = None):
        sql_use = _qmark_to_percent(sql)
        # Compat SQLite -> MariaDB
        if "INSERT OR REPLACE INTO" in sql_use:
            sql_use = sql_use.replace("INSERT OR REPLACE INTO", "REPLACE INTO")
        cur = self._conn.cursor(pymysql.cursors.DictCursor)
        cur.execute(sql_use, tuple(params or ()))
        return _MariaCursorAdapter(cur)

    def commit(self) -> None:
        self._conn.commit()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        try:
            if exc is not None:
                self._conn.rollback()
        finally:
            self._conn.close()


def get_conn():
    if _is_mariadb():
        if not _PYMYSQL_OK:
            raise RuntimeError("KORYMB_DB_ENGINE=mariadb mais pymysql n'est pas installé.")
        return _MariaConnAdapter(pymysql.connect(**_maria_cfg()))
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_jobs_columns(conn) -> None:
    """Ajoute les colonnes manquantes si la DB a été créée avec une ancienne version."""
    if _is_mariadb():
        cur = conn.execute("SHOW COLUMNS FROM jobs")
        cols = {str(row["Field"]) for row in cur.fetchall()}
    else:
        cur = conn.execute("PRAGMA table_info(jobs)")
        cols = {row[1] for row in cur.fetchall()}
    if "tokens_in" not in cols:
        conn.execute("ALTER TABLE jobs ADD COLUMN tokens_in INTEGER DEFAULT 0")
    if "tokens_out" not in cols:
        conn.execute("ALTER TABLE jobs ADD COLUMN tokens_out INTEGER DEFAULT 0")
    if "team_trace" not in cols:
        conn.execute("ALTER TABLE jobs ADD COLUMN team_trace TEXT DEFAULT '[]'")
    if "source" not in cols:
        conn.execute("ALTER TABLE jobs ADD COLUMN source TEXT NOT NULL DEFAULT 'mission'")
    if "plan_json" not in cols:
        conn.execute("ALTER TABLE jobs ADD COLUMN plan_json TEXT NOT NULL DEFAULT '{}'")
    if "events_json" not in cols:
        conn.execute("ALTER TABLE jobs ADD COLUMN events_json TEXT NOT NULL DEFAULT '[]'")
    if "user_validated_at" not in cols:
        conn.execute("ALTER TABLE jobs ADD COLUMN user_validated_at TEXT")
    if "mission_config_json" not in cols:
        conn.execute("ALTER TABLE jobs ADD COLUMN mission_config_json TEXT NOT NULL DEFAULT '{}'")
    if "mission_thread_json" not in cols:
        conn.execute("ALTER TABLE jobs ADD COLUMN mission_thread_json TEXT NOT NULL DEFAULT '[]'")
    if "parent_job_id" not in cols:
        conn.execute("ALTER TABLE jobs ADD COLUMN parent_job_id TEXT")
    if "chat_session_id" not in cols:
        conn.execute("ALTER TABLE jobs ADD COLUMN chat_session_id TEXT")


def _ensure_memory_columns(conn) -> None:
    """MariaDB: élargit les colonnes mémoire pour éviter les erreurs 'Data too long'."""
    if not _is_mariadb():
        return
    # Les mémoires peuvent dépasser 64KB ; LONGTEXT évite les 500 lors des PUT /memory.
    try:
        conn.execute("ALTER TABLE enterprise_memory MODIFY COLUMN contexts_json LONGTEXT NOT NULL")
    except Exception:
        pass
    try:
        conn.execute("ALTER TABLE enterprise_memory MODIFY COLUMN recent_missions_json LONGTEXT NOT NULL")
    except Exception:
        pass
    try:
        conn.execute("ALTER TABLE memory_history MODIFY COLUMN contexts_json LONGTEXT NOT NULL")
    except Exception:
        pass


def _hydrate_job_row(d: dict) -> dict:
    """Normalise les champs JSON pour l'application."""
    out = dict(d)
    out["logs"] = json.loads(out.get("logs") or "[]")
    out["team"] = json.loads(out.get("team_trace") or "[]")
    try:
        out["plan"] = json.loads(out.get("plan_json") or "{}")
    except json.JSONDecodeError:
        out["plan"] = {}
    try:
        out["events"] = json.loads(out.get("events_json") or "[]")
    except json.JSONDecodeError:
        out["events"] = []
    try:
        mc = json.loads(out.get("mission_config_json") or "{}")
    except json.JSONDecodeError:
        mc = {}
    if not isinstance(mc, dict):
        mc = {}
    base_cfg = {
        "recursive_refinement_enabled": False,
        "recursive_max_rounds": 0,
        "require_user_validation": True,
        "mode": "cio",
        "cio_questions_enabled": True,
        "cio_plan_hitl_enabled": True,
    }
    merged = {**base_cfg, **{k: v for k, v in mc.items() if k in base_cfg}}
    merged["recursive_refinement_enabled"] = bool(merged.get("recursive_refinement_enabled"))
    try:
        merged["recursive_max_rounds"] = max(0, min(12, int(merged.get("recursive_max_rounds") or 0)))
    except (TypeError, ValueError):
        merged["recursive_max_rounds"] = 0
    if "require_user_validation" in mc:
        merged["require_user_validation"] = bool(mc.get("require_user_validation"))
    else:
        merged["require_user_validation"] = True
    if "mode" in mc and str(mc.get("mode") or "cio") in ("cio", "triad", "single"):
        merged["mode"] = str(mc["mode"])
    else:
        merged["mode"] = "cio"
    merged["cio_questions_enabled"] = bool(merged.get("cio_questions_enabled", True))
    merged["cio_plan_hitl_enabled"] = bool(merged.get("cio_plan_hitl_enabled", True))
    out["mission_config"] = merged
    out.pop("plan_json", None)
    out.pop("events_json", None)
    out.pop("team_trace", None)
    out.pop("mission_config_json", None)
    try:
        mt = json.loads(out.get("mission_thread_json") or "[]")
    except json.JSONDecodeError:
        mt = []
    if not isinstance(mt, list):
        mt = []
    out["mission_thread"] = mt
    out.pop("mission_thread_json", None)
    raw_hres = out.get("hitl_resolution_json")
    if raw_hres:
        try:
            parsed_h = json.loads(raw_hres) if isinstance(raw_hres, str) else raw_hres
            out["hitl_resolution"] = parsed_h if isinstance(parsed_h, dict) else None
        except json.JSONDecodeError:
            out["hitl_resolution"] = None
    else:
        out["hitl_resolution"] = None
    out.pop("hitl_resolution_json", None)
    return out


def init_db():
    with get_conn() as conn:
        text_pk = "VARCHAR(191)" if _is_mariadb() else "TEXT"
        memory_pk = "BIGINT PRIMARY KEY AUTO_INCREMENT" if _is_mariadb() else "INTEGER PRIMARY KEY AUTOINCREMENT"
        conn.execute("""
            CREATE TABLE IF NOT EXISTS jobs (
                id            """ + text_pk + """ PRIMARY KEY,
                agent         TEXT NOT NULL,
                mission       TEXT NOT NULL,
                status        TEXT NOT NULL DEFAULT 'running',
                result        TEXT,
                logs          TEXT DEFAULT '[]',
                tokens_in     INTEGER DEFAULT 0,
                tokens_out    INTEGER DEFAULT 0,
                team_trace    TEXT DEFAULT '[]',
                source        TEXT NOT NULL DEFAULT 'mission',
                plan_json     TEXT NOT NULL DEFAULT '{}',
                events_json   TEXT NOT NULL DEFAULT '[]',
                created_at      TEXT NOT NULL,
                updated_at      TEXT NOT NULL,
                parent_job_id   TEXT,
                chat_session_id TEXT
            )
        """)
        _ensure_jobs_columns(conn)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS mission_sessions (
                id              """ + text_pk + """ PRIMARY KEY,
                agent           TEXT NOT NULL,
                title           TEXT NOT NULL DEFAULT '',
                status          TEXT NOT NULL DEFAULT 'draft',
                messages        TEXT NOT NULL DEFAULT '[]',
                linked_job_id   TEXT,
                validated_brief TEXT,
                created_at      TEXT NOT NULL,
                updated_at      TEXT NOT NULL
            )
        """)
        _ensure_llm_usage_table(conn)
        _ensure_custom_agents_table(conn)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS mission_templates (
                id              """ + text_pk + """ PRIMARY KEY,
                name            TEXT NOT NULL,
                description     TEXT NOT NULL DEFAULT '',
                agent           TEXT NOT NULL DEFAULT 'coordinateur',
                mission_text    TEXT NOT NULL,
                variables_json  TEXT NOT NULL DEFAULT '[]',
                config_json     TEXT NOT NULL DEFAULT '{}',
                created_at      TEXT NOT NULL,
                updated_at      TEXT NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS memory_history (
                id              """ + memory_pk + """,
                contexts_json   TEXT NOT NULL,
                comment         TEXT NOT NULL DEFAULT '',
                created_at      TEXT NOT NULL
            )
        """)
        _ensure_memory_columns(conn)
        conn.commit()
    init_enterprise_memory_row()
    _init_autonomous_tables()
    # Graphe de connaissance entités (import tardif pour éviter les cycles)
    try:
        from services.knowledge import init_knowledge_table
        init_knowledge_table()
    except Exception:
        pass  # non bloquant au démarrage


def _ensure_llm_usage_table(conn) -> None:
    if _is_mariadb():
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS llm_usage_events (
                id              BIGINT PRIMARY KEY AUTO_INCREMENT,
                created_at      TEXT NOT NULL,
                job_id          TEXT,
                context_label   TEXT NOT NULL,
                tier            TEXT NOT NULL,
                model           TEXT NOT NULL,
                provider        TEXT NOT NULL,
                tokens_in       INTEGER NOT NULL DEFAULT 0,
                tokens_out      INTEGER NOT NULL DEFAULT 0,
                cost_usd        DOUBLE NOT NULL DEFAULT 0
            )
            """
        )
        try:
            conn.execute("CREATE INDEX IF NOT EXISTS idx_llm_usage_created_at ON llm_usage_events(created_at)")
        except Exception:
            pass
        return
    cur = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='llm_usage_events'",
    ).fetchone()
    if cur:
        return
    conn.execute(
        """
        CREATE TABLE llm_usage_events (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at      TEXT NOT NULL,
            job_id          TEXT,
            context_label   TEXT NOT NULL DEFAULT '',
            tier            TEXT NOT NULL DEFAULT '',
            model           TEXT NOT NULL DEFAULT '',
            provider        TEXT NOT NULL DEFAULT '',
            tokens_in       INTEGER NOT NULL DEFAULT 0,
            tokens_out      INTEGER NOT NULL DEFAULT 0,
            cost_usd        REAL NOT NULL DEFAULT 0
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_llm_usage_created_at ON llm_usage_events(created_at)",
    )


def log_llm_usage_event(
    *,
    job_id: str | None,
    context_label: str,
    tier: str,
    model: str,
    provider: str,
    tokens_in: int,
    tokens_out: int,
    cost_usd: float,
) -> None:
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        _ensure_llm_usage_table(conn)
        conn.execute(
            "INSERT INTO llm_usage_events (created_at, job_id, context_label, tier, model, provider, "
            "tokens_in, tokens_out, cost_usd) VALUES (?,?,?,?,?,?,?,?,?)",
            (
                now,
                (job_id or "")[:16] or None,
                (context_label or "")[:120],
                (tier or "")[:32],
                (model or "")[:200],
                (provider or "")[:24],
                int(tokens_in),
                int(tokens_out),
                float(cost_usd),
            ),
        )
        conn.commit()


def usage_events_exist() -> bool:
    with get_conn() as conn:
        _ensure_llm_usage_table(conn)
        row = conn.execute("SELECT 1 FROM llm_usage_events LIMIT 1").fetchone()
    return row is not None


def usage_cost_breakdown() -> dict[str, float | int]:
    """Agrégats de coût (USD) et tokens depuis llm_usage_events (horodatage UTC-ish)."""
    from datetime import date, datetime, timedelta

    now = datetime.now()
    today_s = date.today().isoformat()
    since_week = (now - timedelta(days=7)).isoformat()
    month_start = datetime.combine(date.today().replace(day=1), datetime.min.time()).isoformat()
    since_hour = (now - timedelta(hours=1)).isoformat()
    since_minute = (now - timedelta(minutes=1)).isoformat()

    def _sum(conn, where: str, params: tuple = ()) -> tuple[float, int, int]:
        row = conn.execute(
            f"SELECT COALESCE(SUM(cost_usd),0), COALESCE(SUM(tokens_in),0), COALESCE(SUM(tokens_out),0) "
            f"FROM llm_usage_events WHERE {where}",
            params,
        ).fetchone()
        if not row:
            return 0.0, 0, 0
        return float(row[0] or 0), int(row[1] or 0), int(row[2] or 0)

    with get_conn() as conn:
        _ensure_llm_usage_table(conn)
        total_c, total_in, total_out = _sum(conn, "1=1")
        day_c, day_in, day_out = _sum(conn, "substr(created_at,1,10) = ?", (today_s,))
        week_c, week_in, week_out = _sum(conn, "created_at >= ?", (since_week,))
        month_c, month_in, month_out = _sum(conn, "created_at >= ?", (month_start,))
        hour_c, hour_in, hour_out = _sum(conn, "created_at >= ?", (since_hour,))
        min_c, min_in, min_out = _sum(conn, "created_at >= ?", (since_minute,))

    return {
        "cost_total_usd": round(total_c, 6),
        "cost_today_usd": round(day_c, 6),
        "cost_week_usd": round(week_c, 6),
        "cost_month_usd": round(month_c, 6),
        "cost_last_hour_usd": round(hour_c, 6),
        "cost_last_minute_usd": round(min_c, 6),
        "usage_tokens_today": int(day_in + day_out),
        "usage_tokens_week": int(week_in + week_out),
        "usage_tokens_month": int(month_in + month_out),
        "usage_tokens_total": int(total_in + total_out),
        "usage_tokens_last_hour": int(hour_in + hour_out),
        "usage_tokens_last_minute": int(min_in + min_out),
    }


def usage_daily_breakdown(days: int = 7) -> list[dict]:
    """Retourne le coût et les tokens par jour sur les `days` derniers jours (ordre croissant)."""
    from datetime import date, timedelta

    result = []
    today = date.today()
    with get_conn() as conn:
        _ensure_llm_usage_table(conn)
        for i in range(days - 1, -1, -1):
            d = (today - timedelta(days=i)).isoformat()
            row = conn.execute(
                "SELECT COALESCE(SUM(cost_usd),0), COALESCE(SUM(tokens_in),0), COALESCE(SUM(tokens_out),0) "
                "FROM llm_usage_events WHERE substr(created_at,1,10) = ?",
                (d,),
            ).fetchone()
            cost = float(row[0] or 0) if row else 0.0
            ti = int(row[1] or 0) if row else 0
            to = int(row[2] or 0) if row else 0
            result.append({"date": d, "cost_usd": round(cost, 6), "tokens": ti + to})
    return result


def append_job_mission_thread(
    job_id: str,
    *,
    role: str,
    agent: str,
    content: str,
    source: str = "chat",
) -> None:
    """Ajoute un message au fil lié à une mission (chat dirigeant ↔ agents, visible dans le QG)."""
    row = get_job(job_id)
    if not row:
        return
    cur = row.get("mission_thread")
    if not isinstance(cur, list):
        cur = []
    entry = {
        "ts": datetime.utcnow().isoformat(),
        "role": (role or "")[:32],
        "agent": (agent or "")[:32],
        "source": (source or "chat")[:32],
        "content": (content or "")[:12000],
    }
    cur.append(entry)
    cur = cur[-200:]
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        conn.execute(
            "UPDATE jobs SET mission_thread_json=?, updated_at=? WHERE id=?",
            (json.dumps(cur, ensure_ascii=False), now, job_id),
        )
        conn.commit()


def save_job(
    job_id: str,
    agent: str,
    mission: str,
    source: str = "mission",
    mission_config: dict | None = None,
    parent_job_id: str | None = None,
    chat_session_id: str | None = None,
):
    now = datetime.utcnow().isoformat()
    cfg_json = json.dumps(mission_config if isinstance(mission_config, dict) else {}, ensure_ascii=False)
    parent = (parent_job_id or "").strip()[:16] or None
    session_id = (chat_session_id or "").strip()[:64] or None
    with get_conn() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO jobs (id, agent, mission, status, logs, team_trace, "
            "source, plan_json, events_json, mission_config_json, mission_thread_json, parent_job_id, chat_session_id, created_at, updated_at) "
            "VALUES (?, ?, ?, 'running', '[]', '[]', ?, '{}', '[]', ?, '[]', ?, ?, ?, ?)",
            (job_id, agent, mission, source, cfg_json, parent, session_id, now, now),
        )
        conn.commit()


def update_job(
    job_id: str,
    status: str,
    result: str | None = None,
    logs: list | None = None,
    tokens_in: int = 0,
    tokens_out: int = 0,
    team_trace: list | None = None,
    plan: dict | None = None,
    events: list | None = None,
    source: str | None = None,
    mission_config: dict | None = None,
):
    now = datetime.utcnow().isoformat()
    team_json = json.dumps(team_trace if team_trace is not None else [], ensure_ascii=False)
    logs_json = json.dumps(logs or [], ensure_ascii=False)

    sets = [
        "status=?",
        "result=?",
        "logs=?",
        "tokens_in=?",
        "tokens_out=?",
        "team_trace=?",
        "updated_at=?",
    ]
    vals: list = [
        status,
        result,
        logs_json,
        tokens_in,
        tokens_out,
        team_json,
        now,
    ]
    if plan is not None:
        sets.append("plan_json=?")
        vals.append(json.dumps(plan, ensure_ascii=False))
    if events is not None:
        sets.append("events_json=?")
        vals.append(json.dumps(events, ensure_ascii=False))
    if source is not None:
        sets.append("source=?")
        vals.append(source)
    if mission_config is not None:
        sets.append("mission_config_json=?")
        vals.append(json.dumps(mission_config, ensure_ascii=False))
    vals.append(job_id)

    with get_conn() as conn:
        conn.execute(f"UPDATE jobs SET {', '.join(sets)} WHERE id=?", vals)
        conn.commit()


def get_job(job_id: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
    if not row:
        return None
    return _hydrate_job_row(dict(row))


def list_jobs(limit: int = 50) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
    return [_hydrate_job_row(dict(row)) for row in rows]


def list_jobs_prompt_digest(*, limit: int = 12, exclude_job_id: str | None = None) -> list[dict]:
    """
    Lignes jobs légères (sans hydratation JSON lourde) pour injection dans le prompt CIO :
    missions terminées ou annulées avec un résultat exploitable.
    """
    lim = max(1, min(20, int(limit)))
    overfetch = min(60, lim * 4)
    ex = (exclude_job_id or "").strip()
    with get_conn() as conn:
        if ex:
            rows = conn.execute(
                "SELECT id, agent, mission, status, result, created_at, source FROM jobs "
                "WHERE id != ? ORDER BY created_at DESC LIMIT ?",
                (ex, overfetch),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, agent, mission, status, result, created_at, source FROM jobs "
                "ORDER BY created_at DESC LIMIT ?",
                (overfetch,),
            ).fetchall()
    out: list[dict] = []
    for row in rows or []:
        d = dict(row)
        st = str(d.get("status") or "")
        res = d.get("result")
        txt = res.strip() if isinstance(res, str) else ""
        if st not in ("completed", "cancelled"):
            continue
        if st == "cancelled" and not txt:
            continue
        out.append({
            "id": str(d.get("id") or ""),
            "agent": str(d.get("agent") or ""),
            "mission": str(d.get("mission") or ""),
            "status": st,
            "result": txt,
            "created_at": str(d.get("created_at") or ""),
            "source": str(d.get("source") or ""),
        })
        if len(out) >= lim:
            break
    return out


def sum_jobs_tokens_total() -> int:
    """Somme des tokens enregistrés sur toutes les missions (persistées)."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT COALESCE(SUM(tokens_in + tokens_out), 0) AS t FROM jobs",
        ).fetchone()
    return int(row["t"] or 0) if row else 0


def job_set_user_validated(job_id: str) -> bool:
    """Marque la mission comme clôturée par le dirigeant (pipeline déjà completed)."""
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        cur = conn.execute(
            "UPDATE jobs SET user_validated_at = ?, updated_at = ? "
            "WHERE id = ? AND status = 'completed' AND user_validated_at IS NULL",
            (now, now, job_id),
        )
        conn.commit()
        return cur.rowcount > 0


def job_set_awaiting_hitl(job_id: str, gate_payload: dict) -> bool:
    """Suspend le job en attente de validation HITL humaine."""
    now = datetime.utcnow().isoformat()
    gate_json = json.dumps(gate_payload, ensure_ascii=False)
    with get_conn() as conn:
        _ensure_jobs_hitl_column(conn)
        cur = conn.execute(
            "UPDATE jobs SET status = 'awaiting_validation', hitl_gate_json = ?, hitl_resolved_at = NULL, "
            "hitl_comment = '', hitl_resolution_json = NULL, updated_at = ? "
            "WHERE id = ? AND status = 'running'",
            (gate_json, now, job_id),
        )
        conn.commit()
        return int(getattr(cur, "rowcount", 0) or 0) > 0


def job_resume_after_hitl(
    job_id: str,
    *,
    approved: bool | None = None,
    comment: str = "",
    decision: str | None = None,
    resolution: dict | None = None,
) -> bool:
    """Reprend ou annule un job suspendu en attente HITL.

    decision : approve | reject | amend (prioritaire sur approved legacy).
    resolution : pour amend — ex. {"amended_plan": {...}, "feedback": "..."}.
    """
    dec = (decision or "").strip().lower()
    if dec not in ("approve", "reject", "amend"):
        if approved is False:
            dec = "reject"
        else:
            dec = "approve"
    if dec == "reject":
        new_status = "cancelled"
        res_blob = None
    else:
        new_status = "running"
        if dec == "amend" and isinstance(resolution, dict) and resolution:
            res_blob = json.dumps(resolution, ensure_ascii=False)
        else:
            res_blob = None
    now = datetime.utcnow().isoformat()
    comment_s = (comment or "")[:8000]
    with get_conn() as conn:
        _ensure_jobs_hitl_column(conn)
        cur = conn.execute(
            "UPDATE jobs SET status = ?, hitl_resolved_at = ?, hitl_comment = ?, hitl_resolution_json = ?, "
            "updated_at = ? WHERE id = ? AND status = 'awaiting_validation'",
            (new_status, now, comment_s, res_blob, now, job_id),
        )
        conn.commit()
        return int(getattr(cur, "rowcount", 0) or 0) > 0


def get_hitl_gate(job_id: str) -> dict | None:
    """Retourne le payload de la gate HITL pour un job, ou None."""
    with get_conn() as conn:
        _ensure_jobs_hitl_column(conn)
        row = conn.execute(
            "SELECT hitl_gate_json, hitl_resolved_at, hitl_comment, hitl_resolution_json FROM jobs WHERE id = ?",
            (job_id,),
        ).fetchone()
    if not row:
        return None
    d = dict(row)
    try:
        gate = json.loads(d.get("hitl_gate_json") or "{}")
    except json.JSONDecodeError:
        gate = {}
    res: dict | None = None
    raw_res = d.get("hitl_resolution_json")
    if raw_res:
        try:
            parsed = json.loads(raw_res)
            res = parsed if isinstance(parsed, dict) else None
        except json.JSONDecodeError:
            res = None
    return {
        "gate": gate,
        "resolved_at": d.get("hitl_resolved_at"),
        "comment": d.get("hitl_comment"),
        "resolution": res,
    }


def _ensure_jobs_hitl_column(conn) -> None:
    """Ajoute les colonnes HITL si absentes (migration non-destructive)."""
    if _is_mariadb():
        cur = conn.execute("SHOW COLUMNS FROM jobs")
        cols = {str(row["Field"]) for row in cur.fetchall()}
    else:
        cur = conn.execute("PRAGMA table_info(jobs)")
        cols = {row[1] for row in cur.fetchall()}
    if "hitl_gate_json" not in cols:
        conn.execute("ALTER TABLE jobs ADD COLUMN hitl_gate_json TEXT")
    if "hitl_resolved_at" not in cols:
        conn.execute("ALTER TABLE jobs ADD COLUMN hitl_resolved_at TEXT")
    if "hitl_comment" not in cols:
        conn.execute("ALTER TABLE jobs ADD COLUMN hitl_comment TEXT")
    if "hitl_resolution_json" not in cols:
        conn.execute("ALTER TABLE jobs ADD COLUMN hitl_resolution_json TEXT")
    conn.commit()


def _hydrate_session_row(d: dict) -> dict:
    out = dict(d)
    try:
        out["messages"] = json.loads(out.get("messages") or "[]")
    except json.JSONDecodeError:
        out["messages"] = []
    return out


def create_mission_session(session_id: str, agent: str, title: str = "") -> None:
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO mission_sessions (id, agent, title, status, messages, linked_job_id, validated_brief, created_at, updated_at) "
            "VALUES (?, ?, ?, 'draft', '[]', NULL, NULL, ?, ?)",
            (session_id, agent, title or "", now, now),
        )
        conn.commit()


def get_mission_session(session_id: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM mission_sessions WHERE id=?", (session_id,)).fetchone()
    if not row:
        return None
    return _hydrate_session_row(dict(row))


def list_mission_sessions(limit: int = 40) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM mission_sessions ORDER BY updated_at DESC LIMIT ?", (limit,)
        ).fetchall()
    return [_hydrate_session_row(dict(row)) for row in rows]


def append_session_message(session_id: str, role: str, content: str) -> dict | None:
    row = get_mission_session(session_id)
    if not row:
        return None
    msgs = list(row["messages"])
    msgs.append({"role": role, "content": content, "ts": datetime.utcnow().isoformat()})
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        conn.execute(
            "UPDATE mission_sessions SET messages=?, updated_at=? WHERE id=?",
            (json.dumps(msgs, ensure_ascii=False), now, session_id),
        )
        conn.commit()
    return {**row, "messages": msgs}


def mission_session_commit(
    session_id: str,
    linked_job_id: str,
    validated_brief: str,
    closing_message: str | None = None,
) -> None:
    row = get_mission_session(session_id)
    if not row:
        return
    msgs = list(row["messages"])
    if closing_message:
        msgs.append({"role": "assistant", "content": closing_message, "ts": datetime.utcnow().isoformat()})
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        conn.execute(
            "UPDATE mission_sessions SET status=?, linked_job_id=?, validated_brief=?, messages=?, updated_at=? WHERE id=?",
            (
                "committed",
                linked_job_id,
                validated_brief,
                json.dumps(msgs, ensure_ascii=False),
                now,
                session_id,
            ),
        )
        conn.commit()


def delete_mission_session(session_id: str) -> bool:
    """Supprime une ligne mission_sessions. Retourne True si une ligne a été effacée."""
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM mission_sessions WHERE id=?", (session_id,))
        conn.commit()
        return cur.rowcount > 0


_CONTEXT_KEYS_LEGACY = frozenset(
    {"global", "commercial", "community_manager", "developpeur", "comptable"},
)

CUSTOM_AGENT_KEY_RE = re.compile(r"^[a-z][a-z0-9_]{1,47}$")
_CUSTOM_AGENT_RESERVED = frozenset(
    {"global", "coordinateur", "commercial", "community_manager", "developpeur", "comptable"},
)
ALLOWED_AGENT_TOOL_TAGS: frozenset[str] = frozenset(
    {"web", "linkedin", "email", "instagram", "facebook", "drive", "knowledge", "validate", "db"},
)


def _ensure_custom_agents_table(conn) -> None:
    agent_pk = "VARCHAR(191)" if _is_mariadb() else "TEXT"
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS custom_agents (
            agent_key """ + agent_pk + """ PRIMARY KEY,
            label TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT '',
            system_prompt TEXT NOT NULL,
            tools_json TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )


def list_custom_agent_keys_raw() -> list[str]:
    with get_conn() as conn:
        _ensure_custom_agents_table(conn)
        rows = conn.execute("SELECT agent_key FROM custom_agents ORDER BY agent_key").fetchall()
    out: list[str] = []
    for r in rows or []:
        try:
            k = r["agent_key"]
        except (TypeError, KeyError, IndexError):
            k = r[0] if r else ""
        if k:
            out.append(str(k))
    return out


def _memory_context_allowed_keys() -> frozenset[str]:
    return _CONTEXT_KEYS_LEGACY | frozenset(list_custom_agent_keys_raw())


def validate_custom_agent_key(raw: str) -> tuple[str, str | None]:
    s = (raw or "").strip().lower().replace("-", "_")
    if not s:
        return "", "clé vide"
    if not CUSTOM_AGENT_KEY_RE.match(s):
        return (
            "",
            "clé invalide : 2 à 48 caractères, minuscules, chiffres et underscores, commence par une lettre",
        )
    if s in _CUSTOM_AGENT_RESERVED:
        return "", f"clé réservée ou déjà utilisée par un rôle intégré : {s}"
    return s, None


def fetch_custom_agents_definitions_merge_shape() -> dict[str, dict[str, Any]]:
    """Forme compatible avec BUILTIN_AGENTS_DEF (system, label, role, tools, is_manager)."""
    with get_conn() as conn:
        _ensure_custom_agents_table(conn)
        rows = conn.execute(
            "SELECT agent_key, label, role, system_prompt, tools_json FROM custom_agents ORDER BY agent_key"
        ).fetchall()
    out: dict[str, dict[str, Any]] = {}
    for row in rows or []:
        d = dict(row)
        key = str(d.get("agent_key") or "").strip()
        if not key:
            continue
        try:
            tools_raw = json.loads(d.get("tools_json") or "[]")
        except json.JSONDecodeError:
            tools_raw = []
        if not isinstance(tools_raw, list):
            tools_raw = []
        tools = [str(x).strip() for x in tools_raw if str(x).strip() in ALLOWED_AGENT_TOOL_TAGS]
        label = str(d.get("label") or key).strip() or key
        role = str(d.get("role") or "").strip()
        system = str(d.get("system_prompt") or "").strip()
        out[key] = {
            "label": label,
            "role": role,
            "tools": tools,
            "is_manager": False,
            "system": system + ("\n\n" if system and not system.endswith("\n") else ""),
        }
    return out


def upsert_custom_agent(
    agent_key: str,
    *,
    label: str,
    role: str,
    system_prompt: str,
    tools: list[str],
) -> None:
    canon, err = validate_custom_agent_key(agent_key)
    if err:
        raise ValueError(err)
    tools_f = [str(t).strip() for t in (tools or []) if str(t).strip() in ALLOWED_AGENT_TOOL_TAGS]
    now = datetime.utcnow().isoformat()
    sys_clean = (system_prompt or "").strip()
    if not sys_clean:
        raise ValueError("prompt / périmètre (system) vide")
    lab = (label or "").strip() or canon
    role_s = (role or "").strip()
    with get_conn() as conn:
        _ensure_custom_agents_table(conn)
        prev = conn.execute("SELECT created_at FROM custom_agents WHERE agent_key=?", (canon,)).fetchone()
        created = now
        if prev is not None:
            try:
                created = str(dict(prev)["created_at"])
            except Exception:
                try:
                    created = str(prev[0])
                except Exception:
                    created = now
        conn.execute(
            "INSERT OR REPLACE INTO custom_agents "
            "(agent_key, label, role, system_prompt, tools_json, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (canon, lab, role_s, sys_clean, json.dumps(tools_f, ensure_ascii=False), created, now),
        )
        conn.commit()


def delete_custom_agent(agent_key: str) -> bool:
    canon, err = validate_custom_agent_key(agent_key)
    if err:
        raise ValueError(err)
    with get_conn() as conn:
        _ensure_custom_agents_table(conn)
        cur = conn.execute("DELETE FROM custom_agents WHERE agent_key=?", (canon,))
        conn.commit()
        return int(getattr(cur, "rowcount", 0) or 0) > 0


def init_enterprise_memory_row() -> None:
    """Table singleton : contexte entreprise + fil des missions récentes."""
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS enterprise_memory (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                contexts_json TEXT NOT NULL DEFAULT '{}',
                recent_missions_json TEXT NOT NULL DEFAULT '[]',
                updated_at TEXT NOT NULL
            )
            """
        )
        row = conn.execute("SELECT id FROM enterprise_memory WHERE id=1").fetchone()
        if not row:
            conn.execute(
                "INSERT INTO enterprise_memory (id, contexts_json, recent_missions_json, updated_at) "
                "VALUES (1, '{}', '[]', ?)",
                (now,),
            )
        conn.commit()


def get_enterprise_memory() -> dict:
    init_enterprise_memory_row()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT contexts_json, recent_missions_json, updated_at FROM enterprise_memory WHERE id=1",
        ).fetchone()
    allowed = _memory_context_allowed_keys()
    if not row:
        return {"contexts": {k: "" for k in allowed}, "recent_missions": [], "updated_at": None}
    try:
        ctx = json.loads(row["contexts_json"] or "{}")
    except json.JSONDecodeError:
        ctx = {}
    if not isinstance(ctx, dict):
        ctx = {}
    base = {k: "" for k in allowed}
    for k, v in ctx.items():
        if k in allowed and isinstance(v, str):
            base[k] = v
    try:
        recent = json.loads(row["recent_missions_json"] or "[]")
    except json.JSONDecodeError:
        recent = []
    if not isinstance(recent, list):
        recent = []
    return {
        "contexts": base,
        "recent_missions": recent,
        "updated_at": row["updated_at"],
    }


def merge_enterprise_contexts(updates: dict[str, str] | None) -> dict:
    """Fusionne les champs de contexte (texte libre par rôle + global)."""
    init_enterprise_memory_row()
    cur = get_enterprise_memory()
    allowed = _memory_context_allowed_keys()
    base = dict(cur["contexts"])
    for k, v in (updates or {}).items():
        if k in allowed and isinstance(v, str):
            base[k] = v
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        conn.execute(
            "UPDATE enterprise_memory SET contexts_json=?, updated_at=? WHERE id=1",
            (json.dumps(base, ensure_ascii=False), now),
        )
        conn.commit()
    return get_enterprise_memory()


def append_recent_mission(job_id: str, mission: str, preview: str) -> None:
    """Ajoute une entrée dans l'historique des missions (mémoire opérationnelle, texte long pour le CIO)."""
    init_enterprise_memory_row()
    cur = get_enterprise_memory()
    lst = list(cur.get("recent_missions") or [])
    lst.append(
        {
            "job_id": job_id,
            "mission": (mission or "")[:2000],
            "preview": (preview or "")[:10000],
            "ts": datetime.utcnow().isoformat(),
        },
    )
    lst = lst[-10:]
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        conn.execute(
            "UPDATE enterprise_memory SET recent_missions_json=?, updated_at=? WHERE id=1",
            (json.dumps(lst, ensure_ascii=False), now),
        )
        conn.commit()


# ── Mission Templates ─────────────────────────────────────────────────────────

def list_mission_templates() -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, name, description, agent, mission_text, variables_json, config_json, created_at, updated_at "
            "FROM mission_templates ORDER BY updated_at DESC"
        ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        try:
            d["variables"] = json.loads(d.pop("variables_json") or "[]")
        except Exception:
            d["variables"] = []
        try:
            d["config"] = json.loads(d.pop("config_json") or "{}")
        except Exception:
            d["config"] = {}
        out.append(d)
    return out


def get_mission_template(template_id: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id, name, description, agent, mission_text, variables_json, config_json, created_at, updated_at "
            "FROM mission_templates WHERE id=?",
            (template_id,),
        ).fetchone()
    if not row:
        return None
    d = dict(row)
    try:
        d["variables"] = json.loads(d.pop("variables_json") or "[]")
    except Exception:
        d["variables"] = []
    try:
        d["config"] = json.loads(d.pop("config_json") or "{}")
    except Exception:
        d["config"] = {}
    return d


def upsert_mission_template(
    template_id: str,
    *,
    name: str,
    description: str,
    agent: str,
    mission_text: str,
    variables: list[str],
    config: dict,
    created_at: str | None = None,
) -> dict:
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        prev = conn.execute(
            "SELECT created_at FROM mission_templates WHERE id=?", (template_id,)
        ).fetchone()
        c_at = created_at or (dict(prev)["created_at"] if prev else now)
        conn.execute(
            "INSERT OR REPLACE INTO mission_templates "
            "(id, name, description, agent, mission_text, variables_json, config_json, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                template_id,
                (name or "").strip(),
                (description or "").strip(),
                (agent or "coordinateur").strip(),
                (mission_text or "").strip(),
                json.dumps(variables or [], ensure_ascii=False),
                json.dumps(config or {}, ensure_ascii=False),
                c_at,
                now,
            ),
        )
        conn.commit()
    return get_mission_template(template_id)  # type: ignore[return-value]


def delete_mission_template(template_id: str) -> bool:
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM mission_templates WHERE id=?", (template_id,))
        conn.commit()
        return int(getattr(cur, "rowcount", 0) or 0) > 0


# ── Memory History ────────────────────────────────────────────────────────────

def snapshot_memory_history(comment: str = "") -> int:
    """Capture l'état actuel de enterprise_memory.contexts_json dans memory_history. Retourne le nouvel id."""
    mem = get_enterprise_memory()
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO memory_history (contexts_json, comment, created_at) VALUES (?, ?, ?)",
            (json.dumps(mem["contexts"], ensure_ascii=False), (comment or "").strip(), now),
        )
        conn.commit()
        return int(cur.lastrowid or 0)


def list_memory_history(limit: int = 20) -> list[dict]:
    limit = max(1, min(limit, 100))
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, comment, created_at, substr(contexts_json, 1, 120) AS preview "
            "FROM memory_history ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [dict(r) for r in rows]


def get_memory_history_snapshot(snapshot_id: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id, contexts_json, comment, created_at FROM memory_history WHERE id=?",
            (snapshot_id,),
        ).fetchone()
    if not row:
        return None
    d = dict(row)
    try:
        d["contexts"] = json.loads(d.pop("contexts_json") or "{}")
    except Exception:
        d["contexts"] = {}
    return d


def restore_memory_history_snapshot(snapshot_id: int) -> dict:
    """Restaure un snapshot : crée un snapshot 'avant restauration' puis écrase la mémoire active."""
    snap = get_memory_history_snapshot(snapshot_id)
    if not snap:
        raise ValueError(f"Snapshot {snapshot_id} introuvable")
    snapshot_memory_history(comment=f"avant restauration snapshot #{snapshot_id}")
    merge_enterprise_contexts(snap["contexts"])
    return get_enterprise_memory()


# ── Autonomous Tasks & Outputs ─────────────────────────────────────────────────

def _init_autonomous_tables() -> None:
    with get_conn() as conn:
        task_pk = "VARCHAR(191)" if _is_mariadb() else "TEXT"
        output_pk = "VARCHAR(191)" if _is_mariadb() else "TEXT"
        conn.execute("""
            CREATE TABLE IF NOT EXISTS scheduled_tasks (
                id                    """ + task_pk + """ PRIMARY KEY,
                name                  TEXT NOT NULL,
                description           TEXT NOT NULL DEFAULT '',
                task_type             TEXT NOT NULL DEFAULT 'mission',
                agent                 TEXT NOT NULL DEFAULT 'coordinateur',
                mission_template      TEXT NOT NULL DEFAULT '',
                params_json           TEXT NOT NULL DEFAULT '{}',
                schedule_type         TEXT NOT NULL DEFAULT 'interval',
                schedule_config       TEXT NOT NULL DEFAULT '{}',
                enabled               INTEGER NOT NULL DEFAULT 1,
                requires_approval     INTEGER NOT NULL DEFAULT 1,
                budget_tokens_per_run INTEGER NOT NULL DEFAULT 50000,
                budget_runs_per_day   INTEGER NOT NULL DEFAULT 3,
                last_run_at           TEXT,
                next_run_at           TEXT,
                created_at            TEXT NOT NULL,
                updated_at            TEXT NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS autonomous_outputs (
                id               """ + output_pk + """ PRIMARY KEY,
                task_id          TEXT NOT NULL DEFAULT '',
                job_id           TEXT NOT NULL DEFAULT '',
                output_type      TEXT NOT NULL DEFAULT 'draft',
                target_platform  TEXT NOT NULL DEFAULT '',
                target_ref       TEXT NOT NULL DEFAULT '',
                title            TEXT NOT NULL DEFAULT '',
                content          TEXT NOT NULL DEFAULT '',
                status           TEXT NOT NULL DEFAULT 'pending',
                rejection_reason TEXT NOT NULL DEFAULT '',
                approved_at      TEXT,
                published_at     TEXT,
                created_at       TEXT NOT NULL,
                updated_at       TEXT NOT NULL
            )
        """)
        conn.commit()


def _hydrate_scheduled_task(row: dict) -> dict:
    out = dict(row)
    try:
        out["params"] = json.loads(out.pop("params_json") or "{}")
    except Exception:
        out["params"] = {}
    try:
        out["schedule_config"] = json.loads(out.get("schedule_config") or "{}")
    except Exception:
        out["schedule_config"] = {}
    out["enabled"] = bool(out.get("enabled"))
    out["requires_approval"] = bool(out.get("requires_approval"))
    return out


def create_scheduled_task(
    *,
    name: str,
    description: str = "",
    task_type: str = "mission",
    agent: str = "coordinateur",
    mission_template: str = "",
    params: dict | None = None,
    schedule_type: str = "interval",
    schedule_config: dict | None = None,
    enabled: bool = True,
    requires_approval: bool = True,
    budget_tokens_per_run: int = 50000,
    budget_runs_per_day: int = 3,
) -> dict:
    import uuid
    task_id = str(uuid.uuid4())[:12]
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO scheduled_tasks (id, name, description, task_type, agent, mission_template, "
            "params_json, schedule_type, schedule_config, enabled, requires_approval, "
            "budget_tokens_per_run, budget_runs_per_day, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                task_id, name, description, task_type, agent, mission_template,
                json.dumps(params or {}, ensure_ascii=False),
                schedule_type,
                json.dumps(schedule_config or {}, ensure_ascii=False),
                int(enabled), int(requires_approval),
                int(budget_tokens_per_run), int(budget_runs_per_day),
                now, now,
            ),
        )
        conn.commit()
    return get_scheduled_task(task_id)  # type: ignore[return-value]


def get_scheduled_task(task_id: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM scheduled_tasks WHERE id=?", (task_id,)).fetchone()
    if not row:
        return None
    return _hydrate_scheduled_task(dict(row))


def list_scheduled_tasks() -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM scheduled_tasks ORDER BY created_at DESC"
        ).fetchall()
    return [_hydrate_scheduled_task(dict(r)) for r in rows]


def update_scheduled_task(
    task_id: str,
    *,
    name: str | None = None,
    description: str | None = None,
    task_type: str | None = None,
    agent: str | None = None,
    mission_template: str | None = None,
    params: dict | None = None,
    schedule_type: str | None = None,
    schedule_config: dict | None = None,
    enabled: bool | None = None,
    requires_approval: bool | None = None,
    budget_tokens_per_run: int | None = None,
    budget_runs_per_day: int | None = None,
    last_run_at: str | None = None,
    next_run_at: str | None = None,
) -> dict | None:
    now = datetime.utcnow().isoformat()
    sets: list[str] = ["updated_at=?"]
    vals: list = [now]
    if name is not None:
        sets.append("name=?"); vals.append(name)
    if description is not None:
        sets.append("description=?"); vals.append(description)
    if task_type is not None:
        sets.append("task_type=?"); vals.append(task_type)
    if agent is not None:
        sets.append("agent=?"); vals.append(agent)
    if mission_template is not None:
        sets.append("mission_template=?"); vals.append(mission_template)
    if params is not None:
        sets.append("params_json=?"); vals.append(json.dumps(params, ensure_ascii=False))
    if schedule_type is not None:
        sets.append("schedule_type=?"); vals.append(schedule_type)
    if schedule_config is not None:
        sets.append("schedule_config=?"); vals.append(json.dumps(schedule_config, ensure_ascii=False))
    if enabled is not None:
        sets.append("enabled=?"); vals.append(int(enabled))
    if requires_approval is not None:
        sets.append("requires_approval=?"); vals.append(int(requires_approval))
    if budget_tokens_per_run is not None:
        sets.append("budget_tokens_per_run=?"); vals.append(int(budget_tokens_per_run))
    if budget_runs_per_day is not None:
        sets.append("budget_runs_per_day=?"); vals.append(int(budget_runs_per_day))
    if last_run_at is not None:
        sets.append("last_run_at=?"); vals.append(last_run_at)
    if next_run_at is not None:
        sets.append("next_run_at=?"); vals.append(next_run_at)
    vals.append(task_id)
    with get_conn() as conn:
        conn.execute(f"UPDATE scheduled_tasks SET {', '.join(sets)} WHERE id=?", vals)
        conn.commit()
    return get_scheduled_task(task_id)


def delete_scheduled_task(task_id: str) -> bool:
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM scheduled_tasks WHERE id=?", (task_id,))
        conn.commit()
        return int(getattr(cur, "rowcount", 0) or 0) > 0


def create_autonomous_output(
    *,
    task_id: str,
    job_id: str = "",
    output_type: str = "draft",
    target_platform: str = "",
    target_ref: str = "",
    title: str = "",
    content: str,
) -> dict:
    import uuid
    output_id = str(uuid.uuid4())[:16]
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO autonomous_outputs (id, task_id, job_id, output_type, target_platform, "
            "target_ref, title, content, status, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (output_id, task_id, job_id, output_type, target_platform, target_ref, title, content, "pending", now, now),
        )
        conn.commit()
    return get_autonomous_output(output_id)  # type: ignore[return-value]


def get_autonomous_output(output_id: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM autonomous_outputs WHERE id=?", (output_id,)).fetchone()
    return dict(row) if row else None


def list_autonomous_outputs(
    *,
    status: str | None = None,
    task_id: str | None = None,
    output_type: str | None = None,
    limit: int = 50,
) -> list[dict]:
    clauses: list[str] = []
    params: list = []
    if status:
        clauses.append("status=?"); params.append(status)
    if task_id:
        clauses.append("task_id=?"); params.append(task_id)
    if output_type:
        clauses.append("output_type=?"); params.append(output_type)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    params.append(max(1, min(limit, 200)))
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT * FROM autonomous_outputs {where} ORDER BY created_at DESC LIMIT ?",
            params,
        ).fetchall()
    return [dict(r) for r in rows]


def update_autonomous_output_status(
    output_id: str,
    status: str,
    *,
    rejection_reason: str = "",
    approved_at: str | None = None,
    published_at: str | None = None,
) -> dict | None:
    now = datetime.utcnow().isoformat()
    sets = ["status=?", "updated_at=?"]
    vals: list = [status, now]
    if rejection_reason:
        sets.append("rejection_reason=?"); vals.append(rejection_reason)
    if approved_at is not None:
        sets.append("approved_at=?"); vals.append(approved_at)
    if published_at is not None:
        sets.append("published_at=?"); vals.append(published_at)
    vals.append(output_id)
    with get_conn() as conn:
        conn.execute(f"UPDATE autonomous_outputs SET {', '.join(sets)} WHERE id=?", vals)
        conn.commit()
    return get_autonomous_output(output_id)


def count_autonomous_runs_today(task_id: str) -> int:
    """Nombre de jobs autonomes lancés aujourd'hui pour cette tâche."""
    from datetime import date
    today = date.today().isoformat()
    source_tag = f"autonomous:{task_id}"
    with get_conn() as conn:
        row = conn.execute(
            "SELECT COUNT(*) FROM jobs WHERE source=? AND substr(created_at,1,10)=?",
            (source_tag, today),
        ).fetchone()
    return int(row[0] or 0) if row else 0


def sum_autonomous_tokens_today(task_id: str) -> int:
    """Total tokens (in+out) des jobs autonomes de cette tâche aujourd'hui."""
    from datetime import date
    today = date.today().isoformat()
    source_tag = f"autonomous:{task_id}"
    with get_conn() as conn:
        row = conn.execute(
            "SELECT COALESCE(SUM(tokens_in + tokens_out), 0) FROM jobs "
            "WHERE source=? AND substr(created_at,1,10)=?",
            (source_tag, today),
        ).fetchone()
    return int(row[0] or 0) if row else 0
