"""
workspace_db.py — Espaces Korymb (multi-tenant), utilisateurs et memberships.
"""
from __future__ import annotations

import json
import re
import secrets
import uuid
from datetime import datetime
from typing import Any

from tenant_context import Role, get_workspace_id, set_tenant_context

_DEFAULT_WORKSPACE_ID = "ws-default-legacy"
_DEFAULT_WORKSPACE_SLUG = "default"
PUBLIC_STOREFRONT_SLUG = "eludein"
STOREFRONT_ACCENTS = ("emerald", "terracotta", "violet", "ocean")
STOREFRONT_PAPERS = ("warm", "cool", "ink")
STOREFRONT_TYPEFACES = ("sans", "serif")
OFFER_KINDS = ("", "atelier", "visio", "module")

_ELUDEIN_DEFAULT_OFFERS: tuple[dict[str, str], ...] = (
    {
        "title": "Accompagnement individuel",
        "summary": "Conduire votre projet, séance après séance — en présentiel ou à distance.",
    },
    {
        "title": "Ateliers et stages",
        "summary": "Parcours de groupe, éventuellement hybrides : présentiel, visio et ressources (vidéo, podcast, documents).",
    },
    {
        "title": "Conseil, développement et IA",
        "summary": "Greffer un jalon technique ou un copilote à votre accompagnement.",
    },
)

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
    "chat_conversations",
    "inbox_dismissals",
    "library_dismissals",
    "scheduled_tasks",
    "autonomous_outputs",
    "action_tickets",
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
    _ensure_workspace_public_columns(conn)
    _ensure_membership_participant_columns(conn)
    _ensure_default_workspace_row(conn)
    _seed_legacy_storefront(conn)


def _ensure_workspace_public_columns(conn) -> None:
    cols = _table_columns(conn, "korymb_workspaces")
    alterations = {
        "public_enabled": "INTEGER NOT NULL DEFAULT 0",
        "tagline": "TEXT NOT NULL DEFAULT ''",
        "intro": "TEXT NOT NULL DEFAULT ''",
        "offers_json": "TEXT NOT NULL DEFAULT '[]'",
        "location": "TEXT NOT NULL DEFAULT ''",
        "contact_email": "TEXT NOT NULL DEFAULT ''",
        "contact_url": "TEXT NOT NULL DEFAULT ''",
        "accent": "TEXT NOT NULL DEFAULT 'emerald'",
        "paper": "TEXT NOT NULL DEFAULT 'warm'",
        "typeface": "TEXT NOT NULL DEFAULT 'sans'",
        "logo_file_id": "TEXT NOT NULL DEFAULT ''",
        "cover_file_id": "TEXT NOT NULL DEFAULT ''",
    }
    for name, ddl in alterations.items():
        if name not in cols:
            try:
                conn.execute(f"ALTER TABLE korymb_workspaces ADD COLUMN {name} {ddl}")
            except Exception:
                pass


PARTICIPANT_STATUSES = ("pending", "guest", "active", "disabled")


def normalize_participant_status(raw: Any, *, role: str = "") -> str:
    value = str(raw or "").strip().lower()
    if value in PARTICIPANT_STATUSES:
        return value
    if str(role or "").strip() == "subscriber":
        return "active"
    return "active"


def participant_is_active(status: str | None, *, role: str = "") -> bool:
    from tenant_context import is_operator_role

    if is_operator_role(role):
        return True
    return normalize_participant_status(status, role=role) == "active"


def _ensure_membership_participant_columns(conn) -> None:
    cols = _table_columns(conn, "korymb_memberships")
    alterations = {
        "status": "TEXT NOT NULL DEFAULT 'active'",
        "invite_code": "TEXT NOT NULL DEFAULT ''",
        "invited_at": "TEXT",
        "validated_at": "TEXT",
    }
    for name, ddl in alterations.items():
        if name not in cols:
            try:
                conn.execute(f"ALTER TABLE korymb_memberships ADD COLUMN {name} {ddl}")
            except Exception:
                pass
    try:
        conn.execute(
            "UPDATE korymb_memberships SET status='active' "
            "WHERE role='subscriber' AND (status IS NULL OR status='')"
        )
    except Exception:
        pass


