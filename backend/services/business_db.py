"""
business_db.py — Données métier Korymb (contacts, projets, devis, planning, factures Tiime).

Les factures légales sont émises dans Tiime ; Korymb conserve devis + références externes.
"""
from __future__ import annotations

import json
import re
import secrets
from datetime import datetime, timedelta
from typing import Any

from database import get_conn, _is_mariadb
from workspace_db import ws_id

# ── Constantes métier ─────────────────────────────────────────────────────────

CONTACT_TYPES = ("prospect", "client", "partenaire", "autre")
CONTACT_STATUSES = ("active", "inactive", "archived")
PROJECT_TYPES = ("seance", "stage", "module_pro", "accompagnement", "sivana", "autre")
PROJECT_STATUSES = ("draft", "active", "on_hold", "completed", "cancelled")
QUOTE_STATUSES = ("draft", "sent", "accepted", "refused", "expired")
EVENT_TYPES = ("seance", "stage", "atelier", "visio", "jalon", "ressource", "autre")
EVENT_STATUSES = ("planned", "confirmed", "done", "cancelled")
EVENT_MODALITIES = ("", "presentiel", "visio", "async")
EVENT_NATURES = ("presence", "matiere")
EVENT_RESOURCE_TYPES = ("", "video", "podcast", "document")
EVENT_VISIBILITIES = ("internal", "selected", "participants", "public")
INTERACTION_TYPES = ("prospection", "email", "call", "meeting", "note", "quote", "mission", "other")
INVOICE_STATUSES = ("pending", "issued", "paid", "cancelled", "error")
ENRICHMENT_STATUSES = ("pending", "applied", "rejected")
CONTACT_PROFILE_FIELDS = (
    "email",
    "phone",
    "website",
    "linkedin_url",
    "address",
    "city",
    "postal_code",
)


def _now() -> str:
    return datetime.utcnow().isoformat()


def _new_id(prefix: str) -> str:
    return f"{prefix}-{secrets.token_hex(6)}"


def _ws() -> str:
    return ws_id()


def _text_pk() -> str:
    return "VARCHAR(191)" if _is_mariadb() else "TEXT"


def _table_columns(conn, table: str) -> set[str]:
    if _is_mariadb():
        cur = conn.execute(f"SHOW COLUMNS FROM {table}")
        return {str(row["Field"]) for row in cur.fetchall()}
    cur = conn.execute(f"PRAGMA table_info({table})")
    return {str(row[1]) for row in cur.fetchall()}


def _ensure_biz_contacts_columns(conn) -> None:
    cols = _table_columns(conn, "biz_contacts")
    alterations = {
        "website": "TEXT NOT NULL DEFAULT ''",
        "linkedin_url": "TEXT NOT NULL DEFAULT ''",
        "address": "TEXT NOT NULL DEFAULT ''",
        "city": "TEXT NOT NULL DEFAULT ''",
        "postal_code": "TEXT NOT NULL DEFAULT ''",
        "socials_json": "TEXT NOT NULL DEFAULT '{}'",
        "verified_at": "TEXT",
        "outreach_suggestions": "TEXT NOT NULL DEFAULT ''",
    }
    for name, ddl in alterations.items():
        if name not in cols:
            conn.execute(f"ALTER TABLE biz_contacts ADD COLUMN {name} {ddl}")


def _ensure_biz_email_messages_columns(conn) -> None:
    cols = _table_columns(conn, "biz_email_messages")
    if cols and "attachments_json" not in cols:
        conn.execute(
            "ALTER TABLE biz_email_messages ADD COLUMN attachments_json TEXT NOT NULL DEFAULT '[]'"
        )


def _ensure_biz_calendar_event_columns(conn) -> None:
    cols = _table_columns(conn, "biz_calendar_events")
    if not cols:
        return
    alterations = {
        "is_public": "INTEGER NOT NULL DEFAULT 0",
        "modality": "TEXT NOT NULL DEFAULT ''",
        "nature": "TEXT NOT NULL DEFAULT 'presence'",
        "resource_type": "TEXT NOT NULL DEFAULT ''",
        "resource_url": "TEXT NOT NULL DEFAULT ''",
        "resource_file_id": "TEXT NOT NULL DEFAULT ''",
        "cover_file_id": "TEXT NOT NULL DEFAULT ''",
        "visibility": "TEXT NOT NULL DEFAULT 'internal'",
    }
    for name, ddl in alterations.items():
        if name not in cols:
            conn.execute(f"ALTER TABLE biz_calendar_events ADD COLUMN {name} {ddl}")
    # Cohérence : un créneau coché « publié » sans visibilité explicite est pour les inscrits.
    conn.execute(
        "UPDATE biz_calendar_events SET visibility='participants' "
        "WHERE is_public=1 AND (visibility IS NULL OR visibility='' OR visibility='internal')"
    )


def _ensure_biz_event_audience_table(conn) -> None:
    pk = _text_pk()
    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS biz_event_audience (
            event_id     {pk} NOT NULL,
            contact_id   {pk} NOT NULL,
            workspace_id {pk} NOT NULL,
            created_at   TEXT NOT NULL,
            PRIMARY KEY (event_id, contact_id)
        )
    """)
    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS biz_event_audience_users (
            event_id     {pk} NOT NULL,
            user_id      {pk} NOT NULL,
            workspace_id {pk} NOT NULL,
            created_at   TEXT NOT NULL,
            PRIMARY KEY (event_id, user_id)
        )
    """)


def normalize_event_visibility(visibility: str | None = None, *, is_public: Any = None) -> str:
    raw = (visibility or "").strip()
    if raw in EVENT_VISIBILITIES:
        return raw
    if _event_flag(is_public):
        return "participants"
    return "internal"


def visibility_listed_publicly(visibility: str) -> bool:
    return visibility in ("participants", "public")


def _event_flag(val: Any) -> bool:
    if isinstance(val, bool):
        return val
    if val in (1, "1"):
        return True
    return False


def normalize_event_nature(nature: str | None, *, resource_type: str = "", modality: str = "") -> str:
    raw = (nature or "").strip()
    if raw in EVENT_NATURES:
        return raw
    if (resource_type or "").strip() or modality == "async":
        return "matiere"
    return "presence"


def _resource_file_meta(file_id: str) -> dict[str, Any]:
    fid = (file_id or "").strip()
    empty = {
        "resource_file_id": "",
        "resource_filename": "",
        "resource_file_size": 0,
        "resource_file_mime": "",
    }
    if not fid:
        return empty
    from services.resource_files import load_local_file

    item = load_local_file(fid)
    if not item:
        return {**empty, "resource_file_id": fid}
    return {
        "resource_file_id": fid,
        "resource_filename": str(item.get("filename") or "fichier"),
        "resource_file_size": int(item.get("size") or 0),
        "resource_file_mime": str(item.get("mime") or "application/octet-stream"),
    }


def _is_image_mime(mime: str, filename: str = "") -> bool:
    m = (mime or "").lower()
    if m.startswith("image/"):
        return True
    name = (filename or "").lower()
    return name.endswith((".png", ".jpg", ".jpeg", ".webp", ".gif"))


def _cover_meta(row: dict) -> dict[str, Any]:
    """Cover dédiée, sinon fichier ressource s'il est une image."""
    empty = {
        "cover_file_id": str(row.get("cover_file_id") or "").strip(),
        "has_cover": False,
        "cover_source": "",
        "cover_mime": "",
        "cover_filename": "",
    }
    cover_id = empty["cover_file_id"]
    if cover_id:
        from services.resource_files import load_local_file

        item = load_local_file(cover_id, workspace_id=str(row.get("workspace_id") or "") or None)
        if item and _is_image_mime(str(item.get("mime") or ""), str(item.get("filename") or "")):
            return {
                "cover_file_id": cover_id,
                "has_cover": True,
                "cover_source": "cover",
                "cover_mime": str(item.get("mime") or "image/jpeg"),
                "cover_filename": str(item.get("filename") or "cover"),
            }
    res_id = str(row.get("resource_file_id") or "").strip()
    if res_id:
        meta = _resource_file_meta(res_id)
        if meta.get("resource_filename") and _is_image_mime(
            str(meta.get("resource_file_mime") or ""),
            str(meta.get("resource_filename") or ""),
        ):
            return {
                "cover_file_id": cover_id,
                "has_cover": True,
                "cover_source": "resource",
                "cover_mime": str(meta.get("resource_file_mime") or "image/jpeg"),
                "cover_filename": str(meta.get("resource_filename") or "image"),
            }
    return empty


def event_has_resource(row: dict | None) -> bool:
    if not row:
        return False
    return bool(str(row.get("resource_type") or "").strip())


def event_resource_time_unlocked(row: dict | None) -> bool:
    if not row or not event_has_resource(row):
        return False
    vis = normalize_event_visibility(str(row.get("visibility") or ""), is_public=row.get("is_public"))
    if vis == "internal":
        return False
    if str(row.get("status") or "") not in ("planned", "confirmed", "done"):
        return False
    starts = str(row.get("starts_at") or "")
    if not starts or starts > datetime.utcnow().isoformat():
        return False
    return True


def event_resource_unlocked(row: dict | None) -> bool:
    """Compat : ressource ouverte dans le temps (hors interne). L’ACL se fait à part."""
    return event_resource_time_unlocked(row)


def _audience_ids_for_event(event_id: str, workspace_id: str | None = None) -> list[str]:
    eid = (event_id or "").strip()
    if not eid:
        return []
    wid = (workspace_id or _ws() or "").strip()
    with get_conn() as conn:
        _ensure_biz_event_audience_table(conn)
        sql = "SELECT contact_id FROM biz_event_audience WHERE event_id=?"
        params: list[Any] = [eid]
        if wid:
            sql += " AND workspace_id=?"
            params.append(wid)
        rows = conn.execute(sql, tuple(params)).fetchall()
    return [str(r["contact_id"]) for r in rows or [] if r]


def _replace_event_audience(event_id: str, contact_ids: list[str] | None, *, workspace_id: str | None = None) -> list[str]:
    eid = (event_id or "").strip()
    if not eid:
        return []
    wid = (workspace_id or _ws() or "").strip()
    wanted = []
    seen: set[str] = set()
    for raw in contact_ids or []:
        cid = str(raw or "").strip()
        if cid and cid not in seen:
            seen.add(cid)
            wanted.append(cid)
    if wanted:
        placeholders = ",".join("?" * len(wanted))
        with get_conn() as conn:
            rows = conn.execute(
                f"SELECT id FROM biz_contacts WHERE workspace_id=? AND id IN ({placeholders})",
                tuple([wid, *wanted]),
            ).fetchall()
        valid = {str(r["id"]) for r in rows or []}
        wanted = [cid for cid in wanted if cid in valid]
    now = _now()
    with get_conn() as conn:
        _ensure_biz_event_audience_table(conn)
        conn.execute("DELETE FROM biz_event_audience WHERE event_id=? AND workspace_id=?", (eid, wid))
        for cid in wanted:
            conn.execute(
                "INSERT INTO biz_event_audience (event_id, contact_id, workspace_id, created_at) VALUES (?,?,?,?)",
                (eid, cid, wid, now),
            )
        conn.commit()
    return wanted


def _audience_user_ids_for_event(event_id: str, workspace_id: str | None = None) -> list[str]:
    eid = (event_id or "").strip()
    if not eid:
        return []
    wid = (workspace_id or _ws() or "").strip()
    with get_conn() as conn:
        _ensure_biz_event_audience_table(conn)
        sql = "SELECT user_id FROM biz_event_audience_users WHERE event_id=?"
        params: list[Any] = [eid]
        if wid:
            sql += " AND workspace_id=?"
            params.append(wid)
        rows = conn.execute(sql, tuple(params)).fetchall()
    return [str(r["user_id"]) for r in rows or [] if r]


def _replace_event_audience_users(event_id: str, user_ids: list[str] | None, *, workspace_id: str | None = None) -> list[str]:
    eid = (event_id or "").strip()
    if not eid:
        return []
    wid = (workspace_id or _ws() or "").strip()
    wanted = []
    seen: set[str] = set()
    for raw in user_ids or []:
        uid = str(raw or "").strip()
        if uid and uid not in seen:
            seen.add(uid)
            wanted.append(uid)
    now = _now()
    with get_conn() as conn:
        _ensure_biz_event_audience_table(conn)
        conn.execute("DELETE FROM biz_event_audience_users WHERE event_id=? AND workspace_id=?", (eid, wid))
        for uid in wanted:
            conn.execute(
                "INSERT INTO biz_event_audience_users (event_id, user_id, workspace_id, created_at) VALUES (?,?,?,?)",
                (eid, uid, wid, now),
            )
        conn.commit()
    return wanted


def _contact_ids_matching_email(workspace_id: str, email: str) -> list[str]:
    wid = (workspace_id or "").strip()
    mail = (email or "").strip().lower()
    if not wid or not mail:
        return []
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id FROM biz_contacts WHERE workspace_id=? AND LOWER(email)=?",
            (wid, mail),
        ).fetchall()
    return [str(r["id"]) for r in rows or [] if r]


def event_visible_to_viewer(
    row: dict | None,
    *,
    viewer_email: str = "",
    viewer_contact_ids: list[str] | None = None,
    viewer_user_id: str = "",
    viewer_active: bool = False,
    public_catalog: bool = False,
) -> bool:
    if not row:
        return False
    vis = normalize_event_visibility(str(row.get("visibility") or ""), is_public=row.get("is_public"))
    if vis == "internal":
        return False
    if vis == "public":
        return True
    if public_catalog:
        return vis == "participants"
    if not viewer_active:
        return False
    if vis == "participants":
        return True
    if vis == "selected":
        user_ids = row.get("audience_user_ids")
        if not isinstance(user_ids, list):
            user_ids = _audience_user_ids_for_event(str(row.get("id") or ""), str(row.get("workspace_id") or ""))
        allowed_users = {str(x) for x in user_ids if x}
        if allowed_users:
            return str(viewer_user_id or "") in allowed_users
        ids = viewer_contact_ids
        if ids is None:
            ids = _contact_ids_matching_email(str(row.get("workspace_id") or _ws() or ""), viewer_email)
        audience = row.get("audience_contact_ids")
        if not isinstance(audience, list):
            audience = _audience_ids_for_event(str(row.get("id") or ""), str(row.get("workspace_id") or ""))
        allowed = {str(x) for x in audience}
        return any(cid in allowed for cid in ids)
    return False


def serialize_calendar_event(row: dict | None, *, audience_ids: list[str] | None = None) -> dict | None:
    if not row:
        return None
    out = dict(row)
    vis = normalize_event_visibility(str(out.get("visibility") or ""), is_public=out.get("is_public"))
    out["visibility"] = vis
    out["is_public"] = visibility_listed_publicly(vis)
    out["modality"] = str(out.get("modality") or "")
    rtype = str(out.get("resource_type") or "")
    if rtype not in EVENT_RESOURCE_TYPES:
        rtype = ""
    out["resource_type"] = rtype
    out["resource_url"] = str(out.get("resource_url") or "").strip()
    out.update(_resource_file_meta(str(out.get("resource_file_id") or "")))
    out.update(_cover_meta(out))
    out["nature"] = normalize_event_nature(
        str(out.get("nature") or ""),
        resource_type=rtype,
        modality=str(out.get("modality") or ""),
    )
    out["is_follow_up"] = is_crm_follow_up_title(str(out.get("title") or ""))
    # Évite un aller-retour SQL par créneau : l’audience ne sert que si le créneau est nominatif.
    if vis != "selected":
        out["audience_contact_ids"] = list(audience_ids) if audience_ids is not None else []
        out["audience_user_ids"] = []
        return out
    if audience_ids is None:
        audience_ids = _audience_ids_for_event(str(out.get("id") or ""), str(out.get("workspace_id") or ""))
    out["audience_contact_ids"] = audience_ids
    out["audience_user_ids"] = _audience_user_ids_for_event(str(out.get("id") or ""), str(out.get("workspace_id") or ""))
    return out


