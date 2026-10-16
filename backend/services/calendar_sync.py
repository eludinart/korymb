"""Pont Google Agenda <-> Korymb (biz_calendar_events), bidirectionnel.

Principes :
- Google fait foi pour les HEURES (start/end) et l'existence (annulation).
- Korymb fait foi pour le CONTEXTE MÉTIER (contact, projet, type, notes, visibilité).
- Korymb ne réécrit jamais une heure Google. Si l'heure a bougé des deux côtés,
  ou si un créneau Korymb chevauche un créneau Google déjà pris, un conflit est
  enregistré (`calendar_sync_conflicts`) pour revue humaine.

Désactivé par défaut : `KORYMB_GCAL_SYNC_ENABLED=1` pour l'activer.
"""
from __future__ import annotations

import json
import logging
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from database import _is_mariadb, get_conn

logger = logging.getLogger(__name__)

GCAL_BASE = "https://www.googleapis.com/calendar/v3/calendars"
KORYMB_PROP = "korymb_event_id"


def is_enabled() -> bool:
    return (os.getenv("KORYMB_GCAL_SYNC_ENABLED") or "").strip().lower() in ("1", "true", "yes", "on")


def interval_minutes() -> int:
    try:
        return max(5, int(os.getenv("KORYMB_GCAL_SYNC_INTERVAL_MIN") or 15))
    except ValueError:
        return 15


def sync_workspace_id() -> str:
    return (os.getenv("KORYMB_GCAL_SYNC_WORKSPACE_ID") or "ws-default-legacy").strip()


def calendar_id() -> str:
    from integration_settings import getenv

    return getenv("GOOGLE_CALENDAR_ID", "primary") or "primary"


def _window() -> tuple[datetime, datetime]:
    now = datetime.now(timezone.utc)
    past = int(os.getenv("KORYMB_GCAL_SYNC_PAST_DAYS") or 7)
    ahead = int(os.getenv("KORYMB_GCAL_SYNC_AHEAD_DAYS") or 60)
    return now - timedelta(days=past), now + timedelta(days=ahead)


# ── Tables ───────────────────────────────────────────────────────────────────

def init_calendar_sync_tables() -> None:
    pk = "VARCHAR(191)" if _is_mariadb() else "TEXT"
    with get_conn() as conn:
        conn.execute(f"""
            CREATE TABLE IF NOT EXISTS calendar_sync_links (
                event_id          {pk} PRIMARY KEY,
                workspace_id      {pk} NOT NULL,
                google_event_id   TEXT NOT NULL,
                google_updated    TEXT NOT NULL DEFAULT '',
                synced_starts_at  TEXT NOT NULL DEFAULT '',
                synced_ends_at    TEXT NOT NULL DEFAULT '',
                last_synced_at    TEXT NOT NULL
            )
        """)
        conn.execute(f"""
            CREATE TABLE IF NOT EXISTS calendar_sync_conflicts (
                id                {pk} PRIMARY KEY,
                workspace_id      {pk} NOT NULL,
                event_id          TEXT NOT NULL DEFAULT '',
                google_event_id   TEXT NOT NULL DEFAULT '',
                kind              TEXT NOT NULL,
                detail_json       TEXT NOT NULL DEFAULT '{{}}',
                status            TEXT NOT NULL DEFAULT 'open',
                created_at        TEXT NOT NULL,
                resolved_at       TEXT
            )
        """)
        conn.execute(f"""
            CREATE TABLE IF NOT EXISTS calendar_sync_runs (
                id            {pk} PRIMARY KEY,
                workspace_id  {pk} NOT NULL,
                trigger_kind  TEXT NOT NULL,
                summary_json  TEXT NOT NULL DEFAULT '{{}}',
                created_at    TEXT NOT NULL
            )
        """)
        conn.commit()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse(ts: str | None) -> datetime | None:
    if not ts:
        return None
    s = str(ts).strip().replace("Z", "+00:00")
    try:
        if len(s) == 10:
            d = datetime.fromisoformat(s + "T00:00:00+00:00")
        else:
            d = datetime.fromisoformat(s)
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def _iso(d: datetime | None) -> str:
    return d.astimezone(timezone.utc).isoformat() if d else ""