def _seed_legacy_storefront(conn) -> None:
    """Première vitrine : espace legacy Élude In Art (slug eludein)."""
    row = conn.execute(
        "SELECT * FROM korymb_workspaces WHERE id = ?",
        (_DEFAULT_WORKSPACE_ID,),
    ).fetchone()
    if not row:
        return
    d = dict(row)
    slug = str(d.get("slug") or "").strip()
    tagline = str(d.get("tagline") or "").strip()
    if slug in ("", _DEFAULT_WORKSPACE_SLUG):
        taken = conn.execute(
            "SELECT id FROM korymb_workspaces WHERE slug = ? AND id <> ?",
            (PUBLIC_STOREFRONT_SLUG, _DEFAULT_WORKSPACE_ID),
        ).fetchone()
        if not taken:
            conn.execute(
                "UPDATE korymb_workspaces SET slug = ? WHERE id = ?",
                (PUBLIC_STOREFRONT_SLUG, _DEFAULT_WORKSPACE_ID),
            )
    if not tagline:
        conn.execute(
            "UPDATE korymb_workspaces SET tagline = ?, intro = ?, offers_json = ?, public_enabled = 1 WHERE id = ?",
            (
                "Accompagner vos projets, en présence et en matière.",
                "Élude In Art accompagne des personnes et des groupes à conduire leurs projets — "
                "en présentiel, à distance, ou les deux (visio et ressources : vidéo, podcast, documents).",
                json.dumps(list(_ELUDEIN_DEFAULT_OFFERS), ensure_ascii=False),
                _DEFAULT_WORKSPACE_ID,
            ),
        )
    location = str(d.get("location") or "").strip()
    if not location:
        try:
            conn.execute(
                "UPDATE korymb_workspaces SET location = ?, accent = ?, paper = ?, typeface = ? "
                "WHERE id = ? AND (location = '' OR location IS NULL)",
                ("SÏvåñà, Tourves", "terracotta", "warm", "serif", _DEFAULT_WORKSPACE_ID),
            )
        except Exception:
            pass


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


def get_workspace_by_slug(slug: str) -> dict[str, Any] | None:
    from database import get_conn

    key = sanitize_public_slug(slug)
    if not key:
        return None
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM korymb_workspaces WHERE slug = ?", (key,)).fetchone()
    return dict(row) if row else None


def sanitize_public_slug(slug: str) -> str:
    return re.sub(r"[^a-z0-9-]+", "", (slug or "").strip().lower())[:48]


def parse_workspace_offers(raw: Any) -> list[dict[str, str]]:
    data = raw
    if isinstance(raw, str):
        try:
            data = json.loads(raw or "[]")
        except json.JSONDecodeError:
            return []
    if not isinstance(data, list):
        return []
    out: list[dict[str, str]] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip()[:120]
        summary = str(item.get("summary") or "").strip()[:500]
        kind = str(item.get("kind") or "").strip()
        if kind not in OFFER_KINDS:
            kind = ""
        if title:
            out.append({"title": title, "summary": summary, "kind": kind})
    return out[:12]


def normalize_storefront_accent(value: str | None) -> str:
    raw = (value or "").strip()
    return raw if raw in STOREFRONT_ACCENTS else "emerald"


def normalize_storefront_paper(value: str | None) -> str:
    raw = (value or "").strip()
    return raw if raw in STOREFRONT_PAPERS else "warm"


def normalize_storefront_typeface(value: str | None) -> str:
    raw = (value or "").strip()
    return raw if raw in STOREFRONT_TYPEFACES else "sans"


def _brand_public_url(slug: str, kind: str) -> str:
    clean = sanitize_public_slug(slug)
    if not clean or kind not in ("logo", "cover"):
        return ""
    return f"/api/public/storefront/{clean}/brand/{kind}?inline=true"


def workspace_public_enabled(row: dict[str, Any] | None) -> bool:
    if not row:
        return False
    val = row.get("public_enabled")
    if isinstance(val, bool):
        return val
    try:
        return int(val or 0) == 1
    except (TypeError, ValueError):
        return str(val).strip().lower() in ("1", "true", "yes")