def init_business_tables() -> None:
    pk = _text_pk()
    with get_conn() as conn:
        conn.execute(f"""
            CREATE TABLE IF NOT EXISTS biz_contacts (
                id              {pk} PRIMARY KEY,
                workspace_id    {pk} NOT NULL,
                name            TEXT NOT NULL,
                email           TEXT NOT NULL DEFAULT '',
                phone           TEXT NOT NULL DEFAULT '',
                company         TEXT NOT NULL DEFAULT '',
                contact_type    TEXT NOT NULL DEFAULT 'prospect',
                status          TEXT NOT NULL DEFAULT 'active',
                tags_json       TEXT NOT NULL DEFAULT '[]',
                notes           TEXT NOT NULL DEFAULT '',
                outreach_suggestions TEXT NOT NULL DEFAULT '',
                website         TEXT NOT NULL DEFAULT '',
                linkedin_url    TEXT NOT NULL DEFAULT '',
                address         TEXT NOT NULL DEFAULT '',
                city            TEXT NOT NULL DEFAULT '',
                postal_code     TEXT NOT NULL DEFAULT '',
                socials_json    TEXT NOT NULL DEFAULT '{{}}',
                verified_at     TEXT,
                created_at      TEXT NOT NULL,
                updated_at      TEXT NOT NULL
            )
        """)
        _ensure_biz_contacts_columns(conn)
        conn.execute(f"""
            CREATE TABLE IF NOT EXISTS biz_projects (
                id              {pk} PRIMARY KEY,
                workspace_id    {pk} NOT NULL,
                contact_id      {pk},
                title           TEXT NOT NULL,
                description     TEXT NOT NULL DEFAULT '',
                project_type    TEXT NOT NULL DEFAULT 'autre',
                status          TEXT NOT NULL DEFAULT 'draft',
                location        TEXT NOT NULL DEFAULT '',
                start_date      TEXT,
                end_date        TEXT,
                milestones_json TEXT NOT NULL DEFAULT '[]',
                linked_job_ids_json TEXT NOT NULL DEFAULT '[]',
                created_at      TEXT NOT NULL,
                updated_at      TEXT NOT NULL
            )
        """)
        conn.execute(f"""
            CREATE TABLE IF NOT EXISTS biz_quotes (
                id              {pk} PRIMARY KEY,
                workspace_id    {pk} NOT NULL,
                contact_id      {pk},
                project_id      {pk},
                quote_number    TEXT NOT NULL,
                title           TEXT NOT NULL DEFAULT '',
                status          TEXT NOT NULL DEFAULT 'draft',
                currency        TEXT NOT NULL DEFAULT 'EUR',
                lines_json      TEXT NOT NULL DEFAULT '[]',
                subtotal_cents  INTEGER NOT NULL DEFAULT 0,
                tax_cents       INTEGER NOT NULL DEFAULT 0,
                total_cents     INTEGER NOT NULL DEFAULT 0,
                valid_until     TEXT,
                notes           TEXT NOT NULL DEFAULT '',
                created_at      TEXT NOT NULL,
                updated_at      TEXT NOT NULL
            )
        """)
        conn.execute(f"""
            CREATE TABLE IF NOT EXISTS biz_external_invoices (
                id              {pk} PRIMARY KEY,
                workspace_id    {pk} NOT NULL,
                quote_id        {pk},
                contact_id      {pk},
                project_id      {pk},
                tiime_invoice_id TEXT NOT NULL DEFAULT '',
                tiime_status    TEXT NOT NULL DEFAULT 'pending',
                external_url    TEXT NOT NULL DEFAULT '',
                amount_cents    INTEGER NOT NULL DEFAULT 0,
                currency        TEXT NOT NULL DEFAULT 'EUR',
                issued_at       TEXT,
                paid_at         TEXT,
                sync_error      TEXT NOT NULL DEFAULT '',
                created_at      TEXT NOT NULL,
                updated_at      TEXT NOT NULL
            )
        """)
        conn.execute(f"""
            CREATE TABLE IF NOT EXISTS biz_calendar_events (
                id              {pk} PRIMARY KEY,
                workspace_id    {pk} NOT NULL,
                contact_id      {pk},
                project_id      {pk},
                event_type      TEXT NOT NULL DEFAULT 'seance',
                title           TEXT NOT NULL,
                starts_at       TEXT NOT NULL,
                ends_at         TEXT,
                location        TEXT NOT NULL DEFAULT '',
                status          TEXT NOT NULL DEFAULT 'planned',
                notes           TEXT NOT NULL DEFAULT '',
                google_event_id TEXT NOT NULL DEFAULT '',
                created_at      TEXT NOT NULL,
                updated_at      TEXT NOT NULL
            )
        """)
        _ensure_biz_calendar_event_columns(conn)
        _ensure_biz_event_audience_table(conn)
        conn.execute(f"""
            CREATE TABLE IF NOT EXISTS biz_interactions (
                id              {pk} PRIMARY KEY,
                workspace_id    {pk} NOT NULL,
                contact_id      {pk},
                project_id      {pk},
                quote_id        {pk},
                interaction_type TEXT NOT NULL DEFAULT 'note',
                summary         TEXT NOT NULL DEFAULT '',
                details         TEXT NOT NULL DEFAULT '',
                agent_key       TEXT NOT NULL DEFAULT '',
                job_id          TEXT NOT NULL DEFAULT '',
                created_at      TEXT NOT NULL
            )
        """)
        conn.execute(f"""
            CREATE TABLE IF NOT EXISTS biz_contact_enrichment_proposals (
                id              {pk} PRIMARY KEY,
                workspace_id    {pk} NOT NULL,
                contact_id      {pk} NOT NULL,
                job_id          TEXT NOT NULL DEFAULT '',
                status          TEXT NOT NULL DEFAULT 'pending',
                proposed_json   TEXT NOT NULL DEFAULT '{{}}',
                sources_json    TEXT NOT NULL DEFAULT '[]',
                summary         TEXT NOT NULL DEFAULT '',
                agent_key       TEXT NOT NULL DEFAULT '',
                created_at      TEXT NOT NULL,
                updated_at      TEXT NOT NULL,
                resolved_at     TEXT
            )
        """)
        # Fils e-mail prospection (envois HITL + réponses Gmail)
        conn.execute(f"""
            CREATE TABLE IF NOT EXISTS biz_email_threads (
                id                  {pk} PRIMARY KEY,
                workspace_id        {pk} NOT NULL,
                contact_id          {pk},
                subject             TEXT NOT NULL DEFAULT '',
                to_email            TEXT NOT NULL DEFAULT '',
                status              TEXT NOT NULL DEFAULT 'open',
                gmail_thread_id     TEXT NOT NULL DEFAULT '',
                last_message_at     TEXT NOT NULL DEFAULT '',
                follow_up_event_id  TEXT NOT NULL DEFAULT '',
                ticket_id           TEXT NOT NULL DEFAULT '',
                job_id              TEXT NOT NULL DEFAULT '',
                created_at          TEXT NOT NULL,
                updated_at          TEXT NOT NULL
            )
        """)
        conn.execute(f"""
            CREATE TABLE IF NOT EXISTS biz_email_messages (
                id                  {pk} PRIMARY KEY,
                workspace_id        {pk} NOT NULL,
                thread_id           {pk} NOT NULL,
                direction           TEXT NOT NULL DEFAULT 'outbound',
                subject             TEXT NOT NULL DEFAULT '',
                body                TEXT NOT NULL DEFAULT '',
                from_email          TEXT NOT NULL DEFAULT '',
                to_email            TEXT NOT NULL DEFAULT '',
                message_id_header   TEXT NOT NULL DEFAULT '',
                gmail_message_id    TEXT NOT NULL DEFAULT '',
                in_reply_to         TEXT NOT NULL DEFAULT '',
                ticket_id           TEXT NOT NULL DEFAULT '',
                attachments_json    TEXT NOT NULL DEFAULT '[]',
                created_at          TEXT NOT NULL
            )
        """)
        _ensure_biz_email_messages_columns(conn)
        conn.commit()


def _parse_json_list(raw: Any) -> list:
    try:
        val = json.loads(raw or "[]")
        return val if isinstance(val, list) else []
    except Exception:
        return []


def _parse_json_dict(raw: Any) -> dict:
    try:
        val = json.loads(raw or "{}")
        return val if isinstance(val, dict) else {}
    except Exception:
        return {}


def contact_reachability(contact: dict) -> dict[str, Any]:
    """Score de joignabilité (0–100) + niveau + champs manquants."""
    email = str(contact.get("email") or "").strip()
    phone = str(contact.get("phone") or "").strip()
    website = str(contact.get("website") or "").strip()
    linkedin = str(contact.get("linkedin_url") or "").strip()
    address = str(contact.get("address") or "").strip()
    city = str(contact.get("city") or "").strip()
    postal = str(contact.get("postal_code") or "").strip()
    socials = contact.get("socials") if isinstance(contact.get("socials"), dict) else {}
    social_ok = any(str(v or "").strip() for v in socials.values()) if socials else False

    score = 0
    if email:
        score += 30
    if phone:
        score += 25
    if website:
        score += 15
    if linkedin:
        score += 15
    if address or city or postal:
        score += 10
    if social_ok:
        score += 5

    missing: list[str] = []
    if not email:
        missing.append("email")
    if not phone:
        missing.append("phone")
    if not website:
        missing.append("website")
    if not linkedin:
        missing.append("linkedin_url")
    if not (address or city):
        missing.append("address")
    if not social_ok:
        missing.append("socials")

    if email and (phone or website or linkedin):
        level = "complete"
        label = "Complet"
    elif email or phone or website or linkedin:
        level = "partial"
        label = "Partiel"
    else:
        level = "unreachable"
        label = "Injoignable"

    return {
        "score": score,
        "level": level,
        "label": label,
        "missing": missing,
        "verified_at": contact.get("verified_at") or None,
    }


def _hydrate_contact(row: dict) -> dict:
    out = dict(row)
    out["tags"] = _parse_json_list(out.pop("tags_json", "[]"))
    out["socials"] = _parse_json_dict(out.pop("socials_json", "{}"))
    for key in ("website", "linkedin_url", "address", "city", "postal_code"):
        out.setdefault(key, "")
    out.setdefault("outreach_suggestions", "")
    out.setdefault("verified_at", None)
    out["reachability"] = contact_reachability(out)
    return out


def _hydrate_project(row: dict) -> dict:
    out = dict(row)
    out["milestones"] = _parse_json_list(out.pop("milestones_json", "[]"))
    out["linked_job_ids"] = _parse_json_list(out.pop("linked_job_ids_json", "[]"))
    return out


def _hydrate_quote(row: dict) -> dict:
    out = dict(row)
    out["lines"] = _parse_json_list(out.pop("lines_json", "[]"))
    return out


def _compute_quote_totals(lines: list[dict]) -> tuple[int, int, int]:
    subtotal = 0
    tax = 0
    for line in lines:
        qty = float(line.get("qty") or 1)
        unit = int(line.get("unit_price_cents") or 0)
        rate = float(line.get("tax_rate") or 0)
        line_ht = int(round(qty * unit))
        subtotal += line_ht
        tax += int(round(line_ht * rate / 100))
    return subtotal, tax, subtotal + tax


def _next_quote_number(conn) -> str:
    year = datetime.utcnow().year
    prefix = f"DEV-{year}-"
    row = conn.execute(
        "SELECT quote_number FROM biz_quotes WHERE workspace_id=? AND quote_number LIKE ? "
        "ORDER BY quote_number DESC LIMIT 1",
        (_ws(), prefix + "%"),
    ).fetchone()
    if not row:
        seq = 1
    else:
        num = str(dict(row).get("quote_number") or "")
        try:
            seq = int(num.split("-")[-1]) + 1
        except Exception:
            seq = 1
    return f"{prefix}{seq:04d}"


# ── Contacts ──────────────────────────────────────────────────────────────────

def create_contact(
    *,
    name: str,
    email: str = "",
    phone: str = "",
    company: str = "",
    contact_type: str = "prospect",
    status: str = "active",
    tags: list[str] | None = None,
    notes: str = "",
    outreach_suggestions: str = "",
    website: str = "",
    linkedin_url: str = "",
    address: str = "",
    city: str = "",
    postal_code: str = "",
    socials: dict | None = None,
) -> dict:
    cid = _new_id("ctc")
    now = _now()
    facts, outreach = split_factual_notes_and_outreach(notes)
    if outreach and not (outreach_suggestions or "").strip():
        outreach_suggestions = outreach
    notes = facts
    with get_conn() as conn:
        _ensure_biz_contacts_columns(conn)
        conn.execute(
            "INSERT INTO biz_contacts "
            "(id, workspace_id, name, email, phone, company, contact_type, status, tags_json, notes, "
            "outreach_suggestions, website, linkedin_url, address, city, postal_code, socials_json, "
            "created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                cid, _ws(), name.strip(), email.strip(), phone.strip(), company.strip(),
                contact_type, status,
                json.dumps(tags or [], ensure_ascii=False),
                notes,
                outreach_suggestions,
                website.strip(), linkedin_url.strip(), address.strip(), city.strip(), postal_code.strip(),
                json.dumps(socials or {}, ensure_ascii=False),
                now, now,
            ),
        )
        conn.commit()
    return get_contact(cid)  # type: ignore[return-value]


def find_contact_by_email(email: str) -> dict | None:
    em = (email or "").strip().lower()
    if not em:
        return None
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM biz_contacts WHERE workspace_id=? AND lower(email)=?",
            (_ws(), em),
        ).fetchall()
    for row in rows or []:
        c = _hydrate_contact(dict(row))
        if (c.get("email") or "").strip().lower() == em:
            return c
    return None


def search_contacts(query: str, *, limit: int = 25) -> list[dict]:
    q = (query or "").strip().lower()
    rows = list_contacts(limit=500)
    if not q:
        return rows[:limit]
    terms = [t for t in q.split() if len(t) >= 2]
    if not terms:
        return rows[:limit]
    out: list[dict] = []
    for r in rows:
        blob = " ".join(
            [
                str(r.get("name") or ""),
                str(r.get("email") or ""),
                str(r.get("phone") or ""),
                str(r.get("company") or ""),
                str(r.get("website") or ""),
                str(r.get("linkedin_url") or ""),
                str(r.get("city") or ""),
                str(r.get("notes") or ""),
                " ".join(r.get("tags") or []),
            ]
        ).lower()
        if all(t in blob for t in terms):
            out.append(r)
        if len(out) >= limit:
            break
    return out


