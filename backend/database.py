"""
database.py — Persistance SQLite pour l'historique des jobs.

Colonnes d'observabilité (plan CIO, flux d'événements) : extensibles vers
pagination / table events séparée sans casser l'API si on garde events_json
comme projection matérialisée.
"""
import json
import sqlite3
from pathlib import Path
from datetime import datetime

DB_PATH = Path(__file__).parent / "data" / "korymb.db"


def get_conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_jobs_columns(conn: sqlite3.Connection) -> None:
    """Ajoute les colonnes manquantes si la DB a été créée avec une ancienne version."""
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
        merged["recursive_max_rounds"] = max(0, min(5, int(merged.get("recursive_max_rounds") or 0)))
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
        conn.commit()
    init_enterprise_memory_row()


def _ensure_llm_usage_table(conn: sqlite3.Connection) -> None:
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


_CONTEXT_KEYS = frozenset(
    {"global", "commercial", "community_manager", "developpeur", "comptable"},
)


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
    if not row:
        return {"contexts": {k: "" for k in _CONTEXT_KEYS}, "recent_missions": [], "updated_at": None}
    try:
        ctx = json.loads(row["contexts_json"] or "{}")
    except json.JSONDecodeError:
        ctx = {}
    if not isinstance(ctx, dict):
        ctx = {}
    base = {k: "" for k in _CONTEXT_KEYS}
    for k, v in ctx.items():
        if k in _CONTEXT_KEYS and isinstance(v, str):
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
    base = dict(cur["contexts"])
    for k, v in (updates or {}).items():
        if k in _CONTEXT_KEYS and isinstance(v, str):
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
    """Ajoute une entrée courte dans l’historique des missions (mémoire opérationnelle)."""
    init_enterprise_memory_row()
    cur = get_enterprise_memory()
    lst = list(cur.get("recent_missions") or [])
    lst.append(
        {
            "job_id": job_id,
            "mission": (mission or "")[:500],
            "preview": (preview or "")[:450],
            "ts": datetime.utcnow().isoformat(),
        },
    )
    lst = lst[-14:]
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        conn.execute(
            "UPDATE enterprise_memory SET recent_missions_json=?, updated_at=? WHERE id=1",
            (json.dumps(lst, ensure_ascii=False), now),
        )
        conn.commit()