def public_workspace_payload(row: dict[str, Any]) -> dict[str, Any]:
    slug = str(row.get("slug") or "").strip()
    logo_id = str(row.get("logo_file_id") or "").strip()
    cover_id = str(row.get("cover_file_id") or "").strip()
    return {
        "id": row.get("id"),
        "name": row.get("name"),
        "slug": slug,
        "tagline": str(row.get("tagline") or "").strip(),
        "intro": str(row.get("intro") or "").strip(),
        "offers": parse_workspace_offers(row.get("offers_json")),
        "public_enabled": workspace_public_enabled(row),
        "location": str(row.get("location") or "").strip(),
        "contact_email": str(row.get("contact_email") or "").strip(),
        "contact_url": str(row.get("contact_url") or "").strip()[:500],
        "accent": normalize_storefront_accent(str(row.get("accent") or "")),
        "paper": normalize_storefront_paper(str(row.get("paper") or "")),
        "typeface": normalize_storefront_typeface(str(row.get("typeface") or "")),
        "has_logo": bool(logo_id),
        "has_cover": bool(cover_id),
        "logo_url": _brand_public_url(slug, "logo") if logo_id else "",
        "cover_url": _brand_public_url(slug, "cover") if cover_id else "",
        "logo_file_id": logo_id,
        "cover_file_id": cover_id,
    }


def update_workspace_storefront(
    workspace_id: str,
    *,
    public_enabled: bool | None = None,
    tagline: str | None = None,
    intro: str | None = None,
    offers: list[dict[str, str]] | None = None,
    slug: str | None = None,
    name: str | None = None,
    location: str | None = None,
    contact_email: str | None = None,
    contact_url: str | None = None,
    accent: str | None = None,
    paper: str | None = None,
    typeface: str | None = None,
    logo_file_id: str | None = None,
    cover_file_id: str | None = None,
) -> dict[str, Any] | None:
    from database import get_conn

    wid = (workspace_id or "").strip()
    current = get_workspace_by_id(wid)
    if not current:
        return None
    sets: list[str] = []
    vals: list[Any] = []
    if public_enabled is not None:
        sets.append("public_enabled = ?")
        vals.append(1 if public_enabled else 0)
    if tagline is not None:
        sets.append("tagline = ?")
        vals.append(tagline.strip()[:240])
    if intro is not None:
        sets.append("intro = ?")
        vals.append(intro.strip()[:4000])
    if offers is not None:
        sets.append("offers_json = ?")
        vals.append(json.dumps(parse_workspace_offers(offers), ensure_ascii=False))
    if slug is not None:
        clean = sanitize_public_slug(slug)
        if len(clean) < 2:
            raise ValueError("Le slug public doit contenir au moins 2 caractères (lettres, chiffres, tirets).")
        existing = get_workspace_by_slug(clean)
        if existing and existing.get("id") != wid:
            raise ValueError("Ce slug public est déjà utilisé par un autre espace.")
        sets.append("slug = ?")
        vals.append(clean)
    if name is not None:
        label = name.strip()[:200]
        if not label:
            raise ValueError("Le nom public ne peut pas être vide.")
        sets.append("name = ?")
        vals.append(label)
    if location is not None:
        sets.append("location = ?")
        vals.append(location.strip()[:200])
    if contact_email is not None:
        sets.append("contact_email = ?")
        vals.append(contact_email.strip()[:191])
    if contact_url is not None:
        sets.append("contact_url = ?")
        vals.append(contact_url.strip()[:500])
    if accent is not None:
        sets.append("accent = ?")
        vals.append(normalize_storefront_accent(accent))
    if paper is not None:
        sets.append("paper = ?")
        vals.append(normalize_storefront_paper(paper))
    if typeface is not None:
        sets.append("typeface = ?")
        vals.append(normalize_storefront_typeface(typeface))
    if logo_file_id is not None:
        sets.append("logo_file_id = ?")
        vals.append(logo_file_id.strip()[:191])
    if cover_file_id is not None:
        sets.append("cover_file_id = ?")
        vals.append(cover_file_id.strip()[:191])
    if not sets:
        return current
    vals.append(wid)
    with get_conn() as conn:
        conn.execute(
            f"UPDATE korymb_workspaces SET {', '.join(sets)} WHERE id = ?",
            tuple(vals),
        )
        conn.commit()
    return get_workspace_by_id(wid)


