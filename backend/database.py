"""
database.py — Persistance backend (SQLite par défaut, MariaDB optionnel).

Colonnes d'observabilité (plan CIO, flux d'événements) : extensibles vers
pagination / table events séparée sans casser l'API si on garde events_json
comme projection matérialisée.
"""
import copy
import json
import os
import re
import sqlite3
import time
from pathlib import Path
from datetime import datetime
from typing import Any
from env_loader import load_backend_env

try:
    import pymysql
    _PYMYSQL_OK = True
except Exception:
    pymysql = None  # type: ignore[assignment]
    _PYMYSQL_OK = False

DB_PATH = Path(__file__).parent / "data" / "korymb.db"

# Limite par entrée du fil mission (TEXT / LONGTEXT) — éviter les coupures milieu de phrase pour les longues synthèses CIO.
MISSION_THREAD_CONTENT_MAX_CHARS = 250_000
# Source de vérité config backend (.env + .env.local)
load_backend_env()
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
    # MariaDB : connexion par bloc `with` (pas de pool PyMySQL intégré ici ; à ajouter si charge élevée).
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
    if "deliverables_ui_json" not in cols:
        conn.execute("ALTER TABLE jobs ADD COLUMN deliverables_ui_json TEXT NOT NULL DEFAULT '{}'")
    if "orchestration_phase" not in cols:
        conn.execute("ALTER TABLE jobs ADD COLUMN orchestration_phase TEXT NOT NULL DEFAULT ''")
    if "checkpoint_thread_id" not in cols:
        conn.execute("ALTER TABLE jobs ADD COLUMN checkpoint_thread_id TEXT NOT NULL DEFAULT ''")


def _ensure_platform_tables(conn) -> None:
    text_pk = "VARCHAR(191)" if _is_mariadb() else "TEXT"
    trace_pk = "BIGINT PRIMARY KEY AUTO_INCREMENT" if _is_mariadb() else "INTEGER PRIMARY KEY AUTOINCREMENT"
    hist_pk = trace_pk
    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS mission_idempotency (
            idempotency_key {text_pk} PRIMARY KEY,
            job_id {text_pk} NOT NULL,
            created_at TEXT NOT NULL
        )
    """)
    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS mission_checkpoints (
            id {trace_pk},
            job_id {text_pk} NOT NULL,
            phase TEXT NOT NULL,
            payload_json TEXT NOT NULL DEFAULT '{{}}',
            created_at TEXT NOT NULL
        )
    """)
    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS mission_traces (
            id {trace_pk},
            job_id {text_pk} NOT NULL,
            span_id TEXT NOT NULL DEFAULT '',
            graph_node TEXT NOT NULL DEFAULT '',
            agent TEXT NOT NULL DEFAULT '',
            provider TEXT NOT NULL DEFAULT '',
            model TEXT NOT NULL DEFAULT '',
            tokens_in INTEGER DEFAULT 0,
            tokens_out INTEGER DEFAULT 0,
            cost_usd REAL DEFAULT 0,
            latency_ms INTEGER DEFAULT 0,
            behavior_snapshot_hash TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
        )
    """)
    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS agent_definitions_history (
            id {hist_pk},
            agent_key {text_pk} NOT NULL,
            body_json TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
    """)
    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS orchestration_prompts_history (
            id {hist_pk},
            prompt_key {text_pk} NOT NULL,
            body TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
    """)
    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS agent_tool_permissions (
            agent_key {text_pk} NOT NULL,
            tool_tag {text_pk} NOT NULL,
            permission_level TEXT NOT NULL DEFAULT 'read',
            updated_at TEXT NOT NULL,
            PRIMARY KEY (agent_key, tool_tag)
        )
    """)
    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS director_notifications (
            id {text_pk} PRIMARY KEY,
            kind TEXT NOT NULL DEFAULT 'info',
            title TEXT NOT NULL,
            body TEXT NOT NULL DEFAULT '',
            job_id TEXT,
            output_id TEXT,
            action_url TEXT,
            read_at TEXT,
            created_at TEXT NOT NULL
        )
    """)
    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS hitl_plan_snapshots (
            id {trace_pk},
            job_id {text_pk} NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            plan_json TEXT NOT NULL DEFAULT '{{}}',
            source TEXT NOT NULL DEFAULT 'hitl_gate',
            created_at TEXT NOT NULL
        )
    """)
    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS learning_suggestions (
            id {text_pk} PRIMARY KEY,
            job_id {text_pk} NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            payload_json TEXT NOT NULL DEFAULT '{{}}',
            created_at TEXT NOT NULL,
            resolved_at TEXT
        )
    """)
    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS quality_verdicts (
            id {trace_pk},
            job_id {text_pk} NOT NULL,
            phase TEXT NOT NULL DEFAULT '',
            score REAL NOT NULL DEFAULT 0,
            rejected INTEGER NOT NULL DEFAULT 0,
            payload_json TEXT NOT NULL DEFAULT '{{}}',
            created_at TEXT NOT NULL
        )
    """)
    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS playbooks (
            id {text_pk} PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            category TEXT NOT NULL DEFAULT 'generic',
            steps_json TEXT NOT NULL DEFAULT '{{}}',
            template_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)


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
    try:
        du = json.loads(out.get("deliverables_ui_json") or "{}")
    except json.JSONDecodeError:
        du = {}
    if not isinstance(du, dict):
        du = {}
    agents_u = du.get("agents")
    if not isinstance(agents_u, dict):
        agents_u = {}
    out["deliverables_ui"] = {"agents": agents_u}
    out.pop("deliverables_ui_json", None)
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
        conn.execute("""
            CREATE TABLE IF NOT EXISTS orchestration_prompts (
                prompt_key    """ + text_pk + """ PRIMARY KEY,
                body          TEXT NOT NULL,
                updated_at    TEXT NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS behavior_settings (
                setting_key   """ + text_pk + """ PRIMARY KEY,
                value_json    TEXT NOT NULL,
                updated_at    TEXT NOT NULL
            )
        """)
        _ensure_memory_columns(conn)
        _ensure_platform_tables(conn)
        conn.commit()
    init_enterprise_memory_row()
    _init_autonomous_tables()
    # Graphe de connaissance entités (import tardif pour éviter les cycles)
    try:
        from services.knowledge import init_knowledge_table
        init_knowledge_table()
    except Exception:
        pass  # non bloquant au démarrage

    try:
        seed_orchestration_prompt_defaults()
    except Exception:
        pass  # non bloquant au démarrage
    try:
        seed_behavior_defaults()
    except Exception:
        pass  # non bloquant au démarrage
    try:
        seed_playbooks()
    except Exception:
        pass


