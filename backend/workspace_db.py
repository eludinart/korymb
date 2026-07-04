"""
workspace_db.py — Espaces Korymb (multi-tenant), utilisateurs et memberships.
"""
from __future__ import annotations

import json
import re
import secrets
import uuid
from datetime import datetime
from typing import Any, Literal

from tenant_context import get_workspace_id, set_tenant_context

Role = Literal["admin", "member"]

_DEFAULT_WORKSPACE_ID = "ws-default-legacy"
_DEFAULT_WORKSPACE_SLUG = "default"

_WORKSPACE_TABLES_WITH_COLUMN: tuple[str, ...] = (
    "jobs",
    "mission_sessions",
    "mission_templates",
    "memory_history",
    "orchestration_prompts",
    "behavior_settings",
    "llm_runtime_settings",
    "custom_agents",
    "enterprise_memory",
    "mission_idempotency",
    "mission_checkpoints",
    "mission_traces",
    "agent_definitions_history",
    "orchestration_prompts_history",
    "agent_tool_permissions",
    "director_notifications",
    "hitl_plan_snapshots",
    "learning_suggestions",
    "quality_verdicts",
    "playbooks",
    "reprise_checklist_actions",
    "chat_sessions",
    "inbox_dismissals",
    "library_dismissals",
    "scheduled_tasks",
    "autonomous_outputs",
    "knowledge_entities",
    "llm_usage_events",
)


def new_workspace_id() -> str:
    return f"ws-{uuid.uuid4().hex[:16]}"


def new_user_id() -> str:
    return f"usr-{uuid.uuid4().hex[:16]}"


