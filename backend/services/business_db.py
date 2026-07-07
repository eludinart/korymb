"""
business_db.py — Données métier Korymb (contacts, projets, devis, planning, factures Tiime).

Les factures légales sont émises dans Tiime ; Korymb conserve devis + références externes.
"""
from __future__ import annotations

import json
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


def _now() -> str:
    return datetime.utcnow().isoformat()


def _new_id(prefix: str) -> str:
    return f"{prefix}-{secrets.token_hex(6)}"


def _ws() -> str:
    return ws_id()


def _text_pk() -> str:
    return "VARCHAR(191)" if _is_mariadb() else "TEXT"


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
                created_at      TEXT NOT NULL,
                updated_at      TEXT NOT NULL
            )
        """)
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
        conn.commit()


def _parse_json_list(raw: Any) -> list:
    try:
        val = json.loads(raw or "[]")
        return val if isinstance(val, list) else []
    except Exception:
        return []


def _hydrate_contact(row: dict) -> dict:
    out = dict(row)
    out["tags"] = _parse_json_list(out.pop("tags_json", "[]"))
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
) -> dict:
    cid = _new_id("ctc")
    now = _now()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO biz_contacts "
            "(id, workspace_id, name, email, phone, company, contact_type, status, tags_json, notes, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                cid, _ws(), name.strip(), email.strip(), phone.strip(), company.strip(),
                contact_type, status,
                json.dumps(tags or [], ensure_ascii=False),
                notes, now, now,
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
    )
    return created, True


def get_contact(contact_id: str) -> dict | None:
    with get_conn() as conn:
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
        rows = conn.execute(sql, tuple(params)).fetchall()
    return [_hydrate_contact(dict(r)) for r in rows]


def update_contact(contact_id: str, **fields: Any) -> dict | None:
    allowed = {
        "name", "email", "phone", "company", "contact_type", "status", "tags", "notes",
    }
    sets: list[str] = ["updated_at=?"]
    vals: list[Any] = [_now()]
    for key, val in fields.items():
        if key not in allowed or val is None:
            continue
        if key == "tags":
            sets.append("tags_json=?")
            vals.append(json.dumps(val or [], ensure_ascii=False))
        else:
            sets.append(f"{key}=?")
            vals.append(val)
    if len(sets) == 1:
        return get_contact(contact_id)
    vals.extend([contact_id, _ws()])
    with get_conn() as conn:
        conn.execute(
            f"UPDATE biz_contacts SET {', '.join(sets)} WHERE id=? AND workspace_id=?",
            tuple(vals),
        )
        conn.commit()
    return get_contact(contact_id)


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