def append_contact_notes(contact_id: str, block: str, *, source: str = "agent") -> dict | None:
    contact = get_contact(contact_id)
    if not contact:
        return None
    facts, outreach = split_factual_notes_and_outreach(block or "")
    stamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M")
    prefix = f"\n\n--- {stamp} ({source}) ---\n"
    patch: dict[str, Any] = {}
    if facts.strip():
        patch["notes"] = (contact.get("notes") or "").rstrip() + prefix + facts.strip()
    if outreach.strip():
        out_prefix = f"\n\n--- {stamp} ({source}) ---\n"
        patch["outreach_suggestions"] = (
            (contact.get("outreach_suggestions") or "").rstrip() + out_prefix + outreach.strip()
        )
    if not patch:
        return contact
    return update_contact(contact_id, **patch)


def append_outreach_suggestions(contact_id: str, block: str, *, source: str = "agent") -> dict | None:
    """Ajoute une suggestion d'approche (séparée des notes factuelles)."""
    contact = get_contact(contact_id)
    if not contact:
        return None
    text = (block or "").strip()
    if not text:
        return contact
    stamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M")
    prefix = f"\n\n--- {stamp} ({source}) ---\n"
    new_val = (contact.get("outreach_suggestions") or "").rstrip() + prefix + text
    return update_contact(contact_id, outreach_suggestions=new_val)


_OUTREACH_SPLIT_RE = re.compile(
    r"(?is)(?:^|\n+)\s*((?:Angle d['’]approche(?:\s+possible)?|"
    r"Notes pour l['’]approche|"
    r"Suggestion(?:s)? d['’]approche|"
    r"Approche commerciale|"
    r"Comment le contacter)\s*:\s*)",
)


def split_factual_notes_and_outreach(notes: str) -> tuple[str, str]:
    """Sépare faits CRM et angle commercial mélangés dans un même texte."""
    text = str(notes or "").strip()
    if not text:
        return "", ""
    m = _OUTREACH_SPLIT_RE.search(text)
    if not m:
        # Phrase embarquée sans retour ligne : « …collective. Angle d'approche : … »
        m2 = re.search(r"(?i)(\s+)(Angle d['’]approche(?:\s+possible)?\s*:)", text)
        if m2:
            facts = text[: m2.start(2)].strip().rstrip(".")
            outreach = text[m2.start(2) :].strip()
            return facts, outreach
        return text, ""
    facts = text[: m.start()].strip()
    outreach = text[m.start(1) :].strip() if m.lastindex else text[m.start() :].strip()
    return facts, outreach


def rebalance_contact_notes_outreach(contact_id: str) -> dict[str, Any] | None:
    """Déplace les angles d'approche encore présents dans `notes` vers `outreach_suggestions`."""
    contact = get_contact(contact_id)
    if not contact:
        return None
    notes = str(contact.get("notes") or "")
    facts, moved = split_factual_notes_and_outreach(notes)
    if not moved or moved.strip() == notes.strip():
        # Rien à déplacer (pas d'angle détecté, ou tout le texte est déjà de l'outreach seul)
        if not moved:
            return {"contact": contact, "changed": False, "moved": False}
        # Si notes = uniquement outreach, vide notes et pousse vers suggestions
        facts, moved = "", notes.strip()

    existing_out = str(contact.get("outreach_suggestions") or "").strip()
    moved_clean = moved.strip()
    # Déduplique si déjà présent
    if existing_out and (
        moved_clean.lower() in existing_out.lower()
        or existing_out.lower() in moved_clean.lower()
    ):
        new_out = existing_out
    elif existing_out:
        new_out = existing_out.rstrip() + "\n\n--- (extrait notes) ---\n" + moved_clean
    else:
        new_out = moved_clean

    updated = update_contact(
        contact_id,
        notes=facts.strip(),
        outreach_suggestions=new_out,
    )
    return {"contact": updated, "changed": True, "moved": True}


def rebalance_all_contacts_notes_outreach(*, limit: int = 500) -> dict[str, Any]:
    """Passe batch : sépare notes / suggestions sur tous les contacts."""
    rows = list_contacts(limit=limit)
    changed = 0
    scanned = 0
    examples: list[dict[str, str]] = []
    for row in rows:
        scanned += 1
        cid = str(row.get("id") or "")
        if not cid:
            continue
        result = rebalance_contact_notes_outreach(cid)
        if result and result.get("changed"):
            changed += 1
            if len(examples) < 8:
                examples.append({
                    "id": cid,
                    "name": str((result.get("contact") or {}).get("name") or row.get("name") or ""),
                })
    return {"scanned": scanned, "changed": changed, "examples": examples}


def get_contact_outreach_context(contact_id: str, *, limit_interactions: int = 12) -> dict[str, Any]:
    """
    Contexte pour approfondir les suggestions : fiche, interactions passées,
    suggestions déjà proposées, livrables de missions liées.
    """
    contact = get_contact(contact_id)
    if not contact:
        return {}

    interactions = list_interactions(contact_id=contact_id, limit=limit_interactions)
    prior_suggestions: list[str] = []
    sug = str(contact.get("outreach_suggestions") or "").strip()
    if sug:
        prior_suggestions.append(sug[:2500])

    mission_snippets: list[dict[str, str]] = []
    seen_jobs: set[str] = set()

    from database import get_job, get_latest_job_by_source

    explore = get_latest_job_by_source(f"contact_explore:{contact_id}")
    if explore and explore.get("id"):
        seen_jobs.add(str(explore["id"]))
        result = str(explore.get("result") or "").strip()
        if result:
            mission_snippets.append({
                "job_id": str(explore["id"]),
                "status": str(explore.get("status") or ""),
                "source": str(explore.get("source") or ""),
                "preview": result[:1800],
            })

    for row in interactions:
        jid = str(row.get("job_id") or "").strip()
        if not jid or jid in seen_jobs:
            continue
        seen_jobs.add(jid)
        job = get_job(jid)
        if not job:
            continue
        result = str(job.get("result") or "").strip()
        mission = str(job.get("mission") or "").strip()
        preview = result[:1500] if result else mission[:800]
        if not preview:
            continue
        mission_snippets.append({
            "job_id": jid,
            "status": str(job.get("status") or ""),
            "source": str(job.get("source") or ""),
            "preview": preview,
        })
        if len(mission_snippets) >= 6:
            break

    # Suggestions déjà évoquées dans les interactions
    for row in interactions:
        blob = f"{row.get('summary') or ''}\n{row.get('details') or ''}".strip()
        low = blob.lower()
        if any(k in low for k in ("angle", "approche", "suggestion", "proposer", "fleur", "module", "email")):
            prior_suggestions.append(blob[:900])
        if len(prior_suggestions) >= 8:
            break

    return {
        "contact_id": contact_id,
        "notes": str(contact.get("notes") or "")[:2000],
        "outreach_suggestions": sug[:2500],
        "interactions": [
            {
                "type": r.get("interaction_type"),
                "summary": r.get("summary"),
                "details": str(r.get("details") or "")[:500],
                "agent_key": r.get("agent_key"),
                "job_id": r.get("job_id"),
                "created_at": r.get("created_at"),
            }
            for r in interactions
        ],
        "prior_suggestions": prior_suggestions[:8],
        "related_missions": mission_snippets,
    }


def upsert_contact(
    *,
    name: str,
    email: str = "",
    phone: str = "",
    company: str = "",
    contact_type: str = "prospect",
    status: str = "active",
    tags: list[str] | None = None,
    notes: str = "",
    merge_notes: bool = True,
    website: str = "",
    linkedin_url: str = "",
    address: str = "",
    city: str = "",
    postal_code: str = "",
    socials: dict | None = None,
) -> tuple[dict, bool]:
    """Crée ou met à jour (par email). Retourne (contact, created?)."""
    existing = find_contact_by_email(email) if (email or "").strip() else None
    if existing:
        patch: dict[str, Any] = {}
        if name.strip():
            patch["name"] = name.strip()
        if phone.strip():
            patch["phone"] = phone.strip()
        if company.strip():
            patch["company"] = company.strip()
        if contact_type:
            patch["contact_type"] = contact_type
        if website.strip():
            patch["website"] = website.strip()
        if linkedin_url.strip():
            patch["linkedin_url"] = linkedin_url.strip()
        if address.strip():
            patch["address"] = address.strip()
        if city.strip():
            patch["city"] = city.strip()
        if postal_code.strip():
            patch["postal_code"] = postal_code.strip()
        if socials:
            merged_socials = dict(existing.get("socials") or {})
            for k, v in socials.items():
                if str(v or "").strip():
                    merged_socials[str(k)] = str(v).strip()
            patch["socials"] = merged_socials
        if tags:
            merged = list({*(existing.get("tags") or []), *tags})
            patch["tags"] = merged
        if notes.strip() and merge_notes:
            append_contact_notes(existing["id"], notes, source="enrichissement")
        elif notes.strip():
            patch["notes"] = notes
        if patch:
            updated = update_contact(existing["id"], **patch)
            return (updated or existing), False
        return existing, False
    created = create_contact(
        name=name,
        email=email,
        phone=phone,
        company=company,
        contact_type=contact_type,
        status=status,
        tags=tags,
        notes=notes,
        website=website,
        linkedin_url=linkedin_url,
        address=address,
        city=city,
        postal_code=postal_code,
        socials=socials,
    )
    return created, True


def get_contact(contact_id: str) -> dict | None:
    with get_conn() as conn:
        _ensure_biz_contacts_columns(conn)
        row = conn.execute(
            "SELECT * FROM biz_contacts WHERE id=? AND workspace_id=?",
            (contact_id, _ws()),
        ).fetchone()
    return _hydrate_contact(dict(row)) if row else None


def list_contacts(*, status: str | None = None, contact_type: str | None = None, limit: int = 200) -> list[dict]:
    sql = "SELECT * FROM biz_contacts WHERE workspace_id=?"
    params: list[Any] = [_ws()]
    if status:
        sql += " AND status=?"
        params.append(status)
    if contact_type:
        sql += " AND contact_type=?"
        params.append(contact_type)
    sql += " ORDER BY updated_at DESC LIMIT ?"
    params.append(max(1, min(limit, 500)))
    with get_conn() as conn:
        _ensure_biz_contacts_columns(conn)
        rows = conn.execute(sql, tuple(params)).fetchall()
    return [_hydrate_contact(dict(r)) for r in rows]


def update_contact(contact_id: str, **fields: Any) -> dict | None:
    allowed = {
        "name", "email", "phone", "company", "contact_type", "status", "tags", "notes",
        "outreach_suggestions",
        "website", "linkedin_url", "address", "city", "postal_code", "socials", "verified_at",
    }
    sets: list[str] = ["updated_at=?"]
    vals: list[Any] = [_now()]
    for key, val in fields.items():
        if key not in allowed or val is None:
            continue
        if key == "tags":
            sets.append("tags_json=?")
            vals.append(json.dumps(val or [], ensure_ascii=False))
        elif key == "socials":
            sets.append("socials_json=?")
            vals.append(json.dumps(val or {}, ensure_ascii=False))
        else:
            sets.append(f"{key}=?")
            vals.append(val)
    if len(sets) == 1:
        return get_contact(contact_id)
    vals.extend([contact_id, _ws()])
    with get_conn() as conn:
        _ensure_biz_contacts_columns(conn)
        conn.execute(
            f"UPDATE biz_contacts SET {', '.join(sets)} WHERE id=? AND workspace_id=?",
            tuple(vals),
        )
        conn.commit()
    return get_contact(contact_id)


def create_enrichment_proposal(
    *,
    contact_id: str,
    proposed: dict[str, Any],
    sources: list[Any] | None = None,
    summary: str = "",
    job_id: str = "",
    agent_key: str = "",
) -> dict | None:
    contact = get_contact(contact_id)
    if not contact:
        return None
    clean_proposed: dict[str, Any] = {}
    for key in (*CONTACT_PROFILE_FIELDS, "company", "notes_append", "outreach_suggestions"):
        if key not in proposed:
            continue
        val = proposed.get(key)
        if val is None:
            continue
        text = str(val).strip()
        if text:
            clean_proposed[key] = text
    socials = proposed.get("socials")
    if isinstance(socials, dict):
        clean_socials = {str(k): str(v).strip() for k, v in socials.items() if str(v or "").strip()}
        if clean_socials:
            clean_proposed["socials"] = clean_socials
    clean_proposed = sanitize_proposed_against_contact(contact, clean_proposed)
    if not clean_proposed:
        return None

    # Remplace les propositions pending du même contact (une seule file active).
    with get_conn() as conn:
        conn.execute(
            "UPDATE biz_contact_enrichment_proposals SET status='rejected', updated_at=?, resolved_at=? "
            "WHERE workspace_id=? AND contact_id=? AND status='pending'",
            (_now(), _now(), _ws(), contact_id),
        )
        pid = _new_id("enr")
        now = _now()
        conn.execute(
            "INSERT INTO biz_contact_enrichment_proposals "
            "(id, workspace_id, contact_id, job_id, status, proposed_json, sources_json, summary, agent_key, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (
                pid,
                _ws(),
                contact_id,
                (job_id or "")[:64],
                "pending",
                json.dumps(clean_proposed, ensure_ascii=False),
                json.dumps(sources or [], ensure_ascii=False),
                (summary or "")[:500],
                (agent_key or "")[:64],
                now,
                now,
            ),
        )
        conn.commit()
    return get_enrichment_proposal(pid)


def _hydrate_enrichment_proposal(row: dict) -> dict:
    out = dict(row)
    out["proposed"] = _parse_json_dict(out.pop("proposed_json", "{}"))
    out["sources"] = _parse_json_list(out.pop("sources_json", "[]"))
    contact = get_contact(str(out.get("contact_id") or ""))
    if contact and isinstance(out.get("proposed"), dict):
        out["proposed"] = sanitize_proposed_against_contact(contact, out["proposed"])
    return out


def get_enrichment_proposal(proposal_id: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM biz_contact_enrichment_proposals WHERE id=? AND workspace_id=?",
            (proposal_id, _ws()),
        ).fetchone()
    return _hydrate_enrichment_proposal(dict(row)) if row else None


def list_enrichment_proposals(
    *,
    contact_id: str | None = None,
    status: str | None = "pending",
    limit: int = 20,
) -> list[dict]:
    sql = "SELECT * FROM biz_contact_enrichment_proposals WHERE workspace_id=?"
    params: list[Any] = [_ws()]
    if contact_id:
        sql += " AND contact_id=?"
        params.append(contact_id)
    if status:
        sql += " AND status=?"
        params.append(status)
    sql += " ORDER BY created_at DESC LIMIT ?"
    params.append(max(1, min(limit, 100)))
    with get_conn() as conn:
        rows = conn.execute(sql, tuple(params)).fetchall()
    return [_hydrate_enrichment_proposal(dict(r)) for r in rows]


def reject_enrichment_proposal(proposal_id: str) -> dict | None:
    row = get_enrichment_proposal(proposal_id)
    if not row or row.get("status") != "pending":
        return row
    with get_conn() as conn:
        conn.execute(
            "UPDATE biz_contact_enrichment_proposals SET status='rejected', updated_at=?, resolved_at=? "
            "WHERE id=? AND workspace_id=?",
            (_now(), _now(), proposal_id, _ws()),
        )
        conn.commit()
    return get_enrichment_proposal(proposal_id)