def slugify(name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", (name or "").strip().lower()).strip("-")
    return (base[:48] or "korymb") + f"-{secrets.token_hex(3)}"


def ws_id() -> str:
    """Workspace courant (contexte requête) ou workspace legacy par défaut."""
    wid = get_workspace_id()
    if wid:
        return wid
    return _DEFAULT_WORKSPACE_ID


def scoped_store_key(store_key: str) -> str:
    key = (store_key or "").strip()
    prefix = f"{ws_id()}:"
    if key.startswith(prefix):
        return key
    return f"{prefix}{key}"


def ensure_saas_tables(conn) -> None:
    text_pk = "VARCHAR(191)" if _is_mariadb_conn(conn) else "TEXT"
    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS korymb_users (
            id {text_pk} PRIMARY KEY,
            email {text_pk} NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            display_name TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
        )
    """)
    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS korymb_workspaces (
            id {text_pk} PRIMARY KEY,
            name TEXT NOT NULL,
            slug {text_pk} NOT NULL UNIQUE,
            owner_user_id {text_pk},
            created_at TEXT NOT NULL
        )
    """)
    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS korymb_memberships (
            workspace_id {text_pk} NOT NULL,
            user_id {text_pk} NOT NULL,
            role TEXT NOT NULL DEFAULT 'member',
            created_at TEXT NOT NULL,
            PRIMARY KEY (workspace_id, user_id)
        )
    """)


def _is_mariadb_conn(conn) -> bool:
    mod = type(conn).__module__
    return "pymysql" in mod or "MariaConn" in type(conn).__name__


def _table_columns(conn, table: str) -> set[str]:
    if _is_mariadb_conn(conn):
        rows = conn.execute(f"SHOW COLUMNS FROM {table}").fetchall()
        return {str(dict(r).get("Field") or r[0]) for r in rows or []}
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    out: set[str] = set()
    for r in rows or []:
        if isinstance(r, dict):
            out.add(str(r.get("name") or ""))
        else:
            out.add(str(r[1]))
    return out


def _migrate_enterprise_memory_multitenant(conn) -> None:
    """Passe enterprise_memory du schéma singleton (id=1) au PK workspace_id (MariaDB legacy)."""
    if not _is_mariadb_conn(conn):
        return
    try:
        cols = _table_columns(conn, "enterprise_memory")
    except Exception:
        return
    if "workspace_id" not in cols or "id" not in cols:
        return
    create_row = conn.execute("SHOW CREATE TABLE enterprise_memory").fetchone()
    ddl = str((create_row[1] if create_row else "") or "").lower()
    if "primary key (`workspace_id`)" in ddl:
        return
    rows = conn.execute(
        "SELECT contexts_json, recent_missions_json, updated_at, workspace_id FROM enterprise_memory"
    ).fetchall()
    conn.execute("DROP TABLE IF EXISTS enterprise_memory_mt")
    conn.execute(
        """
        CREATE TABLE enterprise_memory_mt (
            workspace_id VARCHAR(191) PRIMARY KEY,
            contexts_json LONGTEXT NOT NULL,
            recent_missions_json LONGTEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    for row in rows or []:
        d = dict(row)
        conn.execute(
            "INSERT INTO enterprise_memory_mt (workspace_id, contexts_json, recent_missions_json, updated_at) "
            "VALUES (?, ?, ?, ?)",
            (
                str(d.get("workspace_id") or _DEFAULT_WORKSPACE_ID),
                d.get("contexts_json") or "{}",
                d.get("recent_missions_json") or "[]",
                d.get("updated_at") or datetime.utcnow().isoformat(),
            ),
        )
    conn.execute("DROP TABLE enterprise_memory")
    conn.execute("RENAME TABLE enterprise_memory_mt TO enterprise_memory")


def ensure_workspace_columns(conn) -> None:
    """Ajoute workspace_id aux tables métier et backfill le workspace legacy."""
    text_col = "VARCHAR(191)" if _is_mariadb_conn(conn) else "TEXT"
    for table in _WORKSPACE_TABLES_WITH_COLUMN:
        try:
            cols = _table_columns(conn, table)
        except Exception:
            continue
        if "workspace_id" in cols:
            continue
        try:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN workspace_id {text_col} NOT NULL DEFAULT '{_DEFAULT_WORKSPACE_ID}'")
        except Exception:
            pass

    try:
        cols = _table_columns(conn, "enterprise_memory")
        if cols and "workspace_id" not in cols:
            conn.execute(
                f"ALTER TABLE enterprise_memory ADD COLUMN workspace_id {text_col} NOT NULL DEFAULT '{_DEFAULT_WORKSPACE_ID}'"
            )
    except Exception:
        pass

    try:
        _migrate_enterprise_memory_multitenant(conn)
    except Exception:
        pass

    _backfill_workspace_ids(conn)
    _ensure_default_workspace_row(conn)


def _ensure_default_workspace_row(conn) -> None:
    now = datetime.utcnow().isoformat()
    row = conn.execute(
        "SELECT id FROM korymb_workspaces WHERE id = ?",
        (_DEFAULT_WORKSPACE_ID,),
    ).fetchone()
    if not row:
        conn.execute(
            "INSERT INTO korymb_workspaces (id, name, slug, owner_user_id, created_at) VALUES (?, ?, ?, NULL, ?)",
            (_DEFAULT_WORKSPACE_ID, "Espace legacy", _DEFAULT_WORKSPACE_SLUG, now),
        )


def _backfill_workspace_ids(conn) -> None:
    for table in _WORKSPACE_TABLES_WITH_COLUMN:
        try:
            cols = _table_columns(conn, table)
        except Exception:
            continue
        if "workspace_id" not in cols:
            continue
        conn.execute(
            f"UPDATE {table} SET workspace_id = ? WHERE workspace_id IS NULL OR workspace_id = ''",
            (_DEFAULT_WORKSPACE_ID,),
        )


def create_user(email: str, password_hash: str, display_name: str = "") -> dict[str, Any]:
    from database import get_conn

    uid = new_user_id()
    now = datetime.utcnow().isoformat()
    mail = email.strip().lower()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO korymb_users (id, email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?, ?)",
            (uid, mail, password_hash, (display_name or mail.split("@")[0])[:120], now),
        )
        conn.commit()
    return get_user_by_id(uid) or {"id": uid, "email": mail}


def get_user_by_email(email: str) -> dict[str, Any] | None:
    from database import get_conn

    mail = email.strip().lower()
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM korymb_users WHERE email = ?", (mail,)).fetchone()
    return dict(row) if row else None


def get_user_by_id(user_id: str) -> dict[str, Any] | None:
    from database import get_conn

    uid = (user_id or "").strip()
    if not uid:
        return None
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM korymb_users WHERE id = ?", (uid,)).fetchone()
    if not row:
        return None
    out = dict(row)
    out.pop("password_hash", None)
    return out