def seed_playbooks() -> None:
    """Playbooks Fleur/Sivana par défaut."""
    defaults = [
        {
            "id": "fleur-veille-concurrence",
            "name": "Veille concurrence Fleur",
            "description": "Analyser les concurrents directs et proposer 3 actions commerciales.",
            "category": "fleur",
            "steps": {
                "mission": "Veille concurrentielle Élude In Art : identifier 5 concurrents, comparer offres/prix, proposer 3 actions commerciales concrètes.",
                "agents": ["commercial"],
                "mission_config": {"mode": "cio", "require_user_validation": True},
            },
        },
        {
            "id": "fleur-relance-devis",
            "name": "Relance devis en attente",
            "description": "Synthèse des devis en attente et emails de relance personnalisés.",
            "category": "fleur",
            "steps": {
                "mission": "Lister les devis en attente >7 jours, rédiger des relances personnalisées prêtes à envoyer.",
                "agents": ["commercial"],
            },
        },
        {
            "id": "sivana-audit-contenu",
            "name": "Audit contenu Sivana",
            "description": "Audit SEO et calendrier éditorial 2 semaines.",
            "category": "sivana",
            "steps": {
                "mission": "Auditer le contenu web Sivana, gaps SEO prioritaires, proposer calendrier éditorial 14 jours.",
                "agents": ["marketing"],
            },
        },
        {
            "id": "sivana-social-plan",
            "name": "Plan social Sivana",
            "description": "Plan posts Instagram/Facebook semaine prochaine.",
            "category": "sivana",
            "steps": {
                "mission": "Proposer 5 posts Instagram + 3 Facebook pour Sivana avec accroches et visuels suggérés.",
                "agents": ["marketing"],
            },
        },
    ]
    for pb in defaults:
        if get_playbook(pb["id"]):
            continue
        upsert_playbook(
            pb["id"],
            name=pb["name"],
            description=pb["description"],
            category=pb["category"],
            steps=pb["steps"],
        )


def seed_orchestration_prompt_defaults() -> None:
    """Insère les prompts d'orchestration par défaut si absents."""
    from services.orchestration_prompt_defaults import DEFAULT_ORCHESTRATION_PROMPTS

    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        for key, body in DEFAULT_ORCHESTRATION_PROMPTS.items():
            row = conn.execute("SELECT prompt_key FROM orchestration_prompts WHERE prompt_key = ?", (key,)).fetchone()
            if row:
                continue
            conn.execute(
                "INSERT INTO orchestration_prompts (prompt_key, body, updated_at) VALUES (?, ?, ?)",
                (key, body, now),
            )
        conn.commit()


def get_orchestration_prompt(prompt_key: str) -> str | None:
    key = (prompt_key or "").strip()
    if not key:
        return None
    with get_conn() as conn:
        row = conn.execute(
            "SELECT body FROM orchestration_prompts WHERE prompt_key = ?",
            (key,),
        ).fetchone()
    if not row:
        return None
    try:
        return str(dict(row)["body"])
    except Exception:
        try:
            return str(row[0])
        except Exception:
            return None