_MD_LINK_RE = re.compile(r"\[([^\]]+)\]\([^)]+\)")
_EMAIL_RE = re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.I)
_PHONE_RE = re.compile(r"(?:\+33|0)\s*[1-9](?:[\s./-]?\d{2}){4}")
_URL_RE = re.compile(r"https?://[^\s)|>\]]+", re.I)
_POSTAL_CITY_RE = re.compile(r"\b(\d{5})\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'\- ]{1,40})", re.I)
_EMPTY_EXTRACT = re.compile(
    r"^(?:n/?a|n\.a\.?|none|null|inconnu[e]?|introuvable|manquant|"
    r"non\s+(?:trouv[ée]|identifi[ée]|disponible)|pas\s+trouv|"
    r"—|-|\.{2,}|\(manquant\)|\(aucun(?:e)?\))$",
    re.I,
)


def _clean_md_value(raw: str) -> str:
    text = _MD_LINK_RE.sub(r"\1", str(raw or "").strip())
    text = text.strip(" `\"'")
    return text.strip()


def _is_empty_extracted(val: str) -> bool:
    compact = re.sub(r"\s+", " ", str(val or "").strip())
    if not compact:
        return True
    if _EMPTY_EXTRACT.match(compact):
        return True
    low = compact.lower()
    return low.startswith("non trouvé") or low.startswith("non identifi")


def _host_of(url: str) -> str:
    try:
        from urllib.parse import urlparse

        parsed = urlparse(url if "://" in url else f"https://{url}")
        host = (parsed.hostname or "").lower()
        return host[4:] if host.startswith("www.") else host
    except Exception:
        return ""


_OWN_SITE_SUFFIXES = ("eludein.art",)
_DIRECTORY_HOSTS = (
    "resalib.fr",
    "doctolib.fr",
    "medoucine.com",
    "psychologie.com",
    "lesmedecinesdouces.fr",
    "pagesjaunes.fr",
    "societe.com",
    "infogreffe.fr",
    "pappers.fr",
    "levaretvous.com",
    "superprof.fr",
    "treatwell.fr",
    "wikipedia.org",
    "data.gouv.fr",
    "linkedin.com",
    "instagram.com",
    "facebook.com",
    "fb.com",
    "youtube.com",
    "youtu.be",
)
_GENERIC_IDENTITY_TOKENS = frozenset({
    "cabinet", "sarl", "sas", "eurl", "sasu", "auto", "france", "contact",
    "email", "siret", "societe", "société", "entreprise", "entrepreneur",
    "individuel", "individuelle", "therapeute", "thérapeute", "coach",
    "atelier", "galerie", "studio", "espace", "centre",
})


def _fold_ident(text: str) -> str:
    import unicodedata

    raw = unicodedata.normalize("NFD", str(text or "").lower())
    return "".join(ch for ch in raw if unicodedata.category(ch) != "Mn")


def _host_matches_suffixes(host: str, suffixes: tuple[str, ...]) -> bool:
    return any(host == s or host.endswith("." + s) for s in suffixes)


def _is_own_site(host: str) -> bool:
    return _host_matches_suffixes(host, _OWN_SITE_SUFFIXES)


def _is_directory_host(host: str) -> bool:
    return _host_matches_suffixes(host, _DIRECTORY_HOSTS)


def _is_junk_url(url: str, *, kind: str = "website") -> bool:
    host = _host_of(url)
    low = url.lower()
    if "/search?" in low or "/search/" in low:
        return True
    if any(host == h or host.endswith("." + h) for h in ("google.com", "bing.com", "tavily.com", "duckduckgo.com")):
        return True
    if kind == "website" and (_is_own_site(host) or _is_directory_host(host)):
        return True
    if kind == "facebook" and "/gaming/" in low:
        return True
    return False


_GENERIC_NAME_TAILS = frozenset({"corp", "ltd", "inc", "gmbh", "sas", "sarl", "eurl", "sasu"})


def distinctive_identity_tokens(contact: dict | None) -> list[str]:
    """Nom de famille (ou raison sociale) — pas le prénom ni les formes juridiques."""
    if not isinstance(contact, dict):
        return []
    name_parts = [p for p in re.split(r"[^a-z0-9]+", _fold_ident(str(contact.get("name") or ""))) if len(p) >= 4]
    if len(name_parts) >= 2 and name_parts[-1] in _GENERIC_NAME_TAILS:
        name_parts = name_parts[:-1]
    elif len(name_parts) >= 2:
        name_parts = name_parts[1:]
    company = _fold_ident(str(contact.get("company") or ""))
    company_parts: list[str] = []
    if "siret" not in company and "entrepreneur" not in company:
        company_parts = [
            p
            for p in re.split(r"[^a-z0-9]+", company)
            if len(p) >= 5 and p not in _GENERIC_IDENTITY_TOKENS
        ]
    out: list[str] = []
    for tok in name_parts + company_parts:
        if tok not in _GENERIC_IDENTITY_TOKENS and tok not in out:
            out.append(tok)
    return out


def website_belongs_to_contact(url: str, contact: dict | None) -> bool:
    """True seulement si l'URL peut être le site du contact (pas Élude In Art, pas un annuaire)."""
    if not str(url or "").strip():
        return False
    if _is_junk_url(url, kind="website"):
        return False
    host = _host_of(url)
    if not host or _is_own_site(host) or _is_directory_host(host):
        return False
    tokens = distinctive_identity_tokens(contact)
    if not tokens:
        return True
    blob = _fold_ident(host + " " + url)
    return any(tok in blob for tok in tokens)


def sanitize_proposed_against_contact(contact: dict | None, proposed: dict[str, Any]) -> dict[str, Any]:
    """Retire les champs extraits qui n'appartiennent clairement pas au contact."""
    if not isinstance(proposed, dict):
        return {}
    out = dict(proposed)
    website = str(out.get("website") or "").strip()
    if website and not website_belongs_to_contact(website, contact):
        out.pop("website", None)
    email = str(out.get("email") or "").strip()
    if email and "@" in email:
        domain = email.split("@")[-1].lower()
        if _is_own_site(domain) or domain in {"pagesjaunes.fr", "tavily.com"}:
            out.pop("email", None)
    return out


def _split_address_parts(address: str) -> dict[str, str]:
    """Déduit address / city / postal_code depuis une ligne d'adresse FR."""
    out: dict[str, str] = {}
    text = _clean_md_value(address)
    if not text:
        return out
    # Prend la première adresse si "Paris / Antibes"
    primary = re.split(r"\s*/\s*", text)[0].strip()
    m = _POSTAL_CITY_RE.search(primary)
    if m:
        out["postal_code"] = m.group(1)
        out["city"] = m.group(2).strip(" ,")
        before = primary[: m.start()].strip(" ,")
        if before:
            out["address"] = before
        else:
            out["address"] = primary
    else:
        out["address"] = primary
    return out


def extract_contact_fields_from_exploration(result: str) -> dict[str, Any]:
    """Parse le livrable d'exploration (tableaux / puces) → champs contact structurés."""
    text = str(result or "").strip()
    if not text:
        return {}

    proposed: dict[str, Any] = {}
    sources: list[str] = []
    label_map = (
        ("email", ("email", "e-mail", "mail")),
        ("phone", ("téléphone", "telephone", "phone", "tél", "tel")),
        ("website", ("site web", "website", "site", "url")),
        ("linkedin_url", ("linkedin",)),
        ("instagram", ("instagram", "insta")),
        ("facebook", ("facebook", "fb")),
        ("youtube", ("youtube",)),
        ("resalib", ("resalib",)),
        ("address", ("adresse", "address")),
        ("city", ("ville", "city")),
        ("postal_code", ("code postal", "postal", "cp")),
        ("company", ("société", "societe", "entreprise", "company")),
    )

    def _set(key: str, value: str) -> None:
        val = _clean_md_value(value)
        if not val or _is_empty_extracted(val):
            return
        if key == "email":
            m = _EMAIL_RE.search(val)
            if not m:
                return
            val = m.group(0)
            domain = val.split("@")[-1].lower()
            if domain in {"pagesjaunes.fr", "example.com", "tavily.com", "google.com"}:
                return
        elif key == "phone":
            m = _PHONE_RE.search(val.replace("(0)", " "))
            if m:
                digits = re.sub(r"[^\d+]", "", m.group(0))
                if digits.startswith("0") and len(digits) == 10:
                    digits = "+33" + digits[1:]
                val = digits
            else:
                return
        elif key in {"website", "linkedin_url", "instagram", "facebook", "youtube", "resalib"}:
            m = _URL_RE.search(val)
            if m:
                val = m.group(0).rstrip(".,;)")
            elif key == "website" and "." in val and " " not in val:
                val = ("https://" + val) if not val.startswith("http") else val
            elif key == "instagram" and re.fullmatch(r"@?[A-Za-z0-9._]{2,40}", val):
                val = f"https://www.instagram.com/{val.lstrip('@')}/"
            elif key == "facebook" and re.fullmatch(r"@?[A-Za-z0-9.]{2,80}", val):
                val = f"https://www.facebook.com/{val.lstrip('@')}"
            else:
                return
            if _is_junk_url(val, kind=key):
                return
        elif key == "city":
            # "Paris / Antibes" → première ville
            val = re.split(r"\s*/\s*", val)[0].strip(" ,")
            val = re.sub(r"^\d{5}\s+", "", val).strip()
        elif key == "postal_code":
            m = re.search(r"\b(\d{5})\b", val)
            if not m:
                return
            val = m.group(1)
        elif key == "address":
            val = re.split(r"\s*/\s*", val)[0].strip()
        if key not in proposed:
            proposed[key] = val

    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        # Sources URLs
        for url in _URL_RE.findall(line):
            u = url.rstrip(".,;)")
            if u not in sources and len(sources) < 12:
                sources.append(u)

        label = ""
        value = ""
        if line.startswith("|") and line.count("|") >= 3:
            cells = [c.strip() for c in line.strip("|").split("|")]
            if len(cells) >= 2:
                label = cells[0].lower().replace("*", "").strip()
                value = cells[1]
        else:
            m = re.match(
                r"^(?:[-*]\s*)?\*{0,2}([A-Za-zÀ-ÿ /_-]{2,40})\*{0,2}\s*[:=]\s*(.+)$",
                line,
            )
            if m:
                label = m.group(1).lower().replace("*", "").strip()
                value = m.group(2)

        if not label or not value:
            continue
        for key, aliases in label_map:
            if any(a in label for a in aliases):
                _set(key, value)
                break

    # Pas de fallback « premier e-mail / URL du document » : trop d'homonymes et de sources.

    if "address" in proposed and ("city" not in proposed or "postal_code" not in proposed):
        parts = _split_address_parts(str(proposed["address"]))
        proposed.update({k: v for k, v in parts.items() if k not in proposed or not proposed.get(k)})

    # Réseaux → socials{}
    socials: dict[str, str] = {}
    for sk in ("instagram", "facebook", "youtube", "resalib"):
        if proposed.get(sk):
            socials[sk] = str(proposed.pop(sk))
    if socials:
        proposed["socials"] = socials

    # Sépare notes factuelles vs suggestions d'approche dans le livrable markdown
    notes_facts, outreach = _split_exploration_narrative(text)
    if notes_facts:
        proposed["notes_append"] = notes_facts
    if outreach:
        proposed["outreach_suggestions"] = outreach

    if sources:
        proposed["_sources"] = sources
    return proposed


def _split_exploration_narrative(result: str) -> tuple[str, str]:
    """Découpe le livrable : faits contact vs suggestions d'approche commerciale."""
    text = str(result or "").strip()
    if not text:
        return "", ""

    outreach_headers = (
        "notes pour l'approche",
        "approche commerciale",
        "angle",
        "suggestion",
        "suggestions",
        "comment le contacter",
        "pitch",
        "fleur d",
    )
    fact_headers = (
        "informations complémentaires",
        "données de contact",
        "spécialités",
        "contexte",
        "siret",
        "profil",
        "à propos",
    )

    sections: list[tuple[str, str]] = []
    current_title = ""
    current_lines: list[str] = []
    for raw in text.splitlines():
        line = raw.rstrip()
        heading = re.match(r"^#{1,4}\s+\**\s*(.+?)\s*\**\s*$", line.strip())
        numbered = re.match(r"^#{0,4}\s*\**\s*\d+\.\s+\**\s*(.+?)\s*\**\s*$", line.strip())
        title = ""
        if heading:
            title = heading.group(1).strip().lower()
        elif numbered and any(k in line.lower() for k in ("approche", "complémentaire", "contact", "suggestion", "angle")):
            title = numbered.group(1).strip().lower()
        if title:
            if current_lines:
                sections.append((current_title, "\n".join(current_lines).strip()))
            current_title = title
            current_lines = []
            continue
        current_lines.append(line)
    if current_lines:
        sections.append((current_title, "\n".join(current_lines).strip()))

    facts: list[str] = []
    outreach: list[str] = []
    for title, body in sections:
        if not body or len(body) < 40:
            continue
        # Skip pure tables of contact fields already extracted
        if title and any(h in title for h in outreach_headers):
            outreach.append(body[:3500])
        elif title and any(h in title for h in fact_headers):
            # Drop markdown tables that are only field dumps
            cleaned = "\n".join(
                ln for ln in body.splitlines()
                if not ln.strip().startswith("|") and not ln.strip().startswith("---")
            ).strip()
            if cleaned:
                facts.append(cleaned[:3500])
        elif "angle" in body.lower() or "proposer" in body.lower() or "fleur" in body.lower():
            if any(h in (title or "") for h in outreach_headers) or "approche" in (title or ""):
                outreach.append(body[:3500])

    # Fallback: si une seule grosse section « approche » absente, chercher un bloc listé
    if not outreach:
        m = re.search(
            r"(?:approche commerciale|notes pour l['’]approche|angle fleur)([\s\S]{80,3500})",
            text,
            re.I,
        )
        if m:
            outreach.append(m.group(0).strip()[:3500])

    return "\n\n".join(facts).strip(), "\n\n".join(outreach).strip()


def exploration_result_summary(result: str, *, max_chars: int = 1200) -> str | None:
    """Résumé court à partir des champs extraits (ou extrait texte)."""
    fields = extract_contact_fields_from_exploration(result)
    fields.pop("_sources", None)
    if fields:
        labels = {
            "email": "Email",
            "phone": "Téléphone",
            "website": "Site",
            "linkedin_url": "LinkedIn",
            "address": "Adresse",
            "city": "Ville",
            "postal_code": "Code postal",
            "company": "Société",
        }
        lines = ["**Infos trouvées**", ""]
        for key, label in labels.items():
            if fields.get(key):
                lines.append(f"- **{label}** : {fields[key]}")
        socials = fields.get("socials") if isinstance(fields.get("socials"), dict) else {}
        for sk, label in (
            ("instagram", "Instagram"),
            ("facebook", "Facebook"),
            ("youtube", "YouTube"),
            ("resalib", "Resalib"),
        ):
            if socials.get(sk):
                lines.append(f"- **{label}** : {socials[sk]}")
        if fields.get("outreach_suggestions"):
            preview = str(fields["outreach_suggestions"]).strip().replace("\n", " ")
            lines.append(f"- **Suggestion d'approche** : {preview[:280]}{'…' if len(preview) > 280 else ''}")
        out = "\n".join(lines)
        return out[:max_chars]
    text = str(result or "").strip()
    if not text:
        return None
    return (text[: max_chars - 1] + "…") if len(text) > max_chars else text