def create_workspace(name: str, owner_user_id: str) -> dict[str, Any]:
    from database import get_conn

    wid = new_workspace_id()
    slug = slugify(name)
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO korymb_workspaces (id, name, slug, owner_user_id, created_at) VALUES (?, ?, ?, ?, ?)",
            (wid, name.strip()[:200] or "Mon Korymb", slug, owner_user_id, now),
        )
        conn.execute(
            "INSERT INTO korymb_memberships (workspace_id, user_id, role, created_at) VALUES (?, ?, 'admin', ?)",
            (wid, owner_user_id, now),
        )
        conn.commit()
    seed_workspace_defaults(wid)
    return get_workspace_by_id(wid) or {"id": wid, "name": name}


def get_workspace_by_id(workspace_id: str) -> dict[str, Any] | None:
    from database import get_conn

    wid = (workspace_id or "").strip()
    if not wid:
        return None
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM korymb_workspaces WHERE id = ?", (wid,)).fetchone()
    return dict(row) if row else None


def list_user_workspaces(user_id: str) -> list[dict[str, Any]]:
    from database import get_conn

    uid = (user_id or "").strip()
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT w.id, w.name, w.slug, w.created_at, m.role
            FROM korymb_workspaces w
            JOIN korymb_memberships m ON m.workspace_id = w.id
            WHERE m.user_id = ?
            ORDER BY w.created_at ASC
            """,
            (uid,),
        ).fetchall()
    return [dict(r) for r in rows or []]


def get_membership(workspace_id: str, user_id: str) -> dict[str, Any] | None:
    from database import get_conn

    with get_conn() as conn:
        row = conn.execute(
            "SELECT workspace_id, user_id, role, created_at FROM korymb_memberships WHERE workspace_id = ? AND user_id = ?",
            (workspace_id, user_id),
        ).fetchone()
    return dict(row) if row else None


def list_workspace_members(workspace_id: str) -> list[dict[str, Any]]:
    from database import get_conn

    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT u.id, u.email, u.display_name, m.role, m.created_at
            FROM korymb_memberships m
            JOIN korymb_users u ON u.id = m.user_id
            WHERE m.workspace_id = ?
            ORDER BY m.created_at ASC
            """,
            (workspace_id,),
        ).fetchall()
    return [dict(r) for r in rows or []]


def add_member(workspace_id: str, email: str, role: Role = "member") -> dict[str, Any]:
    user = get_user_by_email(email)
    if not user:
        raise ValueError("Aucun compte avec cet e-mail. L'utilisateur doit d'abord s'inscrire.")
    membership = get_membership(workspace_id, user["id"])
    if membership:
        raise ValueError("Cet utilisateur fait déjà partie de l'espace.")
    from database import get_conn

    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO korymb_memberships (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)",
            (workspace_id, user["id"], role, now),
        )
        conn.commit()
    return {"user_id": user["id"], "email": user["email"], "role": role}


def seed_workspace_defaults(workspace_id: str) -> None:
    """Initialise un espace vierge (sans données métier Fleur d'ÅmÔurs)."""
    from database import get_conn

    now = datetime.utcnow().isoformat()
    prev = get_workspace_id()
    set_tenant_context(workspace_id=workspace_id)
    try:
        with get_conn() as conn:
            row = conn.execute(
                "SELECT workspace_id FROM enterprise_memory WHERE workspace_id = ?",
                (workspace_id,),
            ).fetchone()
            if not row:
                conn.execute(
                    "INSERT INTO enterprise_memory (contexts_json, recent_missions_json, updated_at, workspace_id) "
                    "VALUES ('{}', '[]', ?, ?)",
                    (now, workspace_id),
                )
                conn.commit()

        from database import seed_behavior_defaults, seed_orchestration_prompt_defaults

        seed_orchestration_prompt_defaults()
        seed_behavior_defaults()
        _seed_workspace_starters(workspace_id)
    finally:
        if prev:
            set_tenant_context(workspace_id=prev)
        else:
            from tenant_context import clear_tenant_context

            clear_tenant_context()


_STARTER_PLAYBOOKS: tuple[dict[str, Any], ...] = (
    {
        "slug": "briefing-hebdo",
        "name": "Briefing hebdo",
        "description": "Synthèse de la semaine et priorités pour les 7 prochains jours.",
        "steps": {
            "mission": "Produire un briefing hebdomadaire : faits marquants, risques, 3 priorités actionnables pour la semaine à venir.",
            "agents": ["coordinateur"],
            "mission_config": {"mode": "cio", "require_user_validation": True},
        },
    },
    {
        "slug": "plan-action",
        "name": "Plan d'action express",
        "description": "Transformer un objectif en plan concret en 5 étapes.",
        "steps": {
            "mission": "À partir de mon objectif principal, produire un plan d'action en 5 étapes avec responsables, délais et critères de succès.",
            "agents": ["coordinateur", "commercial"],
        },
    },
    {
        "slug": "synthese-livrables",
        "name": "Synthèse livrables",
        "description": "Consolider les livrables récents en note de synthèse.",
        "steps": {
            "mission": "Synthétiser les livrables et missions récentes en une note executive claire (contexte, décisions, prochaines actions).",
            "agents": ["coordinateur"],
        },
    },
)


