"""
tools/google_api.py — Gmail, Calendar, Sheets, Analytics via OAuth Google.
Tokens dédiés par service (GOOGLE_GMAIL_ACCESS_TOKEN, etc.) ou fallback GOOGLE_API_ACCESS_TOKEN / refresh OAuth.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
from dotenv import load_dotenv

from integration_settings import getenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=True)
logger = logging.getLogger(__name__)

_SERVICE_TOKEN_ENV: dict[str, str] = {
    "gmail": "GOOGLE_GMAIL_ACCESS_TOKEN",
    "calendar": "GOOGLE_CALENDAR_ACCESS_TOKEN",
    "sheets": "GOOGLE_SHEETS_ACCESS_TOKEN",
    "analytics": "GOOGLE_ANALYTICS_ACCESS_TOKEN",
}


def get_google_token(service: str = "") -> str:
    key = _SERVICE_TOKEN_ENV.get((service or "").strip().lower(), "")
    if key:
        tok = getenv(key, "")
        if tok:
            return tok
    generic = getenv("GOOGLE_API_ACCESS_TOKEN", "")
    if generic:
        return generic
    try:
        from tools import _get_google_drive_token

        return _get_google_drive_token() or ""
    except Exception:
        return ""


def _google_headers(service: str = "") -> dict[str, str]:
    token = get_google_token(service)
    if not token:
        raise RuntimeError(
            "Google API non configuré (token service, GOOGLE_API_ACCESS_TOKEN ou OAuth refresh)."
        )
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _sim(service: str, detail: str) -> str:
    return f"[SIMULATION] {service} :\n{detail}\n⚠️ Configurez les tokens Google OAuth dans .env."


# ── Gmail ─────────────────────────────────────────────────────────────────────

def run_send_gmail(to: str, subject: str, body: str) -> str:
    to_addr = (to or "").strip()
    subj = (subject or "").strip()
    text = (body or "").strip()
    if not to_addr or not subj:
        return "Destinataire et objet requis."
    try:
        hdrs = _google_headers("gmail")
    except RuntimeError as e:
        return _sim("Gmail", f"À : {to_addr}\nObjet : {subj}\n\n{text[:600]}")
    import base64
    from email.mime.text import MIMEText

    msg = MIMEText(text, "plain", "utf-8")
    msg["to"] = to_addr
    msg["subject"] = subj
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode("ascii")
    try:
        r = httpx.post(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
            headers=hdrs,
            json={"raw": raw},
            timeout=25,
        )
        r.raise_for_status()
        mid = (r.json() or {}).get("id", "?")
        return f"✅ Email Gmail envoyé à {to_addr} (id: {mid})"
    except Exception as e:
        return f"Erreur Gmail : {e}"


def run_list_gmail(query: str = "", limit: int = 10) -> str:
    try:
        hdrs = _google_headers("gmail")
    except RuntimeError as e:
        return str(e)
    try:
        params: dict[str, str | int] = {"maxResults": min(int(limit or 10), 25)}
        q = (query or "").strip()
        if q:
            params["q"] = q
        r = httpx.get(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages",
            headers=hdrs,
            params=params,
            timeout=25,
        )
        r.raise_for_status()
        ids = [m.get("id") for m in (r.json().get("messages") or []) if m.get("id")]
        if not ids:
            return "Aucun message Gmail trouvé."
        lines = [f"Messages Gmail ({len(ids)}) :"]
        for mid in ids[:10]:
            r2 = httpx.get(
                f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{mid}",
                headers=hdrs,
                params={"format": "metadata", "metadataHeaders": ["Subject", "From", "Date"]},
                timeout=20,
            )
            if r2.status_code != 200:
                continue
            meta = r2.json().get("payload", {}).get("headers") or []
            h = {x.get("name", ""): x.get("value", "") for x in meta}
            lines.append(
                f"\n• {h.get('Subject', '(sans objet)')}\n"
                f"  De : {h.get('From', '?')} — {h.get('Date', '')[:16]}"
            )
        return "\n".join(lines)
    except Exception as e:
        return f"Erreur lecture Gmail : {e}"


# ── Calendar ──────────────────────────────────────────────────────────────────

def _parse_iso_dt(raw: str) -> str:
    s = (raw or "").strip()
    if not s:
        raise ValueError("Date/heure vide.")
    if s.isdigit():
        ts = int(s)
        if ts > 10_000_000_000:
            ts //= 1000
        return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
    dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def run_create_calendar_event(
    summary: str,
    start_at: str,
    end_at: str,
    description: str = "",
    attendees: str = "",
) -> str:
    title = (summary or "").strip()
    if not title or not start_at or not end_at:
        return "summary, start_at et end_at requis."
    cal_id = getenv("GOOGLE_CALENDAR_ID", "primary") or "primary"
    try:
        hdrs = _google_headers("calendar")
    except RuntimeError:
        return _sim(
            "Calendar",
            f"Événement : {title}\nDébut : {start_at}\nFin : {end_at}\n{description[:300]}",
        )
    try:
        start_iso = _parse_iso_dt(start_at)
        end_iso = _parse_iso_dt(end_at)
        body: dict = {
            "summary": title,
            "description": (description or "")[:4000],
            "start": {"dateTime": start_iso, "timeZone": "UTC"},
            "end": {"dateTime": end_iso, "timeZone": "UTC"},
        }
        att = [a.strip() for a in (attendees or "").split(",") if a.strip()]
        if att:
            body["attendees"] = [{"email": a} for a in att]
        r = httpx.post(
            f"https://www.googleapis.com/calendar/v3/calendars/{cal_id}/events",
            headers=hdrs,
            json=body,
            timeout=25,
        )
        r.raise_for_status()
        ev = r.json()
        link = ev.get("htmlLink", "")
        return f"✅ Événement créé : {title} (id: {ev.get('id', '?')})\n{link}"
    except Exception as e:
        return f"Erreur Calendar : {e}"


def run_list_calendar_events(days_ahead: int = 7) -> str:
    cal_id = getenv("GOOGLE_CALENDAR_ID", "primary") or "primary"
    try:
        hdrs = _google_headers("calendar")
    except RuntimeError as e:
        return str(e)
    try:
        now = datetime.now(timezone.utc)
        end = now + timedelta(days=max(1, int(days_ahead or 7)))
        r = httpx.get(
            f"https://www.googleapis.com/calendar/v3/calendars/{cal_id}/events",
            headers=hdrs,
            params={
                "timeMin": now.isoformat(),
                "timeMax": end.isoformat(),
                "maxResults": 25,
                "singleEvents": "true",
                "orderBy": "startTime",
            },
            timeout=25,
        )
        r.raise_for_status()
        items = r.json().get("items") or []
        if not items:
            return f"Aucun événement sur les {days_ahead} prochains jours."
        lines = [f"Agenda ({len(items)} événement(s)) :"]
        for ev in items:
            start = (ev.get("start") or {}).get("dateTime") or (ev.get("start") or {}).get("date", "")
            lines.append(f"\n• [{start[:16]}] {ev.get('summary', '(sans titre)')}")
            if ev.get("htmlLink"):
                lines.append(f"  {ev['htmlLink']}")
        return "\n".join(lines)
    except Exception as e:
        return f"Erreur lecture Calendar : {e}"


# ── Sheets ────────────────────────────────────────────────────────────────────

def run_append_google_sheet(spreadsheet_id: str, range_a1: str, values_csv: str) -> str:
    sid = (spreadsheet_id or getenv("GOOGLE_SHEETS_DEFAULT_ID", "")).strip()
    rng = (range_a1 or "Sheet1!A1").strip()
    if not sid:
        return "spreadsheet_id requis (ou GOOGLE_SHEETS_DEFAULT_ID dans .env)."
    rows: list[list[str]] = []
    for line in (values_csv or "").strip().splitlines():
        if line.strip():
            rows.append([c.strip() for c in line.split(",")])
    if not rows:
        return "values_csv vide (une ligne = une rangée, colonnes séparées par des virgules)."
    try:
        hdrs = _google_headers("sheets")
    except RuntimeError:
        return _sim("Sheets", f"Sheet {sid} — range {rng}\n{values_csv[:400]}")
    try:
        r = httpx.post(
            f"https://sheets.googleapis.com/v4/spreadsheets/{sid}/values/{rng}:append",
            headers=hdrs,
            params={"valueInputOption": "USER_ENTERED", "insertDataOption": "INSERT_ROWS"},
            json={"values": rows},
            timeout=25,
        )
        r.raise_for_status()
        upd = r.json().get("updates", {})
        return f"✅ {upd.get('updatedRows', '?')} ligne(s) ajoutée(s) dans {sid}"
    except Exception as e:
        return f"Erreur Sheets : {e}"


def run_create_google_sheet(title: str, headers_row: str, rows_csv: str = "") -> str:
    t = (title or "").strip()[:120] or "Export Korymb"
    headers = [h.strip() for h in (headers_row or "").split(",") if h.strip()]
    if not headers:
        return "headers_row requis (colonnes séparées par des virgules)."
    data_rows = [headers]
    for line in (rows_csv or "").strip().splitlines():
        if line.strip():
            data_rows.append([c.strip() for c in line.split(",")])
    preview = "\n".join(",".join(r) for r in data_rows)
    try:
        from services.drive_workspace import validate_sheet_export_content

        ok, reason = validate_sheet_export_content(
            "| " + " | ".join(headers) + " |\n| " + " | ".join(["---"] * len(headers)) + " |\n"
            + "\n".join("| " + " | ".join(r) + " |" for r in data_rows[1:])
            if len(data_rows) > 1
            else preview
        )
        if not ok:
            return f"Erreur Google Sheets : {reason}"
    except Exception:
        pass
    try:
        hdrs = _google_headers("sheets")
    except RuntimeError:
        return _sim("Sheets", f"Création : {t}\nColonnes : {headers}")
    try:
        r = httpx.post(
            "https://sheets.googleapis.com/v4/spreadsheets",
            headers=hdrs,
            json={"properties": {"title": t}},
            timeout=25,
        )
        r.raise_for_status()
        sid = r.json().get("spreadsheetId", "")
        url = r.json().get("spreadsheetUrl", "")
        if data_rows:
            httpx.put(
                f"https://sheets.googleapis.com/v4/spreadsheets/{sid}/values/Sheet1!A1",
                headers=hdrs,
                params={"valueInputOption": "USER_ENTERED"},
                json={"values": data_rows},
                timeout=25,
            ).raise_for_status()
        return f"✅ Google Sheet créé : {t}\n{url}\nID : {sid}"
    except Exception as e:
        return f"Erreur création Sheet : {e}"


# ── Analytics ─────────────────────────────────────────────────────────────────

def run_get_analytics_report(metric: str = "sessions", period_days: int = 7) -> str:
    prop = getenv("GA_PROPERTY_ID", "")
    if not prop:
        return "GA_PROPERTY_ID non configuré (ex: 123456789)."
    try:
        hdrs = _google_headers("analytics")
    except RuntimeError as e:
        return str(e)
    days = max(1, min(int(period_days or 7), 90))
    end = datetime.now(timezone.utc).date()
    start = end - timedelta(days=days)
    m = (metric or "sessions").strip()
    try:
        body = {
            "dateRanges": [{"startDate": start.isoformat(), "endDate": end.isoformat()}],
            "metrics": [{"name": m}],
            "dimensions": [{"name": "date"}],
        }
        r = httpx.post(
            f"https://analyticsdata.googleapis.com/v1beta/properties/{prop}:runReport",
            headers=hdrs,
            json=body,
            timeout=30,
        )
        r.raise_for_status()
        rows = r.json().get("rows") or []
        if not rows:
            return f"Aucune donnée Analytics pour {m} sur {days} jours."
        lines = [f"Google Analytics — {m} ({days} jours) :"]
        total = 0.0
        for row in rows[-14:]:
            dims = row.get("dimensionValues") or [{}]
            vals = row.get("metricValues") or [{}]
            d = dims[0].get("value", "?")
            v = vals[0].get("value", "0")
            try:
                total += float(v)
            except ValueError:
                pass
            lines.append(f"  {d} : {v}")
        lines.append(f"\nTotal période affichée : {total:.0f}")
        return "\n".join(lines)
    except Exception as e:
        return f"Erreur Analytics : {e}"