def fill_contact_from_exploration(
    contact_id: str,
    *,
    apply: bool = True,
    job_id: str | None = None,
    result: str | None = None,
) -> dict[str, Any] | None:
    """
    Matérialise une proposition depuis le livrable d'exploration puis l'applique (optionnel).
    Idempotent si une proposition du même job_id est déjà applied.
    """
    contact = get_contact(contact_id)
    if not contact:
        return None

    from database import get_job, get_latest_job_by_source

    job = None
    if job_id:
        job = get_job(str(job_id))
    if not job:
        job = get_latest_job_by_source(f"contact_explore:{contact_id}")
    if not job:
        return {
            "contact": contact,
            "applied": False,
            "skipped": True,
            "reason": "no_exploration_job",
            "fields": {},
        }

    jid = str(job.get("id") or "")
    status = str(job.get("status") or "")
    if status not in {"completed", "done", "success"}:
        return {
            "contact": contact,
            "applied": False,
            "skipped": True,
            "reason": f"job_status_{status or 'unknown'}",
            "job_id": jid,
            "fields": {},
        }

    # Déjà appliqué pour cette mission ?
    applied_same = [
        p
        for p in list_enrichment_proposals(contact_id=contact_id, status="applied", limit=20)
        if str(p.get("job_id") or "") == jid
    ]
    if applied_same:
        # Si suggestions absentes, rattrape depuis le livrable sans réécrire toute la fiche
        contact = get_contact(contact_id) or contact
        body = str(result if result is not None else job.get("result") or "").strip()
        extracted = extract_contact_fields_from_exploration(body)
        extracted = sanitize_proposed_against_contact(contact, extracted)
        patched = False
        if extracted.get("outreach_suggestions") and not str(contact.get("outreach_suggestions") or "").strip():
            append_outreach_suggestions(
                contact_id,
                str(extracted["outreach_suggestions"]),
                source="exploration",
            )
            patched = True
        if extracted.get("notes_append"):
            # N'ajoute les notes factuelles que si la fiche n'a pas encore de notes
            if not str(contact.get("notes") or "").strip():
                append_contact_notes(contact_id, str(extracted["notes_append"]), source="exploration")
                patched = True
        contact = get_contact(contact_id) or contact
        return {
            "contact": contact,
            "applied": patched,
            "skipped": not patched,
            "reason": "already_applied_for_job",
            "job_id": jid,
            "proposal": applied_same[0],
            "fields": extracted if patched else (applied_same[0].get("proposed") or {}),
        }

    body = str(result if result is not None else job.get("result") or "").strip()
    extracted = extract_contact_fields_from_exploration(body)
    extracted = sanitize_proposed_against_contact(contact, extracted)
    sources_raw = extracted.pop("_sources", None)
    sources = sources_raw if isinstance(sources_raw, list) else []
    if not extracted:
        return {
            "contact": contact,
            "applied": False,
            "skipped": True,
            "reason": "no_fields_extracted",
            "job_id": jid,
            "fields": {},
        }

    summary = exploration_result_summary(body) or "Enrichissement auto depuis exploration"
    proposal = create_enrichment_proposal(
        contact_id=contact_id,
        proposed=extracted,
        sources=sources,
        summary=str(summary)[:500],
        job_id=jid,
        agent_key="commercial",
    )
    if not proposal:
        return {
            "contact": contact,
            "applied": False,
            "skipped": True,
            "reason": "proposal_create_failed",
            "job_id": jid,
            "fields": extracted,
        }

    if not apply:
        return {
            "contact": contact,
            "applied": False,
            "skipped": False,
            "job_id": jid,
            "proposal": proposal,
            "fields": extracted,
        }

    applied = apply_enrichment_proposal(str(proposal["id"]))
    if not applied:
        return {
            "contact": get_contact(contact_id),
            "applied": False,
            "skipped": False,
            "reason": "apply_failed",
            "job_id": jid,
            "proposal": proposal,
            "fields": extracted,
        }
    return {
        "contact": applied.get("contact"),
        "applied": True,
        "skipped": False,
        "job_id": jid,
        "proposal": applied.get("proposal"),
        "fields": extracted,
    }


def apply_enrichment_proposal(
    proposal_id: str,
    *,
    fields: list[str] | None = None,
) -> dict | None:
    """Applique une proposition (champs sélectionnés) puis marque verified_at."""
    proposal = get_enrichment_proposal(proposal_id)
    if not proposal or proposal.get("status") != "pending":
        return None
    contact_id = str(proposal.get("contact_id") or "")
    contact = get_contact(contact_id)
    if not contact:
        return None
    proposed = proposal.get("proposed") if isinstance(proposal.get("proposed"), dict) else {}
    wanted = set(fields) if fields else set(proposed.keys())
    patch: dict[str, Any] = {}
    notes_append = ""
    outreach_block = ""
    for key, val in proposed.items():
        if key not in wanted:
            continue
        if key == "notes_append":
            notes_append = str(val or "").strip()
            continue
        if key == "outreach_suggestions":
            outreach_block = str(val or "").strip()
            continue
        if key == "socials" and isinstance(val, dict):
            merged = dict(contact.get("socials") or {})
            merged.update({str(k): str(v).strip() for k, v in val.items() if str(v or "").strip()})
            patch["socials"] = merged
            continue
        if key in CONTACT_PROFILE_FIELDS or key == "company":
            text = str(val or "").strip()
            if not text:
                continue
            if key == "website" and not website_belongs_to_contact(text, contact):
                continue
            patch[key] = text
    if notes_append:
        append_contact_notes(contact_id, notes_append, source="exploration")
    if outreach_block:
        append_outreach_suggestions(contact_id, outreach_block, source="exploration")
    patch["verified_at"] = _now()
    updated = update_contact(contact_id, **patch) if patch else get_contact(contact_id)
    with get_conn() as conn:
        conn.execute(
            "UPDATE biz_contact_enrichment_proposals SET status='applied', updated_at=?, resolved_at=? "
            "WHERE id=? AND workspace_id=?",
            (_now(), _now(), proposal_id, _ws()),
        )
        conn.commit()
    log_interaction(
        contact_id=contact_id,
        interaction_type="note",
        summary="Enrichissement contact validé",
        details=json.dumps({"proposal_id": proposal_id, "applied": sorted(wanted)}, ensure_ascii=False),
        agent_key="dirigeant",
        job_id=str(proposal.get("job_id") or ""),
    )
    result = {
        "proposal": get_enrichment_proposal(proposal_id),
        "contact": updated,
    }
    try:
        from services.memory_inbox import propose_from_crm_enrichment

        sug = propose_from_crm_enrichment(contact=updated, proposal=proposal)
        if sug:
            result["memory_suggestion_id"] = sug.get("id")
            result["memory_suggestion_status"] = sug.get("status")
    except Exception:
        pass
    return result


def build_contact_exploration_mission(contact: dict) -> str:
    """Consigne mission Commercial pour exploration détaillée d'une fiche."""
    reach = contact.get("reachability") if isinstance(contact.get("reachability"), dict) else contact_reachability(contact)
    missing = ", ".join(reach.get("missing") or []) or "aucun (vérifier changements)"
    socials = contact.get("socials") if isinstance(contact.get("socials"), dict) else {}
    ctx = get_contact_outreach_context(str(contact.get("id") or ""))
    prior_block = ""
    if ctx.get("prior_suggestions") or ctx.get("related_missions") or ctx.get("interactions"):
        prior_bits: list[str] = []
        if ctx.get("outreach_suggestions"):
            prior_bits.append("**Suggestions déjà sur la fiche :**\n" + str(ctx["outreach_suggestions"])[:1200])
        for s in (ctx.get("prior_suggestions") or [])[:4]:
            if s and s != ctx.get("outreach_suggestions"):
                prior_bits.append(f"- Déjà évoqué : {str(s)[:400]}")
        for m in (ctx.get("related_missions") or [])[:3]:
            prior_bits.append(
                f"- Mission `{m.get('job_id')}` ({m.get('status')}) :\n{(m.get('preview') or '')[:700]}"
            )
        for it in (ctx.get("interactions") or [])[:5]:
            prior_bits.append(
                f"- Interaction {it.get('type')} : {it.get('summary') or ''} — {str(it.get('details') or '')[:220]}"
            )
        prior_block = (
            "\n### Historique à approfondir (ne pas se répéter)\n"
            "Tu dois **tenir compte** de ce qui a déjà été fait / suggéré, puis **aller plus loin** "
            "(canal, angle, offre, objection, prochaine action concrète).\n\n"
            + "\n\n".join(prior_bits)
            + "\n\n"
        )

    return (
        f"## Exploration détaillée CRM — contact `{contact.get('id')}`\n\n"
        f"**Nom :** {contact.get('name') or '—'}\n"
        f"**Société :** {contact.get('company') or '—'}\n"
        f"**Email actuel :** {contact.get('email') or '(manquant)'}\n"
        f"**Téléphone actuel :** {contact.get('phone') or '(manquant)'}\n"
        f"**Site actuel :** {contact.get('website') or '(manquant)'}\n"
        f"**LinkedIn actuel :** {contact.get('linkedin_url') or '(manquant)'}\n"
        f"**Adresse / ville :** {contact.get('address') or '—'} / {contact.get('city') or '—'} {contact.get('postal_code') or ''}\n"
        f"**Réseaux actuels :** {json.dumps(socials, ensure_ascii=False) if socials else '(aucun)'}\n"
        f"**Notes factuelles actuelles :** {(contact.get('notes') or '(aucune)')[:800]}\n"
        f"**Suggestions d'approche actuelles :** {(contact.get('outreach_suggestions') or '(aucune)')[:800]}\n"
        f"**Champs manquants prioritaires :** {missing}\n"
        f"**Joignabilité :** {reach.get('label')} ({reach.get('score')}%)\n\n"
        f"{prior_block}"
        "### Objectif\n"
        "1) Compléter les **infos factuelles** du contact (coordonnées, métier, sources).\n"
        "2) Produire des **suggestions d'approche** pour le contacter — **séparées** des notes factuelles — "
        "en s'appuyant sur l'historique ci-dessus (ne pas recycler les mêmes idées sans les approfondir).\n\n"
        "### Méthode (checklist obligatoire)\n"
        "1. `gestion_search_contacts` avec le nom / société pour confirmer la fiche.\n"
        "2. **Site officiel** + page contact / mentions légales.\n"
        "3. **LinkedIn** (personne et/ou page entreprise).\n"
        "4. **Instagram** et **Facebook** : chercher le nom exact + variantes ; noter l'URL du profil "
        "si c'est bien la même entité (pas un homonyme / jeu / page non liée).\n"
        "5. **Annuaires & sites métiers** selon le profil (chercher explicitement) :\n"
        "   - coachs / thérapeutes / bien-être : **Resalib**, Medoucine, Doctolib (si dispo), Psychologie.com ;\n"
        "   - entreprises / cabinets : Pages Jaunes, annuaire-entreprises.data.gouv.fr (SIRET) ;\n"
        "   - autres : YouTube / site pro / blog si présents.\n"
        "6. Croiser au moins 2 sources quand possible ; noter la confiance.\n"
        "7. Lire l'historique (interactions / missions / suggestions déjà faites) puis **approfondir** : "
        "nouveau canal, accroche plus précise, offre adaptée, objection probable, prochaine étape.\n"
        "8. **Ne pas** écraser la fiche avec `gestion_upsert_contact` / `gestion_update_contact`.\n"
        "9. **OBLIGATOIRE** : appeler **`gestion_propose_contact_enrichment`** avec "
        "`contact_id` exact (`" + str(contact.get("id") or "") + "`), les champs trouvés, "
        "`notes_append` = **faits uniquement**, `outreach_suggestions` = **comment le contacter**, "
        "`sources` (URLs) et un `summary` court.\n"
        "10. Si Instagram/Facebook/Resalib introuvables : le dire clairement — ne pas inventer d'URL.\n\n"
        "### Identité (anti-homonyme) — obligatoire\n"
        "Ne propose un champ **que** s’il appartient **à cette fiche** (même nom + même structure / ville / métier).\n"
        "- Si plusieurs homonymes : **ne remplis pas** email/tél/réseaux ; dis-le dans `summary`.\n"
        "- L’e-mail doit coller au site officiel **ou** être une boîte perso clairement liée (LinkedIn / mentions légales).\n"
        "- Un profil Instagram/Facebook/LinkedIn sans le nom ou la structure dans l’URL/titre = **hors sujet**.\n"
        "- Pages Jaunes, Google, Tavily, pages de résultats : ce ne sont **pas** le site du contact.\n"
        "- **Site web (`website`)** : uniquement le **site officiel personnel / cabinet** dont le nom de domaine "
        "contient le nom (ou la structure). **Interdit** : eludein.art, app-fleurdamours, Resalib, Doctolib, "
        "Pages Jaunes, articles de blog local, page Facebook. Un annuaire va dans `resalib` / sources, pas dans `website`.\n"
        "- Les liens de **signature Élude In Art** dans un brouillon d'e-mail ne sont **jamais** le site du prospect.\n"
        "- Interdit : inventer, approximer, recopier le contact d’un homonyme ou d’un cabinet voisin.\n"
        "- Mieux vaut un champ vide qu’une fausse information.\n\n"
        "### Livrable (structure imposée)\n"
        "Dans l'outil `gestion_propose_contact_enrichment` :\n"
        "- `notes_append` : spécialité, SIRET, contexte métier, sources — **pas** d'angle de vente.\n"
        "- `outreach_suggestions` : comment approcher (canal, accroche Fleur d'ÅmÔurs, offre, timing) "
        "en **approfondissant** ce qui a déjà été suggéré ou fait.\n"
        "- Puis un court résumé dirigeant."
    )


