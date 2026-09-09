"""
routers/core_health.py — Domaine santé/diagnostic : /health, /llm, /tokens, /events/stream.
Extrait de main.py — contrats API préservés à l'identique.
"""
from __future__ import annotations

import asyncio
import json
import os
import platform
import shutil
import socket
import sys
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse

from auth import resolve_tenant, require_admin
from config import settings
from database import (
    DB_ENGINE,
    DB_PATH,
    get_conn,
    sum_jobs_tokens_total,
    usage_cost_breakdown,
    usage_events_exist,
    usage_daily_breakdown,
)
from runtime_settings import merge_with_env
from llm_tiers import resolve_llm_tier, tier_config_public
from llm_providers import is_chat_completions_provider, normalize_llm_provider
from state import active_jobs, daily_tokens, today, tokens_inflight
from database import get_job as _db_get_job
from version import BACKEND_REVISION_AT, BACKEND_VERSION
from pathlib import Path
from runtime_sse import RUNTIME_SSE_WAKE, drain_job_sse_events

router = APIRouter(tags=["health"])

_KORYMB_BACKEND_DIR = Path(__file__).resolve().parents[1]
_PROCESS_STARTED_AT = time.time()


# ── Helpers internes ──────────────────────────────────────────────────────────

def _env_is_set(name: str) -> bool:
    from integration_settings import is_set

    return is_set(name)


def _probe_jina_reachable() -> bool:
    """Vérifie que r.jina.ai répond (probe léger, ~3 s max)."""
    try:
        import httpx as _httpx
        r = _httpx.get(
            "https://r.jina.ai/https://example.com",
            headers={"Accept": "text/plain", "User-Agent": "KorymbHealthProbe/1.0"},
            timeout=6,
            follow_redirects=True,
        )
        return r.status_code == 200 and len(r.text.strip()) > 30
    except Exception:
        return False


def _probe_tcp(host: str, port: int, timeout_s: float = 2.5) -> tuple[bool, str]:
    try:
        with socket.create_connection((host, int(port)), timeout=timeout_s):
            return True, "reachable"
    except Exception as e:
        return False, str(e)


def _disk_root() -> str:
    if sys.platform == "win32":
        drive = str(os.environ.get("SystemDrive") or "C:").strip()
        return drive if drive.endswith(("\\", "/")) else f"{drive}\\"
    return "/"


def _disk_metrics() -> dict | None:
    root = _disk_root()
    try:
        import psutil  # type: ignore

        du = psutil.disk_usage(root)
        return {
            "path": root,
            "total_bytes": int(du.total),
            "free_bytes": int(du.free),
            "used_percent": float(du.percent),
        }
    except Exception:
        pass
    try:
        du = shutil.disk_usage(root)
        used = max(0, int(du.total) - int(du.free))
        total = int(du.total)
        return {
            "path": root,
            "total_bytes": total,
            "free_bytes": int(du.free),
            "used_percent": round(100.0 * used / total, 1) if total else 0.0,
        }
    except Exception:
        return None


def _system_metrics_snapshot() -> dict:
    now = time.time()
    out: dict = {
        "process_uptime_s": max(0, int(now - _PROCESS_STARTED_AT)),
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "cpu_count": os.cpu_count() or 1,
    }
    disk = _disk_metrics()
    if disk:
        out["disk"] = disk
    try:
        import psutil  # type: ignore

        vm = psutil.virtual_memory()
        out["memory"] = {
            "total_bytes": int(vm.total),
            "available_bytes": int(vm.available),
            "used_percent": float(vm.percent),
        }
        out["cpu_percent"] = float(psutil.cpu_percent(interval=0.15))
    except Exception:
        pass
    return out


def _probe_google_drive_token() -> tuple[bool, str]:
    """Vérifie qu'un token Drive est obtenu (refresh OAuth ou token statique)."""
    try:
        import httpx as _httpx
        from tools import _get_google_drive_token

        token = _get_google_drive_token()
        if not token:
            return False, "Aucun token Drive disponible."
        r = _httpx.get(
            "https://www.googleapis.com/drive/v3/about",
            params={"fields": "user(displayName)"},
            headers={"Authorization": f"Bearer {token}"},
            timeout=12,
        )
        if r.status_code == 200:
            name = (r.json().get("user") or {}).get("displayName") or "OK"
            return True, f"Token valide ({name})"
        return False, f"HTTP {r.status_code}"
    except Exception as e:
        return False, str(e)[:160]