def list_workspace_subscribers(workspace_id: str) -> list[dict[str, Any]]:
    from database import get_conn

    with get_conn() as conn:
        _ensure_membership_participant_columns(conn)
        rows = conn.execute(
            """
            SELECT u.id, u.email, u.display_name, m.role, m.created_at,
                   m.status, m.invite_code, m.invited_at, m.validated_at
            FROM korymb_memberships m
            JOIN korymb_users u ON u.id = m.user_id
            WHERE m.workspace_id = ? AND m.role = 'subscriber'
            ORDER BY m.created_at ASC
            """,
            (workspace_id,),
        ).fetchall()
    return [serialize_participant(dict(r), include_invite_code=True) for r in rows or []]


def serialize_participant(row: dict[str, Any], *, include_invite_code: bool = False) -> dict[str, Any]:
    status = normalize_participant_status(row.get("status"), role=str(row.get("role") or "subscriber"))
    out = {
        "id": str(row.get("id") or row.get("user_id") or ""),
        "email": str(row.get("email") or ""),
        "display_name": str(row.get("display_name") or ""),
        "role": str(row.get("role") or "subscriber"),
        "status": status,
        "created_at": row.get("created_at"),
        "invited_at": row.get("invited_at"),
        "validated_at": row.get("validated_at"),
    }
    if include_invite_code and status == "guest":
        out["invite_code"] = str(row.get("invite_code") or "")
    return out


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
        _ensure_membership_participant_columns(conn)
        row = conn.execute(
            "SELECT * FROM korymb_memberships WHERE workspace_id = ? AND user_id = ?",
            (workspace_id, user_id),
        ).fetchone()
    if not row:
        return None
    out = dict(row)
    out["status"] = normalize_participant_status(out.get("status"), role=str(out.get("role") or ""))
    return out


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


def list_workspace_operators(workspace_id: str) -> list[dict[str, Any]]:
    return [m for m in list_workspace_members(workspace_id) if m.get("role") in ("admin", "member")]


def add_member(
    workspace_id: str,
    email: str,
    role: Role = "member",
    *,
    status: str = "active",
    invite_code: str = "",
) -> dict[str, Any]:
    from tenant_context import normalize_role

    role = normalize_role(role)
    user = get_user_by_email(email)
    if not user:
        raise ValueError("Aucun compte avec cet e-mail. L'utilisateur doit d'abord s'inscrire.")
    membership = get_membership(workspace_id, user["id"])
    if membership:
        raise ValueError("Cet utilisateur fait déjà partie de l'espace.")
    from database import get_conn

    now = datetime.utcnow().isoformat()
    st = normalize_participant_status(status, role=role)
    code = (invite_code or "").strip()
    invited_at = now if st == "guest" else None
    validated_at = now if st == "active" and role == "subscriber" else None
    with get_conn() as conn:
        _ensure_membership_participant_columns(conn)
        conn.execute(
            "INSERT INTO korymb_memberships "
            "(workspace_id, user_id, role, created_at, status, invite_code, invited_at, validated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (workspace_id, user["id"], role, now, st, code, invited_at, validated_at),
        )
        conn.commit()
    return {
        "user_id": user["id"],
        "email": user["email"],
        "role": role,
        "status": st,
        "invite_code": code if st == "guest" else "",
    }


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


def update_user_password(user_id: str, *, current_password: str, new_password: str) -> dict[str, Any] | None:
    from database import get_conn
    from services.workspace_auth import hash_password, verify_password

    uid = (user_id or "").strip()
    if not uid:
        return None
    new_pwd = (new_password or "").strip()
    if len(new_pwd) < 8:
        raise ValueError("Le nouveau mot de passe doit contenir au moins 8 caractères.")
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM korymb_users WHERE id = ?", (uid,)).fetchone()
    if not row:
        return None
    stored = str(dict(row).get("password_hash") or "")
    if not verify_password(current_password, stored):
        raise ValueError("Mot de passe actuel incorrect.")
    hashed = hash_password(new_pwd)
    with get_conn() as conn:
        conn.execute("UPDATE korymb_users SET password_hash = ? WHERE id = ?", (hashed, uid))
        conn.commit()
    return get_user_by_id(uid)