def upsert_orchestration_prompt(prompt_key: str, body: str) -> dict:
    key = (prompt_key or "").strip()
    if not key:
        raise ValueError("prompt_key manquant")
    text = str(body or "")
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        if _is_mariadb():
            conn.execute(
                "INSERT INTO orchestration_prompts (prompt_key, body, updated_at) VALUES (?, ?, ?) "
                "ON DUPLICATE KEY UPDATE body = VALUES(body), updated_at = VALUES(updated_at)",
                (key, text, now),
            )
        else:
            conn.execute(
                "INSERT INTO orchestration_prompts (prompt_key, body, updated_at) VALUES (?, ?, ?) "
                "ON CONFLICT(prompt_key) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at",
                (key, text, now),
            )
        conn.commit()
        row = conn.execute(
            "SELECT prompt_key, body, updated_at FROM orchestration_prompts WHERE prompt_key = ?",
            (key,),
        ).fetchone()
    return dict(row) if row else {"prompt_key": key, "body": text, "updated_at": now}


def list_orchestration_prompts() -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT prompt_key, length(body) AS body_chars, updated_at FROM orchestration_prompts ORDER BY prompt_key ASC",
        ).fetchall()
    return [dict(r) for r in rows]


def seed_behavior_defaults() -> None:
    from services.behavior_defaults import BEHAVIOR_DEFAULTS

    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        for key, meta in BEHAVIOR_DEFAULTS.items():
            row = conn.execute("SELECT setting_key FROM behavior_settings WHERE setting_key = ?", (key,)).fetchone()
            if row:
                continue
            payload = json.dumps(meta.get("value"), ensure_ascii=False)
            conn.execute(
                "INSERT INTO behavior_settings (setting_key, value_json, updated_at) VALUES (?, ?, ?)",
                (key, payload, now),
            )
        conn.commit()


def get_behavior_setting(setting_key: str) -> Any | None:
    key = (setting_key or "").strip()
    if not key:
        return None
    with get_conn() as conn:
        row = conn.execute(
            "SELECT value_json FROM behavior_settings WHERE setting_key = ?",
            (key,),
        ).fetchone()
    if not row:
        return None
    raw = dict(row).get("value_json") if isinstance(row, dict) else row[0]
    try:
        return json.loads(raw) if isinstance(raw, str) else raw
    except Exception:
        return raw


def upsert_behavior_setting(setting_key: str, value: Any) -> dict:
    key = (setting_key or "").strip()
    if not key:
        raise ValueError("setting_key manquant")
    now = datetime.utcnow().isoformat()
    payload = json.dumps(value, ensure_ascii=False)
    with get_conn() as conn:
        if _is_mariadb():
            conn.execute(
                "INSERT INTO behavior_settings (setting_key, value_json, updated_at) VALUES (?, ?, ?) "
                "ON DUPLICATE KEY UPDATE value_json = VALUES(value_json), updated_at = VALUES(updated_at)",
                (key, payload, now),
            )
        else:
            conn.execute(
                "INSERT INTO behavior_settings (setting_key, value_json, updated_at) VALUES (?, ?, ?) "
                "ON CONFLICT(setting_key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
                (key, payload, now),
            )
        conn.commit()
    return {"setting_key": key, "value": value, "updated_at": now}


def list_behavior_settings() -> list[dict]:
    from services.behavior_defaults import BEHAVIOR_DEFAULTS

    with get_conn() as conn:
        rows = conn.execute(
            "SELECT setting_key, value_json, updated_at FROM behavior_settings ORDER BY setting_key ASC",
        ).fetchall()
    indexed: dict[str, dict] = {}
    for r in rows:
        item = dict(r)
        try:
            parsed = json.loads(item.get("value_json") or "null")
        except Exception:
            parsed = item.get("value_json")
        indexed[str(item.get("setting_key") or "")] = {
            "setting_key": str(item.get("setting_key") or ""),
            "value": parsed,
            "updated_at": item.get("updated_at"),
        }
    out: list[dict] = []
    for key, meta in BEHAVIOR_DEFAULTS.items():
        row = indexed.get(key) or {"setting_key": key, "value": meta.get("value"), "updated_at": None}
        out.append(
            {
                **row,
                "category": meta.get("category") or "misc",
                "type": meta.get("type") or "json",
                "label": meta.get("label") or key,
                "description": (meta.get("description") or "").strip(),
            }
        )
    return out


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
        "content": (content or "")[:MISSION_THREAD_CONTENT_MAX_CHARS],
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