def _g_times(ev: dict) -> tuple[datetime | None, datetime | None]:
    st = ev.get("start") or {}
    en = ev.get("end") or {}
    return _parse(st.get("dateTime") or st.get("date")), _parse(en.get("dateTime") or en.get("date"))


def overlaps(a_start, a_end, b_start, b_end) -> bool:
    if not (a_start and b_start):
        return False
    a_end = a_end or a_start + timedelta(hours=1)
    b_end = b_end or b_start + timedelta(hours=1)
    return a_start < b_end and b_start < a_end


# ── Client Google (injectable pour les tests) ────────────────────────────────

class GoogleCalendarClient:
    def __init__(self, cal_id: str | None = None):
        self.cal_id = cal_id or calendar_id()

    def _headers(self) -> dict[str, str]:
        from tools.google_api import _google_headers

        return _google_headers("calendar")

    def list_events(self, time_min: datetime, time_max: datetime) -> list[dict]:
        import httpx

        items: list[dict] = []
        token = None
        while True:
            params = {
                "timeMin": _iso(time_min), "timeMax": _iso(time_max), "singleEvents": "true",
                "showDeleted": "true", "maxResults": 250,
            }
            if token:
                params["pageToken"] = token
            r = httpx.get(f"{GCAL_BASE}/{self.cal_id}/events", headers=self._headers(), params=params, timeout=25)
            r.raise_for_status()
            data = r.json()
            items.extend(data.get("items") or [])
            token = data.get("nextPageToken")
            if not token:
                return items

    def insert_event(self, body: dict) -> dict:
        import httpx

        r = httpx.post(f"{GCAL_BASE}/{self.cal_id}/events", headers=self._headers(), json=body, timeout=25)
        r.raise_for_status()
        return r.json()

    def patch_event(self, google_id: str, body: dict) -> dict:
        import httpx

        r = httpx.patch(f"{GCAL_BASE}/{self.cal_id}/events/{google_id}", headers=self._headers(), json=body, timeout=25)
        r.raise_for_status()
        return r.json()


# ── Helpers DB ───────────────────────────────────────────────────────────────

def _links(ws: str) -> dict[str, dict]:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM calendar_sync_links WHERE workspace_id=?", (ws,)).fetchall()
    return {dict(r)["google_event_id"]: dict(r) for r in rows}


def _save_link(conn, ws: str, event_id: str, gid: str, g_updated: str, st: str, en: str) -> None:
    conn.execute("DELETE FROM calendar_sync_links WHERE event_id=?", (event_id,))
    conn.execute(
        "INSERT INTO calendar_sync_links (event_id, workspace_id, google_event_id, google_updated, "
        "synced_starts_at, synced_ends_at, last_synced_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (event_id, ws, gid, g_updated, st, en, _now()),
    )


def _open_conflict(ws: str, kind: str, *, event_id: str = "", google_event_id: str = "", detail: dict | None = None) -> bool:
    with get_conn() as conn:
        exists = conn.execute(
            "SELECT id FROM calendar_sync_conflicts WHERE workspace_id=? AND kind=? AND event_id=? "
            "AND google_event_id=? AND status='open'",
            (ws, kind, event_id, google_event_id),
        ).fetchone()
        if exists:
            return False
        conn.execute(
            "INSERT INTO calendar_sync_conflicts (id, workspace_id, event_id, google_event_id, kind, detail_json, "
            "status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'open', ?)",
            (f"csc-{secrets.token_hex(6)}", ws, event_id, google_event_id, kind,
             json.dumps(detail or {}, ensure_ascii=False), _now()),
        )
        conn.commit()
    return True


def list_conflicts(ws: str, status: str = "open") -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM calendar_sync_conflicts WHERE workspace_id=? AND status=? ORDER BY created_at DESC",
            (ws, status),
        ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["detail"] = json.loads(d.pop("detail_json") or "{}")
        out.append(d)
    return out