def _integration_health_snapshot(*, refresh_tools: bool = False) -> dict:
    from tools_health import probe_tools_health
    tools_probe = probe_tools_health(force=bool(refresh_tools))
    cfg = merge_with_env()
    has_google_oauth = (
        _env_is_set("GOOGLE_API_ACCESS_TOKEN")
        or (
            _env_is_set("GOOGLE_OAUTH_REFRESH_TOKEN")
            and _env_is_set("GOOGLE_OAUTH_CLIENT_ID")
            and _env_is_set("GOOGLE_OAUTH_CLIENT_SECRET")
        )
    )

    status: dict[str, dict] = {
        "llm_mistral": {
            "configured": _env_is_set("MISTRAL_API_KEY"),
            "provider_selected": str(cfg.get("llm_provider") or "") == "mistral",
        },
        "llm_openrouter": {
            "configured": _env_is_set("OPENROUTER_API_KEY"),
            "provider_selected": str(cfg.get("llm_provider") or "") == "openrouter",
        },
        "llm_anthropic": {
            "configured": _env_is_set("ANTHROPIC_API_KEY"),
            "provider_selected": str(cfg.get("llm_provider") or "") == "anthropic",
        },
        "google_oauth": {
            "configured": _env_is_set("GOOGLE_API_ACCESS_TOKEN") or (
                _env_is_set("GOOGLE_OAUTH_REFRESH_TOKEN")
                and _env_is_set("GOOGLE_OAUTH_CLIENT_ID")
                and _env_is_set("GOOGLE_OAUTH_CLIENT_SECRET")
            ),
        },
        "google_drive": {
            "configured": (
                _env_is_set("GOOGLE_DRIVE_ACCESS_TOKEN")
                or _env_is_set("GOOGLE_API_ACCESS_TOKEN")
                or (
                    _env_is_set("GOOGLE_OAUTH_REFRESH_TOKEN")
                    and _env_is_set("GOOGLE_OAUTH_CLIENT_ID")
                    and _env_is_set("GOOGLE_OAUTH_CLIENT_SECRET")
                )
            ),
            "folder_id_set": _env_is_set("GOOGLE_DRIVE_FOLDER_ID"),
        },
        "facebook": {"configured": _env_is_set("FACEBOOK_ACCESS_TOKEN") and _env_is_set("FACEBOOK_PAGE_ID")},
        "instagram": {"configured": _env_is_set("INSTAGRAM_ACCESS_TOKEN") and _env_is_set("INSTAGRAM_ACCOUNT_ID")},
        "smtp": {"configured": _env_is_set("SMTP_HOST") and _env_is_set("SMTP_USER") and _env_is_set("SMTP_PASS")},
        "fleur_db": {"configured": _env_is_set("FLEUR_DB_HOST") and _env_is_set("FLEUR_DB_USER")},
        # ── Recherche web ────────────────────────────────────────────────────
        "tavily": {
            "configured": _env_is_set("TAVILY_API_KEY"),
            "note": "1 000 req/mois gratuits — app.tavily.com",
        },
        "brave_search": {
            "configured": _env_is_set("BRAVE_SEARCH_API_KEY"),
            "note": "2 000 req/mois gratuits — api.search.brave.com",
        },
        "jina_reader": {
            "configured": True,
            "ok": _probe_jina_reachable(),
            "note": "Lecture JS gratuite (r.jina.ai) — sans clé API",
        },
        "brevo": {
            "configured": _env_is_set("BREVO_API_KEY"),
            "note": "Newsletter / campagnes email — brevo.com",
        },
        "deepl": {
            "configured": _env_is_set("DEEPL_API_KEY"),
            "note": "Traduction multilingue — deepl.com",
        },
        "image_gen": {
            "configured": _env_is_set("IMAGE_GEN_MODEL")
            and (_env_is_set("IMAGE_GEN_API_KEY") or _env_is_set("OPENROUTER_API_KEY")),
            "note": "IMAGE_GEN_MODEL + clé API (IMAGE_GEN_API_KEY ou OPENROUTER_API_KEY)",
        },
        "gmail": {
            "configured": _env_is_set("GOOGLE_GMAIL_ACCESS_TOKEN") or has_google_oauth,
            "note": "Gmail API — envoi et lecture emails.",
        },
        "google_calendar": {
            "configured": _env_is_set("GOOGLE_CALENDAR_ACCESS_TOKEN") or has_google_oauth,
            "note": "Google Calendar — RDV et agenda.",
        },
        "google_sheets": {
            "configured": _env_is_set("GOOGLE_SHEETS_ACCESS_TOKEN") or has_google_oauth,
            "note": "Google Sheets — exports leads et tableaux.",
        },
        "google_analytics": {
            "configured": _env_is_set("GA_PROPERTY_ID"),
            "note": "GA4 — trafic site (GA_PROPERTY_ID).",
        },
        "meta_webhooks": {
            "configured": _env_is_set("META_WEBHOOK_VERIFY_TOKEN"),
            "note": "Webhooks commentaires Meta — GET/POST /webhooks/meta",
        },
        "youtube": {"configured": _env_is_set("YOUTUBE_API_KEY"), "note": "YouTube Data API v3"},
        "whatsapp": {
            "configured": _env_is_set("WHATSAPP_ACCESS_TOKEN") and _env_is_set("WHATSAPP_PHONE_NUMBER_ID"),
            "note": "WhatsApp Business Cloud API",
        },
        "crm": {
            "configured": _env_is_set("CRM_PROVIDER"),
            "note": "CRM_PROVIDER=notion|hubspot",
        },
        "stripe": {"configured": _env_is_set("STRIPE_SECRET_KEY"), "note": "Revenus Stripe"},
        "paypal": {
            "configured": _env_is_set("PAYPAL_CLIENT_ID") and _env_is_set("PAYPAL_CLIENT_SECRET"),
            "note": "Solde PayPal",
        },
        "canva": {"configured": _env_is_set("CANVA_API_KEY"), "note": "Visuels Canva Autofill"},
        "pinterest": {"configured": _env_is_set("PINTEREST_ACCESS_TOKEN"), "note": "Épingles Pinterest"},
        "discord": {
            "configured": _env_is_set("DISCORD_WEBHOOK_URL") or _env_is_set("DISCORD_BOT_TOKEN"),
            "note": "Notifications Discord",
        },
        "telegram": {
            "configured": _env_is_set("TELEGRAM_BOT_TOKEN") and _env_is_set("TELEGRAM_CHAT_ID"),
            "note": "Bot Telegram",
        },
        "korymb_webhook": {
            "configured": _env_is_set("KORYMB_WEBHOOK_URL") or _env_is_set("NOTIFICATION_WEBHOOK_URL"),
            "note": "Webhook sortant n8n/Zapier/Make",
        },
        "text_to_speech": {
            "configured": _env_is_set("ELEVENLABS_API_KEY") or _env_is_set("TTS_API_KEY") or _env_is_set("OPENAI_API_KEY"),
            "note": "Synthèse vocale MP3",
        },
        "web_tools": {
            "configured": True,
            "ok": bool(tools_probe.get("web_search", {}).get("ok")),
            "active_provider": tools_probe.get("web_search", {}).get("provider", "unknown"),
            "providers_configured": {
                "tavily": _env_is_set("TAVILY_API_KEY"),
                "brave": _env_is_set("BRAVE_SEARCH_API_KEY"),
                "duckduckgo": True,
            },
        },
    }

    smtp_host = str(os.getenv("SMTP_HOST", "")).strip()
    if smtp_host:
        ok, detail = _probe_tcp(smtp_host, 465)
        status["smtp"]["reachable"] = ok
        status["smtp"]["probe_detail"] = detail[:160]

    try:
        from db_fleur import _get_conn  # type: ignore
        with _get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 AS ok")
                _ = cur.fetchone()
        status["fleur_db"]["reachable"] = True
    except Exception as e:
        status["fleur_db"]["reachable"] = False
        status["fleur_db"]["probe_detail"] = str(e)[:180]

    if status.get("google_drive", {}).get("configured"):
        ok, detail = _probe_google_drive_token()
        status["google_drive"]["reachable"] = ok
        if not ok:
            status["google_drive"]["probe_detail"] = detail

    _probe_ok_map = {
        "instagram": "instagram",
        "facebook": "facebook",
        "brevo": "send_newsletter",
        "deepl": "translate_text",
        "image_gen": "generate_image",
        "gmail": "gmail",
        "google_calendar": "google_calendar",
        "google_sheets": "google_sheets",
        "google_analytics": "google_analytics",
        "meta_webhooks": "meta_webhooks",
        "youtube": "youtube",
        "whatsapp": "whatsapp",
        "crm": "crm",
        "stripe": "stripe",
        "paypal": "paypal",
        "canva": "canva",
        "pinterest": "pinterest",
        "discord": "discord",
        "telegram": "telegram",
        "korymb_webhook": "webhook",
        "text_to_speech": "text_to_speech",
    }
    for integ_id, probe_key in _probe_ok_map.items():
        probe_row = tools_probe.get(probe_key) or {}
        if "ok" in probe_row:
            status[integ_id]["ok"] = bool(probe_row.get("ok"))

    for key_only in ("tavily", "brave_search"):
        if status.get(key_only, {}).get("configured"):
            status[key_only]["ok"] = True

    if status["smtp"].get("configured"):
        status["smtp"]["ok"] = status["smtp"].get("reachable") is True

    if status["fleur_db"].get("configured"):
        status["fleur_db"]["ok"] = status["fleur_db"].get("reachable") is True

    if status["google_drive"].get("configured"):
        drive_ok = status["google_drive"].get("reachable") is True
        status["google_drive"]["ok"] = drive_ok and bool(status["google_drive"].get("folder_id_set"))

    if status["google_oauth"].get("configured"):
        drive_row = status.get("google_drive", {})
        if drive_row.get("reachable") is False:
            status["google_oauth"]["ok"] = False
        elif drive_row.get("reachable") is True:
            status["google_oauth"]["ok"] = True
        else:
            status["google_oauth"]["ok"] = True

    for llm_id in ("llm_mistral", "llm_openrouter", "llm_anthropic"):
        row = status[llm_id]
        if row.get("provider_selected"):
            row["ok"] = bool(row.get("configured"))

    configured = sum(1 for v in status.values() if bool(v.get("configured")))
    reachable = sum(1 for v in status.values() if bool(v.get("ok")) or bool(v.get("reachable")))
    return {
        "integrations": status,
        "tools_probe": tools_probe,
        "summary": {
            "configured_count": configured,
            "reachable_count": reachable,
            "total_integrations": len(status),
        },
    }


