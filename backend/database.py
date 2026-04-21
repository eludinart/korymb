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
    return out


def init_db():
    with get_conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS jobs (
                id            TEXT PRIMARY KEY,
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
                parent_job_id   TEXT
            )
        """)
        _ensure_jobs_columns(conn)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS mission_sessions (
                id              TEXT PRIMARY KEY,
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
        conn.commit()
    init_enterprise_memory_row()


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
):
    now = datetime.utcnow().isoformat()
    cfg_json = json.dumps(mission_config if isinstance(mission_config, dict) else {}, ensure_ascii=False)
    parent = (parent_job_id or "").strip()[:16] or None
    with get_conn() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO jobs (id, agent, mission, status, logs, team_trace, "
            "source, plan_json, events_json, mission_config_json, mission_thread_json, parent_job_id, created_at, updated_at) "
            "VALUES (?, ?, ?, 'running', '[]', '[]', ?, '{}', '[]', ?, '[]', ?, ?, ?)",
            (job_id, agent, mission, source, cfg_json, parent, now, now),
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
    {"web", "linkedin", "email", "instagram", "facebook", "drive"},
)


def _ensure_custom_agents_table(conn) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS custom_agents (
            agent_key TEXT PRIMARY KEY,
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