def _seed_workspace_starters(workspace_id: str) -> None:
    from database import upsert_mission_template, upsert_playbook

    suffix = workspace_id.replace("ws-", "")[:10]
    for pb in _STARTER_PLAYBOOKS:
        pid = f"starter-{suffix}-{pb['slug']}"
        upsert_playbook(
            pid,
            name=pb["name"],
            description=pb["description"],
            category="starter",
            steps=pb["steps"],
        )
    tpl_id = f"starter-{suffix}-mission-express"
    upsert_mission_template(
        tpl_id,
        name="Mission express",
        description="Modèle générique pour lancer une première mission.",
        agent="coordinateur",
        mission_text="Décrire l'objectif, le contexte et le livrable attendu pour {{objectif}}.",
        variables=["objectif"],
        config={"mode": "cio", "require_user_validation": True},
    )


def update_user_profile(user_id: str, *, display_name: str | None = None) -> dict[str, Any] | None:
    from database import get_conn

    uid = (user_id or "").strip()
    if not uid:
        return None
    name = (display_name or "").strip()[:120]
    if not name:
        return get_user_by_id(uid)
    with get_conn() as conn:
        conn.execute("UPDATE korymb_users SET display_name = ? WHERE id = ?", (name, uid))
        conn.commit()
    return get_user_by_id(uid)


def update_workspace_name(workspace_id: str, name: str) -> dict[str, Any] | None:
    from database import get_conn

    wid = (workspace_id or "").strip()
    label = (name or "").strip()[:200]
    if not wid or not label:
        return get_workspace_by_id(wid)
    with get_conn() as conn:
        conn.execute("UPDATE korymb_workspaces SET name = ? WHERE id = ?", (label, wid))
        conn.commit()
    return get_workspace_by_id(wid)


def ensure_admin_membership(workspace_id: str, user_id: str) -> None:
    """Garantit un membership admin sur l'espace (idempotent)."""
    from database import get_conn

    existing = get_membership(workspace_id, user_id)
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        if existing:
            conn.execute(
                "UPDATE korymb_memberships SET role = 'admin' WHERE workspace_id = ? AND user_id = ?",
                (workspace_id, user_id),
            )
        else:
            conn.execute(
                "INSERT INTO korymb_memberships (workspace_id, user_id, role, created_at) VALUES (?, ?, 'admin', ?)",
                (workspace_id, user_id, now),
            )
        conn.execute(
            "UPDATE korymb_workspaces SET owner_user_id = ? WHERE id = ?",
            (user_id, workspace_id),
        )
        conn.commit()


def seed_bootstrap_admin() -> None:
    """
    Crée le compte admin initial (variables KORYMB_BOOTSTRAP_ADMIN_*).
    Rattaché à l'espace legacy qui contient les données existantes.
    """
    from config import settings
    from services.workspace_auth import hash_password

    email = (settings.bootstrap_admin_email or "").strip().lower()
    password = settings.bootstrap_admin_password or ""
    if not email or not password:
        return
    if len(password) < 8:
        return

    display = (settings.bootstrap_admin_display_name or email.split("@")[0])[:120]
    ws_name = (settings.bootstrap_workspace_name or "Korymb — Élude In Art")[:200]

    from database import get_conn

    with get_conn() as conn:
        row = conn.execute(
            "SELECT id FROM korymb_workspaces WHERE id = ?",
            (_DEFAULT_WORKSPACE_ID,),
        ).fetchone()
        if row:
            conn.execute(
                "UPDATE korymb_workspaces SET name = ? WHERE id = ?",
                (ws_name, _DEFAULT_WORKSPACE_ID),
            )
            conn.commit()

    user = get_user_by_email(email)
    if not user:
        user = create_user(email, hash_password(password), display)
    ensure_admin_membership(_DEFAULT_WORKSPACE_ID, user["id"])