def update_job_orchestration_phase(job_id: str, phase: str) -> None:
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        conn.execute(
            "UPDATE jobs SET orchestration_phase=?, updated_at=? WHERE id=?",
            (str(phase or "")[:64], now, job_id),
        )
        conn.commit()


def update_job_checkpoint_thread(job_id: str, thread_id: str) -> None:
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        conn.execute(
            "UPDATE jobs SET checkpoint_thread_id=?, updated_at=? WHERE id=?",
            (str(thread_id or "")[:64], now, job_id),
        )
        conn.commit()


def snapshot_behavior_settings() -> dict[str, Any]:
    """Capture des behavior_settings actifs (reproductibilité traces)."""
    try:
        rows = list_behavior_settings()
        return {str(r.get("key") or ""): r.get("value") for r in rows if r.get("key")}
    except Exception:
        return {}


def get_idempotent_job_id(idempotency_key: str) -> str | None:
    key = (idempotency_key or "").strip()[:128]
    if not key:
        return None
    with get_conn() as conn:
        row = conn.execute(
            "SELECT job_id FROM mission_idempotency WHERE idempotency_key=?",
            (key,),
        ).fetchone()
    if not row:
        return None
    return str(row["job_id"] if isinstance(row, dict) else row[0])


def save_idempotent_job(idempotency_key: str, job_id: str) -> None:
    key = (idempotency_key or "").strip()[:128]
    if not key or not job_id:
        return
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO mission_idempotency (idempotency_key, job_id, created_at) VALUES (?, ?, ?)",
            (key, job_id, now),
        )
        conn.commit()


def append_agent_definition_history(agent_key: str, body: dict[str, Any]) -> None:
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO agent_definitions_history (agent_key, body_json, created_at) VALUES (?, ?, ?)",
            (agent_key[:64], json.dumps(body, ensure_ascii=False), now),
        )
        conn.commit()


def list_agent_definition_history(agent_key: str, limit: int = 20) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, agent_key, body_json, created_at FROM agent_definitions_history "
            "WHERE agent_key=? ORDER BY id DESC LIMIT ?",
            (agent_key[:64], max(1, min(limit, 100))),
        ).fetchall()
    out = []
    for row in rows:
        d = dict(row)
        try:
            d["body"] = json.loads(d.pop("body_json") or "{}")
        except json.JSONDecodeError:
            d["body"] = {}
        out.append(d)
    return out


def append_orchestration_prompt_history(prompt_key: str, body: str) -> None:
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO orchestration_prompts_history (prompt_key, body, created_at) VALUES (?, ?, ?)",
            (prompt_key[:64], body, now),
        )
        conn.commit()


def get_agent_tool_permission(agent_key: str, tool_tag: str) -> str:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT permission_level FROM agent_tool_permissions WHERE agent_key=? AND tool_tag=?",
            (agent_key[:64], tool_tag[:64]),
        ).fetchone()
    if not row:
        return "execute"
    return str(row["permission_level"] if isinstance(row, dict) else row[0] or "execute")


def insert_mission_trace(
    *,
    job_id: str,
    span_id: str = "",
    graph_node: str = "",
    agent: str = "",
    provider: str = "",
    model: str = "",
    tokens_in: int = 0,
    tokens_out: int = 0,
    cost_usd: float = 0,
    latency_ms: int = 0,
    behavior_snapshot_hash: str = "",
) -> None:
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO mission_traces (
                job_id, span_id, graph_node, agent, provider, model,
                tokens_in, tokens_out, cost_usd, latency_ms, behavior_snapshot_hash, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                job_id, span_id, graph_node, agent, provider, model,
                tokens_in, tokens_out, cost_usd, latency_ms, behavior_snapshot_hash, now,
            ),
        )
        conn.commit()