def _database_runtime_snapshot(*, include_probe: bool = True) -> dict:
    engine = str(DB_ENGINE or "sqlite").strip().lower()
    is_maria = engine in {"mariadb", "mysql"}
    runtime_env = str(os.getenv("ENV") or os.getenv("NODE_ENV") or "development").strip().lower()
    details: dict[str, object] = {
        "engine": "mariadb" if is_maria else "sqlite",
        "runtime_env": runtime_env,
        "connected": False,
    }
    if is_maria:
        host = str(os.getenv("KORYMB_DB_HOST") or os.getenv("FLEUR_DB_HOST") or "127.0.0.1")
        port = int(os.getenv("KORYMB_DB_PORT") or os.getenv("FLEUR_DB_PORT") or "3306")
        user = str(os.getenv("KORYMB_DB_USER") or os.getenv("FLEUR_DB_USER") or "")
        name = str(os.getenv("KORYMB_DB_NAME") or os.getenv("FLEUR_DB_NAME") or "korymb")
        details.update({
            "host": host,
            "port": port,
            "database": name,
            "user": user,
        })
    else:
        details["path"] = str(DB_PATH)

    if include_probe:
        try:
            with get_conn() as conn:
                conn.execute("SELECT 1")
            details["connected"] = True
        except Exception as e:
            details["connected"] = False
            details["probe_detail"] = str(e)[:180]
    else:
        details["connected"] = None
    return details