def build_contact_outreach_mission(contact: dict) -> str:
    """Consigne mission Commercial : suggestions d'approche avancées uniquement."""
    ctx = get_contact_outreach_context(str(contact.get("id") or ""))
    socials = contact.get("socials") if isinstance(contact.get("socials"), dict) else {}
    prior_bits: list[str] = []
    if ctx.get("outreach_suggestions"):
        prior_bits.append("**Suggestions déjà sur la fiche :**\n" + str(ctx["outreach_suggestions"])[:1600])
    for s in (ctx.get("prior_suggestions") or [])[:5]:
        if s and s != ctx.get("outreach_suggestions"):
            prior_bits.append(f"- Déjà évoqué : {str(s)[:450]}")
    for m in (ctx.get("related_missions") or [])[:4]:
        prior_bits.append(
            f"- Mission `{m.get('job_id')}` ({m.get('status')}) :\n{(m.get('preview') or '')[:800]}"
        )
    for it in (ctx.get("interactions") or [])[:6]:
        prior_bits.append(
            f"- Interaction {it.get('type')} : {it.get('summary') or ''} — {str(it.get('details') or '')[:280]}"
        )
    history = "\n\n".join(prior_bits) if prior_bits else "(aucun historique riche — pose une première stratégie solide)"

    return (
        f"## Suggestions d'approche avancées — contact `{contact.get('id')}`\n\n"
        f"**Nom :** {contact.get('name') or '—'}\n"
        f"**Société :** {contact.get('company') or '—'}\n"
        f"**Type :** {contact.get('contact_type') or '—'}\n"
        f"**Email / tél :** {contact.get('email') or '—'} / {contact.get('phone') or '—'}\n"
        f"**Site / LinkedIn :** {contact.get('website') or '—'} / {contact.get('linkedin_url') or '—'}\n"
        f"**Réseaux :** {json.dumps(socials, ensure_ascii=False) if socials else '(aucun)'}\n"
        f"**Notes factuelles :** {(contact.get('notes') or '(aucune)')[:900]}\n\n"
        "### Historique (missions, interactions, suggestions déjà faites)\n"
        f"{history}\n\n"
        "### Objectif\n"
        "Produire des **suggestions avancées** pour contacter ce prospect — **sans** modifier email/tél/site. "
        "Tu dois **approfondir** ce qui existe déjà : ne pas reformuler la même phrase ; proposer une stratégie "
        "plus concrète (canal, accroche, offre, timing, objection, prochaine action).\n\n"
        "### Contraintes\n"
        "1. `gestion_search_contacts` pour confirmer la fiche si besoin.\n"
        "2. Recherche web légère seulement si elle enrichit l'angle (pas une exploration CRM complète).\n"
        "3. **Ne pas** appeler `gestion_upsert_contact` / `gestion_update_contact`.\n"
        "4. **OBLIGATOIRE** : `gestion_propose_contact_enrichment` avec uniquement :\n"
        f"   - `contact_id` = `{contact.get('id')}`\n"
        "   - `outreach_suggestions` = texte structuré (markdown court)\n"
        "   - `summary` = 1–2 phrases pour le dirigeant\n"
        "   - pas de `notes_append` sauf fait vraiment nouveau et utile\n\n"
        "### Structure attendue de `outreach_suggestions`\n"
        "- **Canal prioritaire** (email / LinkedIn / tél / autre) + pourquoi\n"
        "- **Accroche** adaptée au métier (Tarot Fleur d'ÅmÔurs, maïeutique)\n"
        "- **Offre / format** (atelier, module pro, démo, partenariat…)\n"
        "- **Ce qui change vs suggestions précédentes** (approfondissement explicite)\n"
        "- **Prochaine action** concrète (1 phrase)\n"
    )


def apply_outreach_from_job(
    contact_id: str,
    *,
    job_id: str | None = None,
    result: str | None = None,
) -> dict[str, Any] | None:
    """Applique les suggestions d'une mission outreach (source contact_outreach:…)."""
    contact = get_contact(contact_id)
    if not contact:
        return None

    from database import get_job, get_latest_job_by_source

    job = get_job(str(job_id)) if job_id else None
    if not job:
        job = get_latest_job_by_source(f"contact_outreach:{contact_id}")
    if not job:
        return {
            "contact": contact,
            "applied": False,
            "skipped": True,
            "reason": "no_outreach_job",
        }

    jid = str(job.get("id") or "")
    status = str(job.get("status") or "")
    if status not in {"completed", "done", "success"}:
        return {
            "contact": contact,
            "applied": False,
            "skipped": True,
            "reason": f"job_status_{status or 'unknown'}",
            "job_id": jid,
        }

    already = [
        p
        for p in list_enrichment_proposals(contact_id=contact_id, status="applied", limit=30)
        if str(p.get("job_id") or "") == jid
        and isinstance(p.get("proposed"), dict)
        and p["proposed"].get("outreach_suggestions")
    ]
    if already:
        return {
            "contact": contact,
            "applied": False,
            "skipped": True,
            "reason": "already_applied_for_job",
            "job_id": jid,
            "proposal": already[0],
        }

    body = str(result if result is not None else job.get("result") or "").strip()
    extracted = extract_contact_fields_from_exploration(body)
    outreach = str(extracted.get("outreach_suggestions") or "").strip()
    if not outreach:
        # Livrable souvent 100 % suggestions : prendre le corps hors tables de contact
        cleaned = "\n".join(
            ln for ln in body.splitlines()
            if not ln.strip().startswith("|") and not ln.strip().startswith("---")
        ).strip()
        outreach = cleaned[:4000]
    if not outreach:
        return {
            "contact": contact,
            "applied": False,
            "skipped": True,
            "reason": "no_outreach_extracted",
            "job_id": jid,
        }

    proposal = create_enrichment_proposal(
        contact_id=contact_id,
        proposed={"outreach_suggestions": outreach},
        sources=extracted.get("_sources") if isinstance(extracted.get("_sources"), list) else [],
        summary="Suggestions d'approche avancées",
        job_id=jid,
        agent_key="commercial",
    )
    if not proposal:
        append_outreach_suggestions(contact_id, outreach, source="suggestions_avancees")
        return {
            "contact": get_contact(contact_id),
            "applied": True,
            "skipped": False,
            "job_id": jid,
            "fields": {"outreach_suggestions": outreach},
        }

    applied = apply_enrichment_proposal(str(proposal["id"]), fields=["outreach_suggestions"])
    return {
        "contact": (applied or {}).get("contact") or get_contact(contact_id),
        "applied": bool(applied),
        "skipped": False,
        "job_id": jid,
        "proposal": (applied or {}).get("proposal") or proposal,
        "fields": {"outreach_suggestions": outreach},
    }


def delete_contact(contact_id: str) -> bool:
    with get_conn() as conn:
        cur = conn.execute(
            "DELETE FROM biz_contacts WHERE id=? AND workspace_id=?",
            (contact_id, _ws()),
        )
        conn.commit()
        return bool(getattr(cur, "rowcount", 0))


# ── Interactions (historique relationnel) ─────────────────────────────────────

def log_interaction(
    *,
    contact_id: str | None = None,
    project_id: str | None = None,
    quote_id: str | None = None,
    interaction_type: str = "note",
    summary: str = "",
    details: str = "",
    agent_key: str = "",
    job_id: str = "",
) -> dict:
    iid = _new_id("int")
    now = _now()
    itype = interaction_type if interaction_type in INTERACTION_TYPES else "other"
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO biz_interactions "
            "(id, workspace_id, contact_id, project_id, quote_id, interaction_type, summary, details, "
            "agent_key, job_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (
                iid, _ws(), contact_id, project_id, quote_id, itype,
                (summary or "").strip()[:500],
                (details or "").strip()[:8000],
                (agent_key or "").strip()[:64],
                (job_id or "").strip()[:64],
                now,
            ),
        )
        conn.commit()
    return get_interaction(iid)  # type: ignore[return-value]


def get_interaction(interaction_id: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM biz_interactions WHERE id=? AND workspace_id=?",
            (interaction_id, _ws()),
        ).fetchone()
    return dict(row) if row else None


def list_interactions(
    *,
    contact_id: str | None = None,
    project_id: str | None = None,
    limit: int = 50,
) -> list[dict]:
    sql = "SELECT * FROM biz_interactions WHERE workspace_id=?"
    params: list[Any] = [_ws()]
    if contact_id:
        sql += " AND contact_id=?"
        params.append(contact_id)
    if project_id:
        sql += " AND project_id=?"
        params.append(project_id)
    sql += " ORDER BY created_at DESC LIMIT ?"
    params.append(max(1, min(limit, 200)))
    with get_conn() as conn:
        rows = conn.execute(sql, tuple(params)).fetchall()
    return [dict(r) for r in rows]


# ── Projects ──────────────────────────────────────────────────────────────────

def create_project(
    *,
    title: str,
    contact_id: str | None = None,
    description: str = "",
    project_type: str = "autre",
    status: str = "draft",
    location: str = "",
    start_date: str | None = None,
    end_date: str | None = None,
    milestones: list[dict] | None = None,
    linked_job_ids: list[str] | None = None,
) -> dict:
    pid = _new_id("prj")
    now = _now()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO biz_projects "
            "(id, workspace_id, contact_id, title, description, project_type, status, location, "
            "start_date, end_date, milestones_json, linked_job_ids_json, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                pid, _ws(), contact_id, title.strip(), description, project_type, status, location,
                start_date, end_date,
                json.dumps(milestones or [], ensure_ascii=False),
                json.dumps(linked_job_ids or [], ensure_ascii=False),
                now, now,
            ),
        )
        conn.commit()
    return get_project(pid)  # type: ignore[return-value]


def get_project(project_id: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM biz_projects WHERE id=? AND workspace_id=?",
            (project_id, _ws()),
        ).fetchone()
    return _hydrate_project(dict(row)) if row else None


def list_projects(*, status: str | None = None, contact_id: str | None = None, limit: int = 200) -> list[dict]:
    sql = "SELECT * FROM biz_projects WHERE workspace_id=?"
    params: list[Any] = [_ws()]
    if status:
        sql += " AND status=?"
        params.append(status)
    if contact_id:
        sql += " AND contact_id=?"
        params.append(contact_id)
    sql += " ORDER BY updated_at DESC LIMIT ?"
    params.append(max(1, min(limit, 500)))
    with get_conn() as conn:
        rows = conn.execute(sql, tuple(params)).fetchall()
    return [_hydrate_project(dict(r)) for r in rows]


def update_project(project_id: str, **fields: Any) -> dict | None:
    allowed = {
        "title", "contact_id", "description", "project_type", "status", "location",
        "start_date", "end_date", "milestones", "linked_job_ids",
    }
    sets: list[str] = ["updated_at=?"]
    vals: list[Any] = [_now()]
    for key, val in fields.items():
        if key not in allowed:
            continue
        if key == "milestones":
            sets.append("milestones_json=?")
            vals.append(json.dumps(val or [], ensure_ascii=False))
        elif key == "linked_job_ids":
            sets.append("linked_job_ids_json=?")
            vals.append(json.dumps(val or [], ensure_ascii=False))
        else:
            sets.append(f"{key}=?")
            vals.append(val)
    if len(sets) == 1:
        return get_project(project_id)
    vals.extend([project_id, _ws()])
    with get_conn() as conn:
        conn.execute(
            f"UPDATE biz_projects SET {', '.join(sets)} WHERE id=? AND workspace_id=?",
            tuple(vals),
        )
        conn.commit()
    return get_project(project_id)


def delete_project(project_id: str) -> bool:
    with get_conn() as conn:
        cur = conn.execute(
            "DELETE FROM biz_projects WHERE id=? AND workspace_id=?",
            (project_id, _ws()),
        )
        conn.commit()
        return bool(getattr(cur, "rowcount", 0))


# ── Quotes ────────────────────────────────────────────────────────────────────

def create_quote(
    *,
    title: str,
    contact_id: str | None = None,
    project_id: str | None = None,
    lines: list[dict] | None = None,
    currency: str = "EUR",
    status: str = "draft",
    valid_until: str | None = None,
    notes: str = "",
) -> dict:
    qid = _new_id("qte")
    now = _now()
    line_list = lines or []
    subtotal, tax, total = _compute_quote_totals(line_list)
    if not valid_until:
        valid_until = (datetime.utcnow() + timedelta(days=30)).date().isoformat()
    with get_conn() as conn:
        quote_number = _next_quote_number(conn)
        conn.execute(
            "INSERT INTO biz_quotes "
            "(id, workspace_id, contact_id, project_id, quote_number, title, status, currency, "
            "lines_json, subtotal_cents, tax_cents, total_cents, valid_until, notes, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                qid, _ws(), contact_id, project_id, quote_number, title.strip(), status, currency,
                json.dumps(line_list, ensure_ascii=False),
                subtotal, tax, total, valid_until, notes, now, now,
            ),
        )
        conn.commit()
    return get_quote(qid)  # type: ignore[return-value]


def get_quote(quote_id: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM biz_quotes WHERE id=? AND workspace_id=?",
            (quote_id, _ws()),
        ).fetchone()
    return _hydrate_quote(dict(row)) if row else None


def list_quotes(*, status: str | None = None, contact_id: str | None = None, limit: int = 200) -> list[dict]:
    sql = "SELECT * FROM biz_quotes WHERE workspace_id=?"
    params: list[Any] = [_ws()]
    if status:
        sql += " AND status=?"
        params.append(status)
    if contact_id:
        sql += " AND contact_id=?"
        params.append(contact_id)
    sql += " ORDER BY created_at DESC LIMIT ?"
    params.append(max(1, min(limit, 500)))
    with get_conn() as conn:
        rows = conn.execute(sql, tuple(params)).fetchall()
    return [_hydrate_quote(dict(r)) for r in rows]


def update_quote(quote_id: str, **fields: Any) -> dict | None:
    allowed = {
        "title", "contact_id", "project_id", "status", "currency", "lines",
        "valid_until", "notes",
    }
    sets: list[str] = ["updated_at=?"]
    vals: list[Any] = [_now()]
    recompute = False
    for key, val in fields.items():
        if key not in allowed:
            continue
        if key == "lines":
            sets.append("lines_json=?")
            vals.append(json.dumps(val or [], ensure_ascii=False))
            recompute = True
        else:
            sets.append(f"{key}=?")
            vals.append(val)
    if recompute:
        subtotal, tax, total = _compute_quote_totals(fields.get("lines") or [])
        sets.extend(["subtotal_cents=?", "tax_cents=?", "total_cents=?"])
        vals.extend([subtotal, tax, total])
    if len(sets) == 1:
        return get_quote(quote_id)
    vals.extend([quote_id, _ws()])
    with get_conn() as conn:
        conn.execute(
            f"UPDATE biz_quotes SET {', '.join(sets)} WHERE id=? AND workspace_id=?",
            tuple(vals),
        )
        conn.commit()
    return get_quote(quote_id)


def delete_quote(quote_id: str) -> bool:
    with get_conn() as conn:
        cur = conn.execute(
            "DELETE FROM biz_quotes WHERE id=? AND workspace_id=?",
            (quote_id, _ws()),
        )
        conn.commit()
        return bool(getattr(cur, "rowcount", 0))


# ── External invoices (Tiime) ─────────────────────────────────────────────────

def create_external_invoice(
    *,
    quote_id: str | None = None,
    contact_id: str | None = None,
    project_id: str | None = None,
    tiime_invoice_id: str = "",
    tiime_status: str = "issued",
    external_url: str = "",
    amount_cents: int = 0,
    currency: str = "EUR",
    issued_at: str | None = None,
    paid_at: str | None = None,
    sync_error: str = "",
) -> dict:
    iid = _new_id("inv")
    now = _now()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO biz_external_invoices "
            "(id, workspace_id, quote_id, contact_id, project_id, tiime_invoice_id, tiime_status, "
            "external_url, amount_cents, currency, issued_at, paid_at, sync_error, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                iid, _ws(), quote_id, contact_id, project_id,
                tiime_invoice_id.strip(), tiime_status, external_url.strip(),
                int(amount_cents), currency, issued_at or now, paid_at, sync_error, now, now,
            ),
        )
        conn.commit()
    return get_external_invoice(iid)  # type: ignore[return-value]


def get_external_invoice(invoice_id: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM biz_external_invoices WHERE id=? AND workspace_id=?",
            (invoice_id, _ws()),
        ).fetchone()
    return dict(row) if row else None


def list_external_invoices(*, quote_id: str | None = None, limit: int = 100) -> list[dict]:
    sql = "SELECT * FROM biz_external_invoices WHERE workspace_id=?"
    params: list[Any] = [_ws()]
    if quote_id:
        sql += " AND quote_id=?"
        params.append(quote_id)
    sql += " ORDER BY created_at DESC LIMIT ?"
    params.append(max(1, min(limit, 200)))
    with get_conn() as conn:
        rows = conn.execute(sql, tuple(params)).fetchall()
    return [dict(r) for r in rows]