def get_job(job_id: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
    if not row:
        return None
    return _hydrate_job_row(dict(row))


def merge_job_deliverables_ui(job_id: str, agents_patch: dict[str, dict[str, Any]] | None) -> dict | None:
    """
    Fusionne des métadonnées UI par agent (notes dirigeant, date d'acceptation livrable).
    Clés d'agent autorisées : alphanum + underscore, max 48 chars.
    """
    jid = (job_id or "").strip()[:16]
    if not jid:
        return None
    row = get_job(jid)
    if not row:
        return None
    cur = row.get("deliverables_ui") or {}
    if not isinstance(cur, dict):
        cur = {}
    agents: dict[str, Any] = dict(cur.get("agents") or {}) if isinstance(cur.get("agents"), dict) else {}
    for raw_k, patch in (agents_patch or {}).items():
        k = re.sub(r"[^a-z0-9_]", "", str(raw_k).strip().lower()[:48])
        if not k or not isinstance(patch, dict):
            continue
        prev = agents[k] if isinstance(agents.get(k), dict) else {}
        merged = dict(prev)
        if "director_note_markdown" in patch and isinstance(patch["director_note_markdown"], str):
            merged["director_note_markdown"] = patch["director_note_markdown"][:MISSION_THREAD_CONTENT_MAX_CHARS]
        if "accepted_at" in patch:
            at = patch["accepted_at"]
            if at is None or at is False:
                merged["accepted_at"] = None
            elif isinstance(at, str) and at.strip():
                merged["accepted_at"] = at.strip()[:64]
        agents[k] = merged
    payload = {"agents": agents}
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        conn.execute(
            "UPDATE jobs SET deliverables_ui_json=?, updated_at=? WHERE id=?",
            (json.dumps(payload, ensure_ascii=False), now, jid),
        )
        conn.commit()
    return get_job(jid)


def get_latest_chat_followup_snapshot(parent_job_id: str) -> dict[str, Any] | None:
    """Dernier job `source=chat` rattaché au parent (suite CIO). Utilisé pour l’UI du job mission."""
    pid = (parent_job_id or "").strip()[:16]
    if not pid:
        return None
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id, agent, status, result, created_at, team_trace, tokens_in, tokens_out, events_json "
            "FROM jobs WHERE parent_job_id=? AND source=? ORDER BY created_at DESC LIMIT 1",
            (pid, "chat"),
        ).fetchone()
    if not row:
        return None
    d = dict(row)
    ev_raw = d.get("events_json") or "[]"
    try:
        ev = json.loads(ev_raw) if isinstance(ev_raw, str) else ev_raw
    except json.JSONDecodeError:
        ev = []
    ev_n = len(ev) if isinstance(ev, list) else 0
    return {
        "job_id": str(d.get("id") or ""),
        "agent": str(d.get("agent") or "coordinateur"),
        "status": str(d.get("status") or ""),
        "result": str(d.get("result") or ""),
        "created_at": str(d.get("created_at") or ""),
        "team_trace": d.get("team_trace"),
        "tokens_in": int(d.get("tokens_in") or 0),
        "tokens_out": int(d.get("tokens_out") or 0),
        "events_total": ev_n,
    }


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


def _user_validated_set(row: dict | Any) -> bool:
    uv = row.get("user_validated_at") if isinstance(row, dict) else row["user_validated_at"]
    return bool(uv and str(uv).strip())


def job_close_mission_by_user(job_id: str) -> bool:
    """
    Clôture explicite par le dirigeant (mission considérée terminée).
    Autorise une mission encore « running » ou en erreur : fige le statut en completed + horodatage.
    """
    jid = (job_id or "").strip()[:16]
    if not jid:
        return False
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        _ensure_jobs_columns(conn)
        row = conn.execute(
            "SELECT id, status, user_validated_at FROM jobs WHERE id = ?",
            (jid,),
        ).fetchone()
        if not row:
            return False
        if _user_validated_set(dict(row)):
            return True
        st = str(row["status"] or "")
        if st == "cancelled":
            return False
        new_status = "completed"
        cur = conn.execute(
            "UPDATE jobs SET user_validated_at = ?, status = ?, updated_at = ? "
            "WHERE id = ? AND (user_validated_at IS NULL OR TRIM(user_validated_at) = '')",
            (now, new_status, now, jid),
        )
        conn.commit()
        return int(getattr(cur, "rowcount", 0) or 0) > 0


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
# Champs système persistés dans contexts_json (hors volets métier édités par l’admin).
_SYSTEM_ENTERPRISE_CONTEXT_KEYS = frozenset({"auto_summary"})