def _web_tools_probe_json(*, refresh: bool) -> JSONResponse:
    from tools_health import probe_tools_health
    return JSONResponse(
        content=probe_tools_health(force=bool(refresh)),
        headers={"Cache-Control": "no-store, max-age=0", "X-Korymb-Version": BACKEND_VERSION},
    )


_TOKENS_PAYLOAD_CACHE: tuple[float, dict] | None = None
_TOKENS_PAYLOAD_TTL_S = 25.0


def _tokens_payload_uncached() -> dict:
    from database import probe_database_connection

    d = today()
    t = daily_tokens.get(d, {"in": 0, "out": 0})
    cfg = merge_with_env()
    cost = (
        t["in"] * float(cfg.get("llm_price_input_per_million_usd") or 0)
        + t["out"] * float(cfg.get("llm_price_output_per_million_usd") or 0)
    ) / 1_000_000
    db_probe = probe_database_connection()
    try:
        usage = usage_cost_breakdown()
        usage_events = usage_events_exist()
    except Exception:
        usage = {
            "cost_today_usd": 0.0,
            "cost_week_usd": 0.0,
            "cost_month_usd": 0.0,
            "cost_total_usd": 0.0,
            "usage_tokens_today": 0,
            "usage_tokens_week": 0,
            "usage_tokens_month": 0,
            "usage_tokens_last_hour": 0,
            "usage_tokens_last_minute": 0,
        }
        usage_events = False
    tier_pub = tier_config_public(cfg)
    return {
        "today": d, "tokens_in": t["in"], "tokens_out": t["out"],
        "total": t["in"] + t["out"], "cost_usd": round(cost, 4),
        "alert": (t["in"] + t["out"]) >= settings.token_alert_threshold,
        "budget_exceeded": (t["in"] + t["out"]) >= settings.max_tokens_per_job * 10,
        "max_per_job": settings.max_tokens_per_job,
        "alert_threshold": settings.token_alert_threshold,
        "lifetime_tokens_total": _lifetime_tokens_total(),
        "tokens_inflight": tokens_inflight(),
        **usage,
        "usage_events_active": usage_events,
        "database_connected": bool(db_probe.get("connected")),
        "database_detail": db_probe.get("detail"),
        "expensive_research_tier": bool(tier_pub.get("expensive_research_tier")),
        "tier_routing": tier_pub,
    }


