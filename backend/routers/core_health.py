"""
routers/core_health.py — Domaine santé/diagnostic : /health, /llm, /tokens, /events/stream.
Extrait de main.py — contrats API préservés à l'identique.
"""
from __future__ import annotations

import asyncio
import json
import os
import platform
import socket
import sys
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse

from auth import verify_secret
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
from llm_tiers import resolve_openrouter_tier, tier_config_public
from state import active_jobs, daily_tokens, today, tokens_inflight
from database import get_job as _db_get_job
from version import BACKEND_REVISION_AT, BACKEND_VERSION
from pathlib import Path

router = APIRouter(tags=["health"])

_KORYMB_BACKEND_DIR = Path(__file__).resolve().parents[1]
_PROCESS_STARTED_AT = time.time()


# ── Helpers internes ──────────────────────────────────────────────────────────

def _env_is_set(name: str) -> bool:
    return bool(str(os.getenv(name, "")).strip())


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


def _system_metrics_snapshot() -> dict:
    now = time.time()
    out: dict = {
        "process_uptime_s": max(0, int(now - _PROCESS_STARTED_AT)),
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "cpu_count": os.cpu_count() or 1,
    }
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


def _integration_health_snapshot(*, refresh_tools: bool = False) -> dict:
    from tools_health import probe_tools_health
    tools_probe = probe_tools_health(force=bool(refresh_tools))
    cfg = merge_with_env()

    status: dict[str, dict] = {
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


def tokens_payload() -> dict:
    d = today()
    t = daily_tokens.get(d, {"in": 0, "out": 0})
    cfg = merge_with_env()
    cost = (
        t["in"] * float(cfg.get("llm_price_input_per_million_usd") or 0)
        + t["out"] * float(cfg.get("llm_price_output_per_million_usd") or 0)
    ) / 1_000_000
    usage = usage_cost_breakdown()
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
        "usage_events_active": usage_events_exist(),
        "expensive_research_tier": bool(tier_pub.get("expensive_research_tier")),
        "tier_routing": tier_pub,
    }


def _lifetime_tokens_total() -> int:
    base = sum_jobs_tokens_total()
    extra = 0
    for jid, job in active_jobs.items():
        live = int(job.get("tokens_in", 0)) + int(job.get("tokens_out", 0))
        row = _db_get_job(jid)
        db_t = (int(row.get("tokens_in", 0)) + int(row.get("tokens_out", 0))) if row else 0
        extra += max(0, live - db_t)
    return base + extra


def _runtime_sync_snapshot() -> dict:
    cfg = merge_with_env()
    provider = str(cfg.get("llm_provider") or "anthropic").strip().lower()
    if provider == "openrouter":
        model, _, _, _ = resolve_openrouter_tier(cfg, "lite")
    else:
        provider = "anthropic"
        model = cfg.get("anthropic_model")
    return {
        "ts": datetime.now(ZoneInfo("Europe/Paris")).isoformat(),
        "backend_version": BACKEND_VERSION,
        "llm": {"provider": provider, "model": model},
        "database": _database_runtime_snapshot(include_probe=False),
        "tokens": tokens_payload(),
        "health": {"status": "ok"},
    }


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/health")
def health(
    include_tools: bool = Query(False),
    refresh_tools: bool = Query(False),
):
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


@router.get("/admin/system-health", dependencies=[Depends(verify_secret)])
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
    provider = str(cfg.get("llm_provider") or "anthropic").strip().lower()
    if provider == "openrouter":
        model, tier_key, _, _ = resolve_openrouter_tier(cfg, "lite")
        payload = {
            "provider": "openrouter",
            "model": model,
            "model_fallback": cfg.get("openrouter_model"),
            "tier": tier_key,
            "base_url": cfg.get("openrouter_base_url"),
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


@router.get("/tokens/daily", dependencies=[Depends(verify_secret)])
def get_tokens_daily(days: int = Query(default=7, ge=1, le=30)):
    """Coût et tokens par jour sur les `days` derniers jours (pour graphique)."""
    return {"daily": usage_daily_breakdown(days)}


@router.get("/events/stream", dependencies=[Depends(verify_secret)])
async def events_stream(request: Request):
    async def gen():
        last_payload = ""
        event_id = 0
        while True:
            if await request.is_disconnected():
                break
            try:
                snapshot = _runtime_sync_snapshot()
                payload = json.dumps(snapshot, ensure_ascii=False)
                if payload != last_payload:
                    event_id += 1
                    yield f"id: {event_id}\nevent: runtime_sync\ndata: {payload}\n\n"
                    last_payload = payload
                else:
                    yield "event: ping\ndata: {}\n\n"
            except Exception as e:
                err = json.dumps({"error": str(e), "ts": datetime.now(ZoneInfo("Europe/Paris")).isoformat()})
                yield f"event: runtime_error\ndata: {err}\n\n"
            await asyncio.sleep(2.0)

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