CUSTOM_AGENT_KEY_RE = re.compile(r"^[a-z][a-z0-9_]{1,47}$")
_CUSTOM_AGENT_RESERVED = frozenset(
    {"global", "coordinateur", "commercial", "community_manager", "developpeur", "comptable", "auto_summary"},
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
    return _CONTEXT_KEYS_LEGACY | _SYSTEM_ENTERPRISE_CONTEXT_KEYS | frozenset(list_custom_agent_keys_raw())


# Cache lecture enterprise_memory (singleton) — invalidé à chaque écriture.
_ENTERPRISE_MEM_CACHE: dict[str, Any] | None = None
_ENTERPRISE_MEM_CACHE_AT: float = 0.0
_ENTERPRISE_MEM_TTL_SEC = 2.0


def invalidate_enterprise_memory_cache() -> None:
    global _ENTERPRISE_MEM_CACHE
    _ENTERPRISE_MEM_CACHE = None


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
    global _ENTERPRISE_MEM_CACHE, _ENTERPRISE_MEM_CACHE_AT
    init_enterprise_memory_row()
    now_m = time.monotonic()
    if _ENTERPRISE_MEM_CACHE is not None and (now_m - _ENTERPRISE_MEM_CACHE_AT) < _ENTERPRISE_MEM_TTL_SEC:
        return copy.deepcopy(_ENTERPRISE_MEM_CACHE)
    with get_conn() as conn:
        row = conn.execute(
            "SELECT contexts_json, recent_missions_json, updated_at FROM enterprise_memory WHERE id=1",
        ).fetchone()
    allowed = _memory_context_allowed_keys()
    if not row:
        out = {"contexts": {k: "" for k in allowed}, "recent_missions": [], "updated_at": None}
        _ENTERPRISE_MEM_CACHE = copy.deepcopy(out)
        _ENTERPRISE_MEM_CACHE_AT = now_m
        return copy.deepcopy(out)
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
    out = {
        "contexts": base,
        "recent_missions": recent,
        "updated_at": row["updated_at"],
    }
    _ENTERPRISE_MEM_CACHE = copy.deepcopy(out)
    _ENTERPRISE_MEM_CACHE_AT = now_m
    return copy.deepcopy(out)


def merge_enterprise_contexts(updates: dict[str, str] | None) -> dict:
    """Fusionne les champs de contexte (texte libre par rôle + global)."""
    init_enterprise_memory_row()
    invalidate_enterprise_memory_cache()
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
    invalidate_enterprise_memory_cache()
    return get_enterprise_memory()


def append_recent_mission(job_id: str, mission: str, preview: str) -> None:
    """Ajoute une entrée dans l'historique des missions (mémoire opérationnelle, texte long pour le CIO)."""
    init_enterprise_memory_row()
    invalidate_enterprise_memory_cache()
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
    invalidate_enterprise_memory_cache()


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


def link_autonomous_output_job(output_id: str, job_id: str) -> dict | None:
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        conn.execute(
            "UPDATE autonomous_outputs SET job_id=?, updated_at=? WHERE id=?",
            (job_id[:16], now, output_id),
        )
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


# ── Director platform (inbox, notifications, snapshots, learning, quality, playbooks) ──


def delete_job_cascade(job_id: str) -> bool:
    """Supprime un job et les enregistrements liés (traces, notifications, etc.)."""
    jid = (job_id or "").strip()[:16]
    if not jid:
        return False
    with get_conn() as conn:
        row = conn.execute("SELECT id FROM jobs WHERE id=?", (jid,)).fetchone()
        if not row:
            return False
        for table, col in (
            ("mission_traces", "job_id"),
            ("mission_checkpoints", "job_id"),
            ("hitl_plan_snapshots", "job_id"),
            ("quality_verdicts", "job_id"),
            ("learning_suggestions", "job_id"),
            ("director_notifications", "job_id"),
            ("llm_usage_events", "job_id"),
            ("mission_idempotency", "job_id"),
        ):
            try:
                conn.execute(f"DELETE FROM {table} WHERE {col}=?", (jid,))
            except Exception:
                pass
        try:
            conn.execute("UPDATE autonomous_outputs SET job_id='' WHERE job_id=?", (jid,))
        except Exception:
            pass
        conn.execute("DELETE FROM jobs WHERE id=?", (jid,))
        conn.commit()
    return True


def mark_cio_questions_answered(job_id: str) -> bool:
    """Marque les événements cio_question non répondus comme answered=true."""
    row = get_job(job_id)
    if not row:
        return False
    events = list(row.get("events") or [])
    changed = False
    patched: list = []
    for ev in events:
        if not isinstance(ev, dict):
            patched.append(ev)
            continue
        if ev.get("type") == "cio_question":
            data = ev.get("data") if isinstance(ev.get("data"), dict) else {}
            if not data.get("answered"):
                data = dict(data)
                data["answered"] = True
                ev = dict(ev)
                ev["data"] = data
                changed = True
        patched.append(ev)
    if not changed:
        return False
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        conn.execute(
            "UPDATE jobs SET events_json=?, updated_at=? WHERE id=?",
            (json.dumps(patched, ensure_ascii=False), now, job_id),
        )
        conn.commit()
    return True


def list_jobs_summary(limit: int = 80) -> list[dict]:
    """Liste légère pour inbox/briefing (sans hydratation JSON lourde)."""
    lim = max(1, min(int(limit), 200))
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, agent, mission, status, source, created_at, updated_at, tokens_in, tokens_out, "
            "user_validated_at, hitl_gate_json, events_json, plan_json "
            "FROM jobs ORDER BY created_at DESC LIMIT ?",
            (lim,),
        ).fetchall()
    out: list[dict] = []
    for row in rows or []:
        d = dict(row)
        try:
            events = json.loads(d.pop("events_json", None) or "[]")
        except json.JSONDecodeError:
            events = []
        try:
            plan = json.loads(d.pop("plan_json", None) or "{}")
        except json.JSONDecodeError:
            plan = {}
        try:
            gate = json.loads(d.pop("hitl_gate_json", None) or "{}")
        except json.JSONDecodeError:
            gate = {}
        d["events"] = events if isinstance(events, list) else []
        d["plan"] = plan if isinstance(plan, dict) else {}
        d["hitl_gate"] = gate if isinstance(gate, dict) else {}
        out.append(d)
    return out