def resolve_conflict(ws: str, conflict_id: str, resolution: str) -> bool:
    if resolution not in ("resolved", "dismissed"):
        raise ValueError("resolution: resolved | dismissed")
    with get_conn() as conn:
        cur = conn.execute(
            "UPDATE calendar_sync_conflicts SET status=?, resolved_at=? WHERE id=? AND workspace_id=? AND status='open'",
            (resolution, _now(), conflict_id, ws),
        )
        conn.commit()
        return bool(getattr(cur, "rowcount", 1))


def last_run(ws: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM calendar_sync_runs WHERE workspace_id=? ORDER BY created_at DESC LIMIT 1", (ws,)
        ).fetchone()
    if not row:
        return None
    d = dict(row)
    d["summary"] = json.loads(d.pop("summary_json") or "{}")
    return d


# ── Synchronisation ──────────────────────────────────────────────────────────

def run_sync(*, trigger: str = "manual", client: Any = None, workspace_id: str | None = None) -> dict[str, Any]:
    """Un passage complet : pull Google -> Korymb, puis push Korymb -> Google."""
    from tenant_context import set_tenant_context
    from services import business_db as biz

    ws = workspace_id or sync_workspace_id()
    set_tenant_context(workspace_id=ws)
    client = client or GoogleCalendarClient()
    t_min, t_max = _window()
    summary = {"imported": 0, "times_updated": 0, "cancelled": 0, "pushed": 0,
               "context_pushed": 0, "conflicts": 0, "skipped": 0}

    g_events = client.list_events(t_min, t_max)
    links = _links(ws)
    k_events = {e["id"]: e for e in biz.list_calendar_events(from_at=_iso(t_min - timedelta(days=1)), limit=500)}
    by_google = {str(e.get("google_event_id") or ""): e for e in k_events.values() if e.get("google_event_id")}
    busy: list[tuple[str, datetime | None, datetime | None]] = []

    # 1) PULL — Google fait foi pour heures / existence
    for gev in g_events:
        gid = str(gev.get("id") or "")
        if not gid:
            continue
        g_st, g_en = _g_times(gev)
        g_upd = str(gev.get("updated") or "")
        link = links.get(gid)
        kev = by_google.get(gid) or (k_events.get(link["event_id"]) if link else None)
        if not kev:
            prop = ((gev.get("extendedProperties") or {}).get("private") or {}).get(KORYMB_PROP)
            if prop:
                kev = k_events.get(prop) or biz.get_calendar_event(prop)
        if gev.get("status") == "cancelled":
            if kev and kev.get("status") != "cancelled":
                biz.update_calendar_event(kev["id"], status="cancelled")
                summary["cancelled"] += 1
            continue
        if (gev.get("transparency") or "") != "transparent":
            busy.append((gid, g_st, g_en))
        if not kev:
            created = biz.create_calendar_event(
                title=str(gev.get("summary") or "(Google, sans titre)"),
                starts_at=_iso(g_st), ends_at=_iso(g_en) or None,
                event_type="google", location=str(gev.get("location") or ""),
                notes="Importé de Google Agenda — compléter le contexte métier.",
                google_event_id=gid,
            )
            with get_conn() as conn:
                _save_link(conn, ws, created["id"], gid, g_upd, _iso(g_st), _iso(g_en))
                conn.commit()
            summary["imported"] += 1
            continue
        k_st, k_en = _parse(kev.get("starts_at")), _parse(kev.get("ends_at"))
        synced_st = _parse(link["synced_starts_at"]) if link else None
        korymb_moved = bool(link and synced_st and k_st and k_st != synced_st)
        if link and synced_st:
            google_moved = bool(g_st and g_st != synced_st)
        else:
            google_moved = bool(g_st and k_st != g_st)
        detail = {"korymb": [_iso(k_st), _iso(k_en)], "google": [_iso(g_st), _iso(g_en)]}
        if korymb_moved and google_moved and k_st != g_st:
            if _open_conflict(ws, "time_changed_both_sides", event_id=kev["id"], google_event_id=gid, detail=detail):
                summary["conflicts"] += 1
        elif korymb_moved and k_st != g_st:
            # Heure changée seulement côté Korymb : jamais poussée vers Google, signalée.
            if _open_conflict(ws, "korymb_time_change_not_pushed", event_id=kev["id"], google_event_id=gid, detail=detail):
                summary["conflicts"] += 1
        if g_st and (k_st != g_st or (g_en and k_en != g_en)):
            # Google gagne toujours sur l'heure.
            biz.update_calendar_event(kev["id"], starts_at=_iso(g_st), ends_at=_iso(g_en) or None, google_event_id=gid)
            summary["times_updated"] += 1
        # Contexte métier Korymb -> description Google si modifié depuis le dernier passage
        if link and str(kev.get("updated_at") or "") > str(link.get("last_synced_at") or "") and kev.get("notes"):
            try:
                client.patch_event(gid, {"description": _describe(kev),
                                         "extendedProperties": {"private": {KORYMB_PROP: kev["id"]}}})
                summary["context_pushed"] += 1
            except Exception:
                logger.warning("calendar_sync: patch contexte échoué %s", gid, exc_info=True)
        with get_conn() as conn:
            _save_link(conn, ws, kev["id"], gid, g_upd, _iso(g_st), _iso(g_en))
            conn.commit()

    # 2) PUSH — créneaux Korymb sans lien Google
    for kev in biz.list_calendar_events(from_at=_iso(datetime.now(timezone.utc)), to_at=_iso(t_max), limit=500):
        if kev.get("google_event_id") or kev.get("status") in ("cancelled", "done"):
            continue
        k_st, k_en = _parse(kev.get("starts_at")), _parse(kev.get("ends_at"))
        if not k_st:
            summary["skipped"] += 1
            continue
        clash = [gid for gid, s, e in busy if overlaps(k_st, k_en, s, e)]
        if clash:
            if _open_conflict(ws, "slot_already_booked", event_id=kev["id"], google_event_id=clash[0],
                              detail={"korymb": [_iso(k_st), _iso(k_en)], "google_ids": clash}):
                summary["conflicts"] += 1
            continue
        k_en = k_en or k_st + timedelta(hours=1)
        created = client.insert_event({
            "summary": kev.get("title") or "Korymb",
            "description": _describe(kev),
            "location": kev.get("location") or "",
            "start": {"dateTime": _iso(k_st)}, "end": {"dateTime": _iso(k_en)},
            "extendedProperties": {"private": {KORYMB_PROP: kev["id"]}},
        })
        gid = str(created.get("id") or "")
        if gid:
            biz.update_calendar_event(kev["id"], google_event_id=gid)
            with get_conn() as conn:
                _save_link(conn, ws, kev["id"], gid, str(created.get("updated") or ""), _iso(k_st), _iso(k_en))
                conn.commit()
            busy.append((gid, k_st, k_en))
            summary["pushed"] += 1

    with get_conn() as conn:
        conn.execute(
            "INSERT INTO calendar_sync_runs (id, workspace_id, trigger_kind, summary_json, created_at) VALUES (?, ?, ?, ?, ?)",
            (f"csr-{secrets.token_hex(6)}", ws, trigger, json.dumps(summary), _now()),
        )
        conn.commit()
    logger.info("calendar_sync %s ws=%s %s", trigger, ws, summary)
    return summary


def _describe(kev: dict) -> str:
    parts = [str(kev.get("notes") or "").strip(), f"[Korymb {kev.get('event_type') or ''} · {kev.get('id')}]"]
    return "\n\n".join(p for p in parts if p)[:4000]


def scheduled_sync() -> None:
    """Point d'entrée APScheduler (no-op si désactivé)."""
    if not is_enabled():
        return
    try:
        run_sync(trigger="scheduled")
    except Exception:
        logger.exception("calendar_sync planifié en échec")