def update_external_invoice(invoice_id: str, **fields: Any) -> dict | None:
    allowed = {
        "tiime_invoice_id", "tiime_status", "external_url", "amount_cents",
        "currency", "issued_at", "paid_at", "sync_error",
    }
    sets: list[str] = ["updated_at=?"]
    vals: list[Any] = [_now()]
    for key, val in fields.items():
        if key in allowed and val is not None:
            sets.append(f"{key}=?")
            vals.append(val)
    if len(sets) == 1:
        return get_external_invoice(invoice_id)
    vals.extend([invoice_id, _ws()])
    with get_conn() as conn:
        conn.execute(
            f"UPDATE biz_external_invoices SET {', '.join(sets)} WHERE id=? AND workspace_id=?",
            tuple(vals),
        )
        conn.commit()
    return get_external_invoice(invoice_id)


# ── Calendar events ───────────────────────────────────────────────────────────

def create_calendar_event(
    *,
    title: str,
    starts_at: str,
    ends_at: str | None = None,
    contact_id: str | None = None,
    project_id: str | None = None,
    event_type: str = "seance",
    location: str = "",
    status: str = "planned",
    notes: str = "",
    google_event_id: str = "",
    is_public: bool = False,
    visibility: str | None = None,
    audience_contact_ids: list[str] | None = None,
    audience_user_ids: list[str] | None = None,
    modality: str = "",
    nature: str = "presence",
    resource_type: str = "",
    resource_url: str = "",
    resource_file_id: str = "",
    cover_file_id: str = "",
) -> dict:
    eid = _new_id("evt")
    now = _now()
    mod = modality if modality in EVENT_MODALITIES else ""
    rtype = resource_type if resource_type in EVENT_RESOURCE_TYPES else ""
    nat = normalize_event_nature(nature, resource_type=rtype, modality=mod)
    vis = normalize_event_visibility(visibility, is_public=is_public)
    if rtype and not mod:
        mod = "async"
    if rtype:
        nat = "matiere"
    audience = list(audience_contact_ids or [])
    if vis == "selected" and not (audience_user_ids or []) and contact_id and str(contact_id) not in audience:
        audience.append(str(contact_id))
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO biz_calendar_events "
            "(id, workspace_id, contact_id, project_id, event_type, title, starts_at, ends_at, "
            "location, status, notes, google_event_id, is_public, visibility, modality, nature, "
            "resource_type, resource_url, resource_file_id, cover_file_id, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                eid, _ws(), contact_id, project_id, event_type, title.strip(),
                starts_at, ends_at, location, status, notes, google_event_id,
                1 if visibility_listed_publicly(vis) else 0, vis, mod, nat, rtype,
                (resource_url or "").strip()[:2000],
                (resource_file_id or "").strip()[:191],
                (cover_file_id or "").strip()[:191],
                now, now,
            ),
        )
        conn.commit()
    _replace_event_audience(eid, audience)
    _replace_event_audience_users(eid, list(audience_user_ids or []))
    return get_calendar_event(eid)  # type: ignore[return-value]


def get_calendar_event(event_id: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM biz_calendar_events WHERE id=? AND workspace_id=?",
            (event_id, _ws()),
        ).fetchone()
    return serialize_calendar_event(dict(row) if row else None)


def get_calendar_event_in_workspace(workspace_id: str, event_id: str) -> dict | None:
    wid = (workspace_id or "").strip()
    eid = (event_id or "").strip()
    if not wid or not eid:
        return None
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM biz_calendar_events WHERE id=? AND workspace_id=?",
            (eid, wid),
        ).fetchone()
    return serialize_calendar_event(dict(row) if row else None)


def load_event_resource_file(
    event_id: str,
    *,
    require_unlocked: bool = False,
    viewer_email: str = "",
    viewer_user_id: str = "",
    viewer_active: bool = False,
    public_access: bool = False,
) -> dict | None:
    row = get_calendar_event(event_id)
    if not row:
        return None
    if require_unlocked:
        if not event_resource_time_unlocked(row):
            return None
        if not event_visible_to_viewer(
            row,
            viewer_email=viewer_email,
            viewer_user_id=viewer_user_id,
            viewer_active=viewer_active,
            public_catalog=public_access,
        ):
            return None
        if public_access and normalize_event_visibility(str(row.get("visibility") or "")) != "public":
            return None
    fid = str(row.get("resource_file_id") or "").strip()
    if not fid:
        return None
    from services.resource_files import load_local_file

    item = load_local_file(fid)
    if not item:
        return None
    item["event_title"] = str(row.get("title") or "")
    return item


def load_public_storefront_resource_file(workspace_id: str, event_id: str) -> dict | None:
    row = get_calendar_event_in_workspace(workspace_id, event_id)
    if not row:
        return None
    if normalize_event_visibility(str(row.get("visibility") or "")) != "public":
        return None
    if not event_resource_time_unlocked(row):
        return None
    fid = str(row.get("resource_file_id") or "").strip()
    if not fid:
        return None
    from services.resource_files import load_local_file

    item = load_local_file(fid)
    if not item:
        return None
    item["event_title"] = str(row.get("title") or "")
    return item


def load_event_cover_file(
    event_id: str,
    *,
    workspace_id: str | None = None,
    public_access: bool = False,
    viewer_email: str = "",
    viewer_user_id: str = "",
    viewer_active: bool = False,
) -> dict | None:
    """Image d’illustration (cover dédiée ou ressource image). Visible dès que l’événement l’est."""
    if workspace_id:
        row = get_calendar_event_in_workspace(workspace_id, event_id)
    else:
        row = get_calendar_event(event_id)
    if not row:
        return None
    if public_access:
        # Aligné sur la vitrine : public + teasers « inscrits » (participants).
        vis = normalize_event_visibility(str(row.get("visibility") or ""), is_public=row.get("is_public"))
        if vis not in ("public", "participants"):
            return None
    else:
        if not event_visible_to_viewer(
            row,
            viewer_email=viewer_email,
            viewer_user_id=viewer_user_id,
            viewer_active=viewer_active,
        ):
            return None
    meta = _cover_meta(row)
    if not meta.get("has_cover"):
        return None
    from services.resource_files import load_local_file

    if meta.get("cover_source") == "cover":
        fid = str(meta.get("cover_file_id") or "").strip()
    else:
        fid = str(row.get("resource_file_id") or "").strip()
    if not fid:
        return None
    item = load_local_file(fid, workspace_id=str(row.get("workspace_id") or "") or None)
    if not item:
        return None
    item["event_title"] = str(row.get("title") or "")
    return item


def list_calendar_events(
    *,
    from_at: str | None = None,
    to_at: str | None = None,
    project_id: str | None = None,
    limit: int = 300,
) -> list[dict]:
    sql = "SELECT * FROM biz_calendar_events WHERE workspace_id=?"
    params: list[Any] = [_ws()]
    if from_at:
        sql += " AND starts_at >= ?"
        params.append(from_at)
    if to_at:
        sql += " AND starts_at <= ?"
        params.append(to_at)
    if project_id:
        sql += " AND project_id=?"
        params.append(project_id)
    sql += " ORDER BY starts_at ASC LIMIT ?"
    params.append(max(1, min(limit, 500)))
    with get_conn() as conn:
        rows = conn.execute(sql, tuple(params)).fetchall()
    return [serialize_calendar_event(dict(r)) for r in rows if r]


def _public_event_teaser(row: dict, *, include_url: bool) -> dict:
    rtype = str(row.get("resource_type") or "")
    if rtype not in EVENT_RESOURCE_TYPES:
        rtype = ""
    vis = normalize_event_visibility(str(row.get("visibility") or ""), is_public=row.get("is_public"))
    item = {
        "id": row.get("id"),
        "title": row.get("title"),
        "starts_at": row.get("starts_at"),
        "ends_at": row.get("ends_at"),
        "event_type": row.get("event_type"),
        "location": row.get("location") or "",
        "status": row.get("status"),
        "modality": str(row.get("modality") or ""),
        "nature": normalize_event_nature(
            str(row.get("nature") or ""),
            resource_type=rtype,
            modality=str(row.get("modality") or ""),
        ),
        "resource_type": rtype,
        "visibility": vis,
        "reserved": vis == "participants",
    }
    cover = _cover_meta(row)
    item["has_cover"] = bool(cover.get("has_cover"))
    item["cover_source"] = cover.get("cover_source") or ""
    item["cover_mime"] = cover.get("cover_mime") or ""
    if include_url and rtype:
        item["resource_url"] = str(row.get("resource_url") or "").strip()
        meta = _resource_file_meta(str(row.get("resource_file_id") or ""))
        item["has_file"] = bool(meta.get("resource_file_id") and meta.get("resource_filename"))
        if item["has_file"]:
            item["resource_filename"] = meta["resource_filename"]
            item["resource_file_mime"] = meta.get("resource_file_mime") or ""
    return item


def _list_workspace_events(
    workspace_id: str,
    *,
    limit: int = 80,
    starts_from: str | None = None,
    starts_until: str | None = None,
    resource_only: bool | None = None,
    statuses: tuple[str, ...] | None = None,
    order_desc: bool = False,
) -> list[dict]:
    wid = (workspace_id or "").strip()
    if not wid:
        return []
    status_list = statuses or ("planned", "confirmed", "done")
    placeholders = ",".join("?" * len(status_list))
    sql = f"SELECT * FROM biz_calendar_events WHERE workspace_id=? AND status IN ({placeholders})"
    params: list[Any] = [wid, *status_list]
    if starts_from:
        sql += " AND starts_at >= ?"
        params.append(starts_from)
    if starts_until:
        sql += " AND starts_at <= ?"
        params.append(starts_until)
    if resource_only is True:
        sql += " AND resource_type IS NOT NULL AND TRIM(resource_type) != ''"
    elif resource_only is False:
        sql += " AND (resource_type IS NULL OR TRIM(resource_type) = '')"
    sql += " ORDER BY starts_at DESC" if order_desc else " ORDER BY starts_at ASC"
    sql += " LIMIT ?"
    params.append(max(1, min(limit, 500)))
    with get_conn() as conn:
        rows = conn.execute(sql, tuple(params)).fetchall()
    out = []
    for r in rows or []:
        item = dict(r)
        item["visibility"] = normalize_event_visibility(
            str(item.get("visibility") or ""),
            is_public=item.get("is_public"),
        )
        out.append(item)
    return out


def list_public_calendar_events(workspace_id: str, *, limit: int = 40) -> list[dict]:
    """Séances visibles sur la vitrine (public + inscrits). Sans ressources fichier."""
    now = datetime.utcnow().isoformat()
    out: list[dict] = []
    for row in _list_workspace_events(
        workspace_id,
        limit=max(limit * 3, 80),
        starts_from=now,
        resource_only=False,
        statuses=("planned", "confirmed"),
    ):
        vis = str(row.get("visibility") or "")
        if vis not in ("public", "participants"):
            continue
        out.append(_public_event_teaser(row, include_url=False))
        if len(out) >= limit:
            break
    return out


def list_public_open_resources(workspace_id: str, *, limit: int = 40) -> list[dict]:
    """Ressources vraiment publiques et déjà ouvertes (lien / fichier sur la vitrine)."""
    now = datetime.utcnow().isoformat()
    out: list[dict] = []
    for row in _list_workspace_events(
        workspace_id,
        limit=max(limit * 3, 80),
        starts_until=now,
        resource_only=True,
        order_desc=True,
    ):
        if str(row.get("visibility") or "") != "public":
            continue
        if not event_resource_time_unlocked(row):
            continue
        out.append(_public_event_teaser(row, include_url=True))
        if len(out) >= limit:
            break
    return out


def list_public_resource_teasers(workspace_id: str, *, limit: int = 20) -> list[dict]:
    """Ressources à venir ou réservées aux inscrits — sans URL (vitrine)."""
    now = datetime.utcnow().isoformat()
    rows = _list_workspace_events(
        workspace_id,
        limit=120,
        starts_from=now,
        resource_only=True,
        statuses=("planned", "confirmed"),
    ) + _list_workspace_events(
        workspace_id,
        limit=120,
        starts_until=now,
        resource_only=True,
        statuses=("planned", "confirmed"),
        order_desc=True,
    )
    seen: set[str] = set()
    out: list[dict] = []
    for row in rows:
        eid = str(row.get("id") or "")
        if eid in seen:
            continue
        seen.add(eid)
        vis = str(row.get("visibility") or "")
        if vis not in ("public", "participants"):
            continue
        unlocked = event_resource_time_unlocked(row)
        if vis == "public" and unlocked:
            continue
        if vis == "participants" and unlocked and str(row.get("starts_at") or "") < now:
            pass
        elif str(row.get("starts_at") or "") < now and vis != "participants":
            continue
        out.append(_public_event_teaser(row, include_url=False))
        if len(out) >= limit:
            break
    return out


def list_unlocked_resources(
    workspace_id: str,
    *,
    viewer_email: str = "",
    viewer_user_id: str = "",
    viewer_active: bool = False,
    limit: int = 40,
) -> list[dict]:
    """Ressources ouvertes pour un participant (public + inscrits + nominatif)."""
    now = datetime.utcnow().isoformat()
    contact_ids = _contact_ids_matching_email(workspace_id, viewer_email)
    out: list[dict] = []
    for row in _list_workspace_events(
        workspace_id,
        limit=max(limit * 4, 80),
        starts_until=now,
        resource_only=True,
        order_desc=True,
    ):
        if not event_resource_time_unlocked(row):
            continue
        if not event_visible_to_viewer(
            row,
            viewer_email=viewer_email,
            viewer_contact_ids=contact_ids,
            viewer_user_id=viewer_user_id,
            viewer_active=viewer_active,
        ):
            continue
        out.append(_public_event_teaser(row, include_url=True))
        if len(out) >= limit:
            break
    return out


def list_subscriber_sessions(
    workspace_id: str,
    *,
    viewer_email: str = "",
    viewer_user_id: str = "",
    viewer_active: bool = False,
    limit: int = 40,
) -> list[dict]:
    now = datetime.utcnow().isoformat()
    contact_ids = _contact_ids_matching_email(workspace_id, viewer_email)
    out: list[dict] = []
    for row in _list_workspace_events(
        workspace_id,
        limit=max(limit * 4, 80),
        starts_from=now,
        resource_only=False,
        statuses=("planned", "confirmed"),
    ):
        if not event_visible_to_viewer(
            row,
            viewer_email=viewer_email,
            viewer_contact_ids=contact_ids,
            viewer_user_id=viewer_user_id,
            viewer_active=viewer_active,
        ):
            continue
        out.append(_public_event_teaser(row, include_url=False))
        if len(out) >= limit:
            break
    return out