def tokens_payload() -> dict:
    global _TOKENS_PAYLOAD_CACHE
    now = time.time()
    if _TOKENS_PAYLOAD_CACHE and (now - _TOKENS_PAYLOAD_CACHE[0]) < _TOKENS_PAYLOAD_TTL_S:
        return _TOKENS_PAYLOAD_CACHE[1]
    body = _tokens_payload_uncached()
    _TOKENS_PAYLOAD_CACHE = (now, body)
    return body


def _lifetime_tokens_total() -> int:
    try:
        base = sum_jobs_tokens_total()
    except Exception:
        base = 0
    extra = 0
    for jid, job in active_jobs.items():
        live = int(job.get("tokens_in", 0)) + int(job.get("tokens_out", 0))
        row = _db_get_job(jid)
        db_t = (int(row.get("tokens_in", 0)) + int(row.get("tokens_out", 0))) if row else 0
        extra += max(0, live - db_t)
    return base + extra


def _runtime_sync_snapshot() -> dict:
    cfg = merge_with_env()
    provider = normalize_llm_provider(None, cfg)
    if is_chat_completions_provider(provider):
        model, _, _, _ = resolve_llm_tier(cfg, "lite", provider=provider)
    else:
        provider = "anthropic"
        model = cfg.get("anthropic_model")
    return {
        "ts": datetime.now(ZoneInfo("Europe/Paris")).isoformat(),
        "backend_version": BACKEND_VERSION,
        "llm": {"provider": provider, "model": model},
        "database": _database_runtime_snapshot(include_probe=False),
        "health": {"status": "ok"},
    }


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/health/live")
def health_live():
    """Liveness minimale pour watchdog dev — aucune I/O DB."""
    return JSONResponse(
        content={"status": "ok", "live": True, "version": BACKEND_VERSION},
        headers={"Cache-Control": "no-store, max-age=0", "X-Korymb-Version": BACKEND_VERSION},
    )


@router.get("/health/database")
def health_database():
    """Probe MariaDB/SQLite — bandeau UI (tunnel SSH requis en dev MariaDB)."""
    snap = _database_runtime_snapshot(include_probe=True)
    status_code = 200 if snap.get("connected") is True else 503
    body = {"status": "ok" if status_code == 200 else "degraded", "database": snap}
    return JSONResponse(
        content=body,
        status_code=status_code,
        headers={"Cache-Control": "no-store, max-age=0", "X-Korymb-Version": BACKEND_VERSION},
    )