def set_user_password_hash(user_id: str, password_hash: str) -> dict[str, Any] | None:
    from database import get_conn

    uid = (user_id or "").strip()
    hashed = (password_hash or "").strip()
    if not uid or not hashed:
        return None
    with get_conn() as conn:
        conn.execute("UPDATE korymb_users SET password_hash = ? WHERE id = ?", (hashed, uid))
        conn.commit()
    return get_user_by_id(uid)


def new_invite_code() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(8))


def upsert_subscriber_membership(
    workspace_id: str,
    user_id: str,
    *,
    status: str,
    invite_code: str = "",
    display_name: str = "",
) -> dict[str, Any]:
    from database import get_conn

    wid = (workspace_id or "").strip()
    uid = (user_id or "").strip()
    now = datetime.utcnow().isoformat()
    st = normalize_participant_status(status, role="subscriber")
    code = (invite_code or "").strip().upper()
    membership = get_membership(wid, uid)
    with get_conn() as conn:
        _ensure_membership_participant_columns(conn)
        if membership:
            conn.execute(
                "UPDATE korymb_memberships SET status=?, invite_code=?, invited_at=COALESCE(invited_at, ?) "
                "WHERE workspace_id=? AND user_id=?",
                (st, code if st == "guest" else "", now if st == "guest" else None, wid, uid),
            )
        else:
            conn.execute(
                "INSERT INTO korymb_memberships "
                "(workspace_id, user_id, role, created_at, status, invite_code, invited_at, validated_at) "
                "VALUES (?, ?, 'subscriber', ?, ?, ?, ?, ?)",
                (
                    wid, uid, now, st, code if st == "guest" else "",
                    now if st == "guest" else None,
                    now if st == "active" else None,
                ),
            )
        conn.commit()
    if display_name.strip():
        update_user_profile(uid, display_name=display_name)
    row = get_membership(wid, uid) or {}
    user = get_user_by_id(uid) or {}
    return serialize_participant({**user, **row, "id": uid}, include_invite_code=True)


def set_subscriber_status(workspace_id: str, user_id: str, status: str) -> dict[str, Any] | None:
    from database import get_conn

    membership = get_membership(workspace_id, user_id)
    if not membership or str(membership.get("role") or "") != "subscriber":
        return None
    st = normalize_participant_status(status, role="subscriber")
    now = datetime.utcnow().isoformat()
    validated_at = now if st == "active" else membership.get("validated_at")
    invite_code = "" if st != "guest" else str(membership.get("invite_code") or "")
    with get_conn() as conn:
        _ensure_membership_participant_columns(conn)
        conn.execute(
            "UPDATE korymb_memberships SET status=?, invite_code=?, validated_at=? "
            "WHERE workspace_id=? AND user_id=?",
            (st, invite_code, validated_at, workspace_id, user_id),
        )
        conn.commit()
    user = get_user_by_id(user_id) or {}
    row = get_membership(workspace_id, user_id) or {}
    return serialize_participant({**user, **row, "id": user_id}, include_invite_code=True)


def get_guest_membership_by_code(workspace_id: str, email: str, code: str) -> dict[str, Any] | None:
    from database import get_conn

    wid = (workspace_id or "").strip()
    mail = (email or "").strip().lower()
    token = (code or "").strip().upper()
    if not wid or not mail or not token:
        return None
    with get_conn() as conn:
        _ensure_membership_participant_columns(conn)
        row = conn.execute(
            """
            SELECT m.*, u.email, u.display_name
            FROM korymb_memberships m
            JOIN korymb_users u ON u.id = m.user_id
            WHERE m.workspace_id=? AND m.role='subscriber' AND m.status='guest'
              AND LOWER(u.email)=? AND UPPER(m.invite_code)=?
            """,
            (wid, mail, token),
        ).fetchone()
    return dict(row) if row else None


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
