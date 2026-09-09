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
EVENT_TYPES = ("seance", "stage", "atelier", "visio", "autre")
EVENT_STATUSES = ("planned", "confirmed", "done", "cancelled")
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
    stamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M")
    prefix = f"\n\n--- {stamp} ({source}) ---\n"
    new_notes = (contact.get("notes") or "").rstrip() + prefix + (block or "").strip()
    return update_contact(contact_id, notes=new_notes)


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


def _clean_md_value(raw: str) -> str:
    text = _MD_LINK_RE.sub(r"\1", str(raw or "").strip())
    text = text.strip(" `\"'")
    return text.strip()


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
        if not val or "non identifi" in val.lower():
            return
        if key == "email":
            m = _EMAIL_RE.search(val)
            if not m:
                return
            val = m.group(0)
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

    # Fallback regex si tableau incomplet
    if "email" not in proposed:
        m = _EMAIL_RE.search(text)
        if m:
            proposed["email"] = m.group(0)
    if "phone" not in proposed:
        m = _PHONE_RE.search(text)
        if m:
            _set("phone", m.group(0))
    if "website" not in proposed:
        for url in _URL_RE.findall(text):
            low = url.lower()
            if any(
                x in low
                for x in (
                    "linkedin.",
                    "instagram.com",
                    "facebook.com",
                    "fb.com",
                    "youtube.com",
                    "youtu.be",
                    "resalib.",
                    "doctolib.",
                    "pagesjaunes.",
                    "annuaire-entreprises.",
                )
            ):
                continue
            proposed["website"] = url.rstrip(".,;)")
            break
    if "linkedin_url" not in proposed:
        for url in _URL_RE.findall(text):
            if "linkedin." in url.lower():
                proposed["linkedin_url"] = url.rstrip(".,;)")
                break
    if "instagram" not in proposed:
        for url in _URL_RE.findall(text):
            if "instagram.com" in url.lower():
                proposed["instagram"] = url.rstrip(".,;)")
                break
    if "facebook" not in proposed:
        for url in _URL_RE.findall(text):
            low = url.lower()
            if "facebook.com" in low or "fb.com" in low:
                # Ignore gaming / ads junk when possible
                if "/gaming/" in low:
                    continue
                proposed["facebook"] = url.rstrip(".,;)")
                break
    if "resalib" not in proposed:
        for url in _URL_RE.findall(text):
            if "resalib" in url.lower():
                proposed["resalib"] = url.rstrip(".,;)")
                break

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
            if text:
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
    return {
        "proposal": get_enrichment_proposal(proposal_id),
        "contact": updated,
    }


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
        "### Livrable (structure imposée)\n"
        "Dans l'outil `gestion_propose_contact_enrichment` :\n"
        "- `notes_append` : spécialité, SIRET, contexte métier, sources — **pas** d'angle de vente.\n"
        "- `outreach_suggestions` : comment approcher (canal, accroche Fleur d'ÅmÔurs, offre, timing) "
        "en **approfondissant** ce qui a déjà été suggéré ou fait.\n"
        "- Puis un court résumé dirigeant."
    )


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
) -> dict:
    eid = _new_id("evt")
    now = _now()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO biz_calendar_events "
            "(id, workspace_id, contact_id, project_id, event_type, title, starts_at, ends_at, "
            "location, status, notes, google_event_id, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                eid, _ws(), contact_id, project_id, event_type, title.strip(),
                starts_at, ends_at, location, status, notes, google_event_id, now, now,
            ),
        )
        conn.commit()
    return get_calendar_event(eid)  # type: ignore[return-value]


def get_calendar_event(event_id: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM biz_calendar_events WHERE id=? AND workspace_id=?",
            (event_id, _ws()),
        ).fetchone()
    return dict(row) if row else None


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
    return [dict(r) for r in rows]


def update_calendar_event(event_id: str, **fields: Any) -> dict | None:
    allowed = {
        "title", "starts_at", "ends_at", "contact_id", "project_id", "event_type",
        "location", "status", "notes", "google_event_id",
    }
    sets: list[str] = ["updated_at=?"]
    vals: list[Any] = [_now()]
    for key, val in fields.items():
        if key in allowed and val is not None:
            sets.append(f"{key}=?")
            vals.append(val)
    if len(sets) == 1:
        return get_calendar_event(event_id)
    vals.extend([event_id, _ws()])
    with get_conn() as conn:
        conn.execute(
            f"UPDATE biz_calendar_events SET {', '.join(sets)} WHERE id=? AND workspace_id=?",
            tuple(vals),
        )
        conn.commit()
    return get_calendar_event(event_id)


def delete_calendar_event(event_id: str) -> bool:
    with get_conn() as conn:
        cur = conn.execute(
            "DELETE FROM biz_calendar_events WHERE id=? AND workspace_id=?",
            (event_id, _ws()),
        )
        conn.commit()
        return bool(getattr(cur, "rowcount", 0))


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
    return {
        "contacts_active": int(dict(contacts or {}).get("n") or 0),
        "projects_active": int(dict(projects_active or {}).get("n") or 0),
        "quotes_pending": int(dict(quotes_pending or {}).get("n") or 0),
        "events_this_week": int(dict(events_week or {}).get("n") or 0),
        "invoices_unpaid": int(dict(unpaid or {}).get("n") or 0),
    }