@router.get("/health")
def health(
    include_tools: bool = Query(False),
    refresh_tools: bool = Query(False),
):
    """Liveness process : pas de ping DB (`database.connected` = null). Voir `/health/database`."""
    from database import JOB_ID_MAX_LEN

    body: dict = {
        "status": "ok",
        "service": "korymb-backend",
        "version": BACKEND_VERSION,
        "revision": BACKEND_VERSION,
        "revision_at": BACKEND_REVISION_AT or None,
        "code_dir": str(_KORYMB_BACKEND_DIR),
        "mission_session_delete_routes": True,
        "database": _database_runtime_snapshot(include_probe=False),
    }
    if include_tools:
        from tools_health import probe_tools_health
        body["tools"] = probe_tools_health(force=bool(refresh_tools))
    return JSONResponse(
        content=body,
        headers={"Cache-Control": "no-store, max-age=0", "X-Korymb-Version": BACKEND_VERSION},
    )


@router.get("/admin/system-health", dependencies=[Depends(require_admin)])
def admin_system_health(refresh_tools: bool = False):
    payload = {
        "status": "ok",
        "version": BACKEND_VERSION,
        "revision_at": BACKEND_REVISION_AT or None,
        "service": "korymb-backend",
        "system": _system_metrics_snapshot(),
        "database": _database_runtime_snapshot(include_probe=True),
        **_integration_health_snapshot(refresh_tools=bool(refresh_tools)),
    }
    return JSONResponse(
        content=payload,
        headers={"Cache-Control": "no-store, max-age=0", "X-Korymb-Version": BACKEND_VERSION},
    )


@router.get("/health/tools")
def health_tools(refresh: bool = False):
    return _web_tools_probe_json(refresh=refresh)


@router.get("/probe/web-tools")
def probe_web_tools_endpoint(refresh: bool = False):
    return _web_tools_probe_json(refresh=refresh)


@router.get("/llm")
def llm_public_info():
    cfg = merge_with_env()
    provider = normalize_llm_provider(None, cfg)
    if is_chat_completions_provider(provider):
        model, tier_key, _, _ = resolve_llm_tier(cfg, "lite", provider=provider)
        payload = {
            "provider": provider,
            "model": model,
            "model_fallback": cfg.get("mistral_model") if provider == "mistral" else cfg.get("openrouter_model"),
            "tier": tier_key,
            "base_url": cfg.get("mistral_base_url") if provider == "mistral" else cfg.get("openrouter_base_url"),
            "tier_labels": tier_config_public(cfg).get("tier_labels"),
        }
    else:
        payload = {"provider": "anthropic", "model": cfg.get("anthropic_model")}
    return JSONResponse(
        payload,
        headers={"Cache-Control": "no-store, max-age=0", "X-Korymb-Version": str(BACKEND_VERSION)},
    )


@router.get("/tokens")
def get_tokens():
    return JSONResponse(
        tokens_payload(),
        headers={"Cache-Control": "no-store, max-age=0", "X-Korymb-Version": str(BACKEND_VERSION)},
    )


@router.get("/tokens/daily", dependencies=[Depends(resolve_tenant)])
def get_tokens_daily(days: int = Query(default=7, ge=1, le=30)):
    """Coût et tokens par jour sur les `days` derniers jours (pour graphique)."""
    return {"daily": usage_daily_breakdown(days)}


@router.get("/events/stream", dependencies=[Depends(resolve_tenant)])
async def events_stream(request: Request):
    async def gen():
        last_payload = ""
        event_id = 0
        first_tick = True
        while True:
            if await request.is_disconnected():
                break
            try:
                if first_tick:
                    first_tick = False
                    drained = drain_job_sse_events()
                else:
                    woke = await asyncio.to_thread(RUNTIME_SSE_WAKE.wait, 2.0)
                    if woke:
                        RUNTIME_SSE_WAKE.clear()
                    drained = drain_job_sse_events()
                for job_ev in drained:
                    event_id += 1
                    yield (
                        f"id: {event_id}\nevent: job_event\ndata: "
                        f"{json.dumps(job_ev, ensure_ascii=False)}\n\n"
                    )
                snapshot = await asyncio.to_thread(_runtime_sync_snapshot)
                payload = json.dumps(snapshot, ensure_ascii=False)
                if payload != last_payload:
                    event_id += 1
                    yield f"id: {event_id}\nevent: runtime_sync\ndata: {payload}\n\n"
                    last_payload = payload
                elif not drained:
                    yield "event: ping\ndata: {}\n\n"
            except Exception as e:
                err = json.dumps({"error": str(e), "ts": datetime.now(ZoneInfo("Europe/Paris")).isoformat()})
                yield f"event: runtime_error\ndata: {err}\n\n"

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "X-Korymb-Version": str(BACKEND_VERSION),
        },
    )