def insert_director_notification(
    *,
    kind: str,
    title: str,
    body: str = "",
    job_id: str | None = None,
    output_id: str | None = None,
    action_url: str | None = None,
    notif_id: str | None = None,
) -> dict:
    import uuid as _uuid

    nid = (notif_id or _uuid.uuid4().hex[:16]).strip()[:32]
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO director_notifications (id, kind, title, body, job_id, output_id, action_url, read_at, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)",
            (nid, kind[:32], title[:500], body[:4000], job_id, output_id, action_url, now),
        )
        conn.commit()
    return get_director_notification(nid) or {"id": nid}


def get_director_notification(notif_id: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM director_notifications WHERE id=?", (notif_id,)).fetchone()
    return dict(row) if row else None


def list_director_notifications(*, unread_only: bool = False, limit: int = 50) -> list[dict]:
    lim = max(1, min(int(limit), 200))
    clause = "WHERE read_at IS NULL" if unread_only else ""
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT * FROM director_notifications {clause} ORDER BY created_at DESC LIMIT ?",
            (lim,),
        ).fetchall()
    return [dict(r) for r in rows or []]


def mark_director_notification_read(notif_id: str) -> dict | None:
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        conn.execute("UPDATE director_notifications SET read_at=? WHERE id=?", (now, notif_id))
        conn.commit()
    return get_director_notification(notif_id)


def mark_all_director_notifications_read() -> int:
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        cur = conn.execute(
            "UPDATE director_notifications SET read_at=? WHERE read_at IS NULL",
            (now,),
        )
        conn.commit()
        return int(getattr(cur, "rowcount", 0) or 0)


def insert_hitl_plan_snapshot(job_id: str, plan: dict, *, source: str = "hitl_gate") -> dict:
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT COALESCE(MAX(version), 0) AS v FROM hitl_plan_snapshots WHERE job_id=?",
            (job_id,),
        ).fetchone()
        version = int(dict(row).get("v") or 0) + 1 if row else 1
        if _is_mariadb():
            conn.execute(
                "INSERT INTO hitl_plan_snapshots (job_id, version, plan_json, source, created_at) VALUES (?, ?, ?, ?, ?)",
                (job_id, version, json.dumps(plan, ensure_ascii=False), source[:64], now),
            )
            snap_id = conn.execute("SELECT LAST_INSERT_ID() AS id").fetchone()
            sid = int(dict(snap_id).get("id") or 0)
        else:
            cur = conn.execute(
                "INSERT INTO hitl_plan_snapshots (job_id, version, plan_json, source, created_at) VALUES (?, ?, ?, ?, ?)",
                (job_id, version, json.dumps(plan, ensure_ascii=False), source[:64], now),
            )
            sid = int(getattr(cur, "lastrowid", 0) or 0)
        conn.commit()
    return {"id": sid, "job_id": job_id, "version": version, "source": source, "created_at": now}


def list_hitl_plan_snapshots(job_id: str) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, job_id, version, plan_json, source, created_at FROM hitl_plan_snapshots "
            "WHERE job_id=? ORDER BY version ASC",
            (job_id,),
        ).fetchall()
    out: list[dict] = []
    for row in rows or []:
        d = dict(row)
        try:
            d["plan"] = json.loads(d.pop("plan_json", None) or "{}")
        except json.JSONDecodeError:
            d["plan"] = {}
        out.append(d)
    return out


def insert_quality_verdict(
    job_id: str,
    *,
    phase: str,
    score: float,
    rejected: bool,
    payload: dict | None = None,
) -> dict:
    now = datetime.utcnow().isoformat()
    blob = json.dumps(payload or {}, ensure_ascii=False)
    with get_conn() as conn:
        if _is_mariadb():
            conn.execute(
                "INSERT INTO quality_verdicts (job_id, phase, score, rejected, payload_json, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (job_id, phase[:64], float(score), 1 if rejected else 0, blob, now),
            )
            row = conn.execute("SELECT LAST_INSERT_ID() AS id").fetchone()
            vid = int(dict(row).get("id") or 0)
        else:
            cur = conn.execute(
                "INSERT INTO quality_verdicts (job_id, phase, score, rejected, payload_json, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (job_id, phase[:64], float(score), 1 if rejected else 0, blob, now),
            )
            vid = int(getattr(cur, "lastrowid", 0) or 0)
        conn.commit()
    return {"id": vid, "job_id": job_id, "phase": phase, "score": score, "rejected": rejected, "created_at": now}


