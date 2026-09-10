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


def _integration_health_snapshot(*, refresh_tools: bool = False) -> dict:
    """Délègue à la sonde unique tools_health (plus de double logique configured/ok)."""
    from tools_health import integrations_from_tools_probe, probe_tools_health

    tools_probe = probe_tools_health(force=bool(refresh_tools))
    return integrations_from_tools_probe(tools_probe, llm_cfg=merge_with_env())


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