def list_subscriber_upcoming_resources(
    workspace_id: str,
    *,
    viewer_email: str = "",
    viewer_user_id: str = "",
    viewer_active: bool = False,
    limit: int = 20,
) -> list[dict]:
    now = datetime.utcnow().isoformat()
    contact_ids = _contact_ids_matching_email(workspace_id, viewer_email)
    out: list[dict] = []
    for row in _list_workspace_events(
        workspace_id,
        limit=max(limit * 4, 80),
        starts_from=now,
        resource_only=True,
        statuses=("planned", "confirmed"),
    ):
        if not event_visible_to_viewer(
            row,
            viewer_email=viewer_email,
            viewer_contact_ids=contact_ids,
            viewer_user_id=viewer_user_id,
            viewer_active=viewer_active,
        ):
            continue
        out.append(_public_event_teaser(row, include_url=False))
        if len(out) >= limit:
            break
    return out


def update_calendar_event(event_id: str, **fields: Any) -> dict | None:
    audience_ids = fields.pop("audience_contact_ids", None)
    audience_user_ids = fields.pop("audience_user_ids", None)
    visibility_in = fields.pop("visibility", None)
    allowed = {
        "title", "starts_at", "ends_at", "contact_id", "project_id", "event_type",
        "location", "status", "notes", "google_event_id", "is_public", "modality",
        "nature", "resource_type", "resource_url", "resource_file_id", "cover_file_id",
        "visibility",
    }
    if visibility_in is not None:
        fields["visibility"] = normalize_event_visibility(
            str(visibility_in),
            is_public=fields.get("is_public"),
        )
        fields["is_public"] = visibility_listed_publicly(str(fields["visibility"]))
    elif "is_public" in fields and fields.get("is_public") is not None:
        vis = normalize_event_visibility(is_public=fields.get("is_public"))
        fields["visibility"] = vis
        fields["is_public"] = visibility_listed_publicly(vis)
    sets: list[str] = ["updated_at=?"]
    vals: list[Any] = [_now()]
    for key, val in fields.items():
        if key not in allowed or val is None:
            continue
        if key == "is_public":
            vals.append(1 if val else 0)
            sets.append("is_public=?")
            continue
        if key == "visibility":
            vis = normalize_event_visibility(str(val))
            vals.append(vis)
            sets.append("visibility=?")
            continue
        if key == "modality":
            vals.append(val if val in EVENT_MODALITIES else "")
            sets.append("modality=?")
            continue
        if key == "nature":
            vals.append(val if val in EVENT_NATURES else "presence")
            sets.append("nature=?")
            continue
        if key == "resource_type":
            vals.append(val if val in EVENT_RESOURCE_TYPES else "")
            sets.append("resource_type=?")
            continue
        if key == "resource_url":
            vals.append(str(val).strip()[:2000])
            sets.append("resource_url=?")
            continue
        if key == "resource_file_id":
            vals.append(str(val).strip()[:191])
            sets.append("resource_file_id=?")
            continue
        if key == "cover_file_id":
            vals.append(str(val).strip()[:191])
            sets.append("cover_file_id=?")
            continue
        sets.append(f"{key}=?")
        vals.append(val)
    if len(sets) > 1:
        vals.extend([event_id, _ws()])
        with get_conn() as conn:
            conn.execute(
                f"UPDATE biz_calendar_events SET {', '.join(sets)} WHERE id=? AND workspace_id=?",
                tuple(vals),
            )
            conn.commit()
    if audience_ids is not None:
        _replace_event_audience(event_id, list(audience_ids))
    if audience_user_ids is not None:
        _replace_event_audience_users(event_id, list(audience_user_ids))
    return get_calendar_event(event_id)


def delete_calendar_event(event_id: str) -> bool:
    with get_conn() as conn:
        conn.execute(
            "DELETE FROM biz_event_audience WHERE event_id=? AND workspace_id=?",
            (event_id, _ws()),
        )
        conn.execute(
            "DELETE FROM biz_event_audience_users WHERE event_id=? AND workspace_id=?",
            (event_id, _ws()),
        )
        cur = conn.execute(
            "DELETE FROM biz_calendar_events WHERE id=? AND workspace_id=?",
            (event_id, _ws()),
        )
        conn.commit()
        return bool(getattr(cur, "rowcount", 0))


# ── Relances CRM (créneaux auto e-mail / social) ───────────────────────────────

_CRM_FOLLOW_UP_PREFIXES = (
    "relance —",
    "relance -",
    "relance –",
    "mesurer / republier",
    "relayer l'article",
    "relayer l’article",
)


def is_crm_follow_up_title(title: str) -> bool:
    t = (title or "").strip().lower()
    if not t:
        return False
    if t.startswith("relance"):
        return True
    return any(t.startswith(p) for p in _CRM_FOLLOW_UP_PREFIXES)


def _day_bounds_utc(day: datetime | None = None) -> tuple[str, str]:
    base = day or datetime.utcnow()
    start = base.replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=1) - timedelta(microseconds=1)
    return start.isoformat(), end.isoformat()


def list_due_crm_follow_ups(
    *,
    include_overdue: bool = True,
    days_ahead: int = 0,
    limit: int = 40,
) -> list[dict]:
    """
    Créneaux planning issus du chaînage (Relance / Mesurer / Relayer),
    dus aujourd'hui (et en retard si include_overdue), status planned|confirmed.
    """
    today_start, today_end = _day_bounds_utc()
    if days_ahead > 0:
        end_dt = datetime.fromisoformat(today_start) + timedelta(days=days_ahead + 1) - timedelta(microseconds=1)
        to_at = end_dt.isoformat()
    else:
        to_at = today_end
    from_at = "1970-01-01T00:00:00" if include_overdue else today_start
    rows = list_calendar_events(from_at=from_at, to_at=to_at, limit=max(limit * 3, 80))
    out: list[dict] = []
    for ev in rows:
        if str(ev.get("status") or "") not in ("planned", "confirmed"):
            continue
        if not is_crm_follow_up_title(str(ev.get("title") or "")):
            continue
        starts = str(ev.get("starts_at") or "")
        # days_ahead=0 → uniquement jusqu'à fin de journée (déjà borné par to_at)
        if days_ahead == 0 and not include_overdue and starts < today_start:
            continue
        item = dict(ev)
        contact = None
        cid = str(ev.get("contact_id") or "").strip()
        if cid:
            contact = get_contact(cid)
        item["contact"] = (
            {
                "id": contact.get("id"),
                "name": contact.get("name"),
                "email": contact.get("email"),
                "outreach_suggestions": contact.get("outreach_suggestions") or "",
                "reachability": contact.get("reachability"),
            }
            if contact
            else None
        )
        item["overdue"] = bool(starts and starts < today_start)
        out.append(item)
        if len(out) >= limit:
            break
    return out


def prepare_follow_up_email_ticket(event_id: str) -> dict[str, Any]:
    """Crée un ticket e-mail HITL depuis une relance planning, puis marque le créneau fait."""
    from services.action_queue import enqueue_action

    event = get_calendar_event(event_id)
    if not event:
        return {"success": False, "error": "Créneau introuvable.", "status_code": 404}
    if not is_crm_follow_up_title(str(event.get("title") or "")):
        return {"success": False, "error": "Ce créneau n'est pas une relance CRM auto.", "status_code": 400}
    if str(event.get("status") or "") not in ("planned", "confirmed"):
        return {"success": False, "error": "Créneau déjà traité.", "status_code": 409}

    contact = None
    cid = str(event.get("contact_id") or "").strip()
    if cid:
        contact = get_contact(cid)
    to = str((contact or {}).get("email") or "").strip()
    if not to:
        return {
            "success": False,
            "error": "Aucun e-mail sur la fiche contact — complétez la fiche ou marquez la relance comme faite.",
            "status_code": 422,
            "contact_id": cid or None,
        }

    name = str((contact or {}).get("name") or to).strip()
    outreach = str((contact or {}).get("outreach_suggestions") or "").strip()
    notes = str(event.get("notes") or "").strip()
    subject = f"Suite à notre échange — {name}"[:160]
    body_parts = []
    if outreach:
        body_parts.append(outreach[:3500])
    elif notes:
        body_parts.append(
            "Bonjour,\n\n"
            f"Je reviens vers vous suite à mon précédent message.\n\n"
            f"(Contexte relance : {notes[:800]})\n\n"
            "Bien cordialement"
        )
    else:
        body_parts.append(
            f"Bonjour {name},\n\n"
            "Je me permets de revenir vers vous suite à notre précédent échange.\n\n"
            "Bien cordialement"
        )
    body = body_parts[0]
    ticket = enqueue_action(
        kind="email",
        title=f"E-mail — Relance {name}"[:120],
        summary=f"À : {to}\nObjet : {subject}\n\n{body}"[:800],
        payload={
            "to": to,
            "subject": subject,
            "body": body,
            "tool": "send_email",
            "contact_id": str(contact.get("id") or ""),
            "agent_key": "commercial",
            "source_event_id": event_id,
        },
        source="crm_follow_up",
    )
    update_calendar_event(event_id, status="done")
    return {
        "success": True,
        "ticket": ticket,
        "event": get_calendar_event(event_id),
        "chain": {
            "steps": [
                "Brouillon e-mail préparé dans Décisions",
                "Créneau relance marqué comme fait",
            ],
        },
    }


def complete_crm_follow_up(event_id: str, *, snooze_days: int = 0) -> dict[str, Any]:
    """Marque la relance faite, ou la reporte de N jours."""
    event = get_calendar_event(event_id)
    if not event:
        return {"success": False, "error": "Créneau introuvable.", "status_code": 404}
    if snooze_days and snooze_days > 0:
        days = max(1, min(30, int(snooze_days)))
        start = datetime.utcnow().replace(hour=9, minute=0, second=0, microsecond=0) + timedelta(days=days)
        end = start + timedelta(minutes=30)
        updated = update_calendar_event(
            event_id,
            starts_at=start.isoformat(),
            ends_at=end.isoformat(),
            status="planned",
        )
        return {"success": True, "event": updated, "snoozed_days": days}
    updated = update_calendar_event(event_id, status="done")
    return {"success": True, "event": updated}


def get_commercial_morning_snapshot() -> dict[str, Any]:
    """Tableau de bord commercial du matin pour le briefing."""
    due_today = list_due_crm_follow_ups(include_overdue=True, days_ahead=0, limit=20)
    tomorrow_start = (datetime.utcnow() + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    tomorrow_end = tomorrow_start + timedelta(days=1) - timedelta(microseconds=1)
    tomorrow_rows = list_calendar_events(
        from_at=tomorrow_start.isoformat(),
        to_at=tomorrow_end.isoformat(),
        limit=80,
    )
    due_tomorrow = [
        e
        for e in tomorrow_rows
        if str(e.get("status") or "") in ("planned", "confirmed")
        and is_crm_follow_up_title(str(e.get("title") or ""))
    ]

    stale_quotes: list[dict] = []
    cutoff = datetime.utcnow() - timedelta(days=7)
    for q in list_quotes(status="sent", limit=80):
        ts = _parse_iso_loose(str(q.get("updated_at") or q.get("created_at") or ""))
        if ts and ts <= cutoff:
            stale_quotes.append(
                {
                    "id": q.get("id"),
                    "quote_number": q.get("quote_number"),
                    "title": q.get("title"),
                    "total_cents": q.get("total_cents"),
                    "contact_id": q.get("contact_id"),
                    "updated_at": q.get("updated_at") or q.get("created_at"),
                    "days_stale": max(0, (datetime.utcnow() - ts).days),
                }
            )
    stale_quotes.sort(key=lambda x: int(x.get("days_stale") or 0), reverse=True)
    stale_quotes = stale_quotes[:8]

    weak_contacts: list[dict] = []
    for c in list_contacts(status="active", limit=120):
        reach = c.get("reachability") if isinstance(c.get("reachability"), dict) else contact_reachability(c)
        level = str((reach or {}).get("level") or "")
        if level not in ("partial", "unreachable"):
            continue
        weak_contacts.append(
            {
                "id": c.get("id"),
                "name": c.get("name"),
                "email": c.get("email"),
                "contact_type": c.get("contact_type"),
                "reachability": reach,
            }
        )
        if len(weak_contacts) >= 8:
            break

    email_stats: dict[str, Any] = {"open_threads": [], "counts": {}}
    try:
        from services.email_prospecting import email_prospecting_stats

        email_stats = email_prospecting_stats(limit_open=8)
    except Exception:
        pass

    return {
        "follow_ups_due_today": [
            {
                "id": e.get("id"),
                "title": e.get("title"),
                "starts_at": e.get("starts_at"),
                "overdue": bool(e.get("overdue")),
                "contact_id": e.get("contact_id"),
                "contact_name": (e.get("contact") or {}).get("name") if isinstance(e.get("contact"), dict) else None,
                "has_email": bool(((e.get("contact") or {}) if isinstance(e.get("contact"), dict) else {}).get("email")),
            }
            for e in due_today
        ],
        "follow_ups_due_tomorrow_count": len(due_tomorrow),
        "stale_quotes": stale_quotes,
        "weak_contacts": weak_contacts,
        "email_threads_open": email_stats.get("open_threads") or [],
        "counts": {
            "follow_ups_due_today": len(due_today),
            "follow_ups_overdue": sum(1 for e in due_today if e.get("overdue")),
            "follow_ups_due_tomorrow": len(due_tomorrow),
            "stale_quotes": len(stale_quotes),
            "weak_contacts": len(weak_contacts),
            **(email_stats.get("counts") or {}),
        },
    }


def _parse_iso_loose(raw: str) -> datetime | None:
    if not raw:
        return None
    try:
        s = raw[:-1] if raw.endswith("Z") else raw
        return datetime.fromisoformat(s)
    except ValueError:
        return None


# ── Overview ──────────────────────────────────────────────────────────────────

def get_business_overview() -> dict[str, Any]:
    ws = _ws()
    now = datetime.utcnow()
    week_end = (now + timedelta(days=7)).isoformat()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    with get_conn() as conn:
        contacts = conn.execute(
            "SELECT COUNT(*) AS n FROM biz_contacts WHERE workspace_id=? AND status='active'",
            (ws,),
        ).fetchone()
        projects_active = conn.execute(
            "SELECT COUNT(*) AS n FROM biz_projects WHERE workspace_id=? AND status='active'",
            (ws,),
        ).fetchone()
        quotes_pending = conn.execute(
            "SELECT COUNT(*) AS n FROM biz_quotes WHERE workspace_id=? AND status IN ('draft','sent')",
            (ws,),
        ).fetchone()
        events_week = conn.execute(
            "SELECT COUNT(*) AS n FROM biz_calendar_events WHERE workspace_id=? AND starts_at >= ? AND starts_at <= ?",
            (ws, today_start, week_end),
        ).fetchone()
        unpaid = conn.execute(
            "SELECT COUNT(*) AS n FROM biz_external_invoices WHERE workspace_id=? AND tiime_status NOT IN ('paid','cancelled')",
            (ws,),
        ).fetchone()
    email_needs = 0
    try:
        from services.email_prospecting import email_prospecting_stats

        email_needs = int((email_prospecting_stats(limit_open=1).get("counts") or {}).get("email_threads_needs_reply") or 0)
    except Exception:
        pass
    return {
        "contacts_active": int(dict(contacts or {}).get("n") or 0),
        "projects_active": int(dict(projects_active or {}).get("n") or 0),
        "quotes_pending": int(dict(quotes_pending or {}).get("n") or 0),
        "events_this_week": int(dict(events_week or {}).get("n") or 0),
        "invoices_unpaid": int(dict(unpaid or {}).get("n") or 0),
        "email_needs_reply": email_needs,
    }