def list_quality_verdicts(job_id: str) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, job_id, phase, score, rejected, payload_json, created_at FROM quality_verdicts "
            "WHERE job_id=? ORDER BY created_at ASC",
            (job_id,),
        ).fetchall()
    out: list[dict] = []
    for row in rows or []:
        d = dict(row)
        d["rejected"] = bool(d.get("rejected"))
        try:
            d["payload"] = json.loads(d.pop("payload_json", None) or "{}")
        except json.JSONDecodeError:
            d["payload"] = {}
        out.append(d)
    return out


def insert_learning_suggestion(job_id: str, payload: dict, *, suggestion_id: str | None = None) -> dict:
    import uuid as _uuid

    sid = (suggestion_id or _uuid.uuid4().hex[:16]).strip()[:32]
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO learning_suggestions (id, job_id, status, payload_json, created_at, resolved_at) "
            "VALUES (?, ?, 'pending', ?, ?, NULL)",
            (sid, job_id, json.dumps(payload, ensure_ascii=False), now),
        )
        conn.commit()
    return get_learning_suggestion(sid) or {"id": sid, "job_id": job_id, "status": "pending"}


def get_learning_suggestion(suggestion_id: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM learning_suggestions WHERE id=?", (suggestion_id,)).fetchone()
    if not row:
        return None
    d = dict(row)
    try:
        d["payload"] = json.loads(d.pop("payload_json", None) or "{}")
    except json.JSONDecodeError:
        d["payload"] = {}
    return d


def list_learning_suggestions(*, status: str | None = "pending", limit: int = 40) -> list[dict]:
    lim = max(1, min(int(limit), 200))
    if status:
        with get_conn() as conn:
            rows = conn.execute(
                "SELECT * FROM learning_suggestions WHERE status=? ORDER BY created_at DESC LIMIT ?",
                (status, lim),
            ).fetchall()
    else:
        with get_conn() as conn:
            rows = conn.execute(
                "SELECT * FROM learning_suggestions ORDER BY created_at DESC LIMIT ?",
                (lim,),
            ).fetchall()
    out: list[dict] = []
    for row in rows or []:
        d = dict(row)
        try:
            d["payload"] = json.loads(d.pop("payload_json", None) or "{}")
        except json.JSONDecodeError:
            d["payload"] = {}
        out.append(d)
    return out


def resolve_learning_suggestion(suggestion_id: str, status: str) -> dict | None:
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        conn.execute(
            "UPDATE learning_suggestions SET status=?, resolved_at=? WHERE id=?",
            (status[:32], now, suggestion_id),
        )
        conn.commit()
    return get_learning_suggestion(suggestion_id)


def list_playbooks(*, category: str | None = None) -> list[dict]:
    with get_conn() as conn:
        if category:
            rows = conn.execute(
                "SELECT * FROM playbooks WHERE category=? ORDER BY updated_at DESC",
                (category,),
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM playbooks ORDER BY updated_at DESC").fetchall()
    out: list[dict] = []
    for row in rows or []:
        d = dict(row)
        try:
            d["steps"] = json.loads(d.pop("steps_json", None) or "{}")
        except json.JSONDecodeError:
            d["steps"] = {}
        out.append(d)
    return out


def get_playbook(playbook_id: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM playbooks WHERE id=?", (playbook_id,)).fetchone()
    if not row:
        return None
    d = dict(row)
    try:
        d["steps"] = json.loads(d.pop("steps_json", None) or "{}")
    except json.JSONDecodeError:
        d["steps"] = {}
    return d


def upsert_playbook(
    playbook_id: str,
    *,
    name: str,
    description: str = "",
    category: str = "generic",
    steps: dict | None = None,
    template_id: str | None = None,
) -> dict:
    now = datetime.utcnow().isoformat()
    steps_blob = json.dumps(steps or {}, ensure_ascii=False)
    with get_conn() as conn:
        existing = conn.execute("SELECT id FROM playbooks WHERE id=?", (playbook_id,)).fetchone()
        if existing:
            conn.execute(
                "UPDATE playbooks SET name=?, description=?, category=?, steps_json=?, template_id=?, updated_at=? WHERE id=?",
                (name[:200], description[:2000], category[:32], steps_blob, template_id, now, playbook_id),
            )
        else:
            conn.execute(
                "INSERT INTO playbooks (id, name, description, category, steps_json, template_id, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (playbook_id, name[:200], description[:2000], category[:32], steps_blob, template_id, now, now),
            )
        conn.commit()
    return get_playbook(playbook_id) or {"id": playbook_id}


def list_mission_traces(job_id: str, *, limit: int = 200) -> list[dict]:
    lim = max(1, min(int(limit), 500))
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM mission_traces WHERE job_id=? ORDER BY created_at ASC LIMIT ?",
            (job_id, lim),
        ).fetchall()
    return [dict(r) for r in rows or []]
