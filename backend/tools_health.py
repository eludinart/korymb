"""
Sondes d'accessibilité des outils Korymb v3.1 — résultat mis en cache 2 min.
Vérifie : web_search (Tavily/Brave/DDG), read_webpage (Jina/httpx),
          describe_image (ANTHROPIC_API_KEY), Instagram, Facebook, Google Drive.
"""
from __future__ import annotations

import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().with_name(".env"), override=True)

from tools import run_read_webpage, run_web_search

_CACHE: dict[str, Any] = {"t": 0.0, "ttl_s": 120, "payload": None}


def _web_search_failed(text: str) -> bool:
    t = (text or "").strip()
    return t.startswith("Erreur recherche") or t.startswith("aucun provider")


def _read_webpage_failed(text: str) -> bool:
    t = (text or "").strip()
    return t.startswith("Impossible de lire") or t.startswith("Erreur outil read_webpage")


def _detect_web_provider(text: str) -> str:
    t = (text or "").strip()
    if "Tavily" in t:
        return "tavily"
    if "Brave" in t:
        return "brave"
    if "DuckDuckGo" in t:
        return "duckduckgo"
    return "unknown"


def _detect_read_provider(text: str) -> str:
    return "jina" if text.startswith("[Jina Reader]") else "httpx"


def probe_tools_health(*, force: bool = False) -> dict[str, Any]:
    """Sonde les outils principaux et met en cache ~2 min."""
    now = time.time()
    if (
        not force
        and _CACHE["payload"] is not None
        and (now - float(_CACHE["t"] or 0)) < float(_CACHE["ttl_s"] or 120)
    ):
        out = dict(_CACHE["payload"])
        out["cached"] = True
        out["cache_age_s"] = int(now - float(_CACHE["t"] or 0))
        return out

    checked = datetime.now(timezone.utc).isoformat()

    # ── Web search ─────────────────────────────────────────────────────────
    q = "korymb connectivity test"
    ws_raw = run_web_search(q)
    ws_ok = not _web_search_failed(ws_raw)
    ws_provider = _detect_web_provider(ws_raw) if ws_ok else "none"

    # ── Lecture de page ────────────────────────────────────────────────────
    test_url = "https://httpbin.org/html"
    rw_raw = run_read_webpage(test_url)
    rw_ok = not _read_webpage_failed(rw_raw)
    rw_provider = _detect_read_provider(rw_raw) if rw_ok else "none"

    # ── Clés API disponibles ───────────────────────────────────────────────
    has_tavily    = bool(os.getenv("TAVILY_API_KEY", "").strip())
    has_brave     = bool(os.getenv("BRAVE_SEARCH_API_KEY", "").strip())
    has_anthropic = bool(os.getenv("ANTHROPIC_API_KEY", "").strip())
    has_ig        = bool(os.getenv("INSTAGRAM_ACCESS_TOKEN", "").strip()) and bool(os.getenv("INSTAGRAM_ACCOUNT_ID", "").strip())
    has_fb        = bool(os.getenv("FACEBOOK_ACCESS_TOKEN", "").strip()) and bool(os.getenv("FACEBOOK_PAGE_ID", "").strip())
    has_drive     = bool(
        str(os.getenv("GOOGLE_DRIVE_ACCESS_TOKEN", "") or os.getenv("GOOGLE_API_ACCESS_TOKEN", "")).strip()
        or (os.getenv("GOOGLE_OAUTH_REFRESH_TOKEN", "").strip() and os.getenv("GOOGLE_OAUTH_CLIENT_ID", "").strip())
    )

    payload = {
        "checked_at": checked,
        "cached": False,
        "cache_ttl_s": int(_CACHE["ttl_s"] or 120),
        "web_search": {
            "ok": ws_ok,
            "provider": ws_provider,
            "providers_configured": {
                "tavily": has_tavily,
                "brave": has_brave,
                "duckduckgo": True,
            },
            "probe_query": q,
            "message": None if ws_ok else (ws_raw[:400] + ("…" if len(ws_raw) > 400 else "")),
        },
        "read_webpage": {
            "ok": rw_ok,
            "provider": rw_provider,
            "jina_available": True,
            "probe_url": test_url,
            "probe_url_note": "httpbin.org/html — page HTML simple avec contenu garanti",
            "message": None if rw_ok else (rw_raw[:400] + ("…" if len(rw_raw) > 400 else "")),
        },
        "search_linkedin": {
            "ok": ws_ok,
            "note": "Utilise le même provider que web_search (ciblé site:linkedin.com).",
        },
        "describe_image": {
            "ok": has_anthropic,
            "note": "Claude Haiku Vision via ANTHROPIC_API_KEY.",
            "configured": has_anthropic,
        },
        "instagram": {
            "ok": has_ig,
            "configured": has_ig,
            "note": "Nécessite INSTAGRAM_ACCESS_TOKEN + INSTAGRAM_ACCOUNT_ID (lecture + publication).",
        },
        "facebook": {
            "ok": has_fb,
            "configured": has_fb,
            "note": "Nécessite FACEBOOK_ACCESS_TOKEN + FACEBOOK_PAGE_ID (lecture + publication).",
        },
        "google_drive": {
            "ok": has_drive,
            "configured": has_drive,
            "note": "Nécessite GOOGLE_API_ACCESS_TOKEN ou GOOGLE_OAUTH_REFRESH_TOKEN+CLIENT_ID+CLIENT_SECRET.",
        },
    }
    _CACHE["t"] = now
    _CACHE["payload"] = payload
    return dict(payload)


def tools_reachable_summary(data: dict[str, Any] | None) -> tuple[bool, str]:
    """True si la recherche web et la lecture HTTP sont opérationnelles."""
    if not isinstance(data, dict):
        return False, "Pas de données de santé."
    ws = data.get("web_search") or {}
    rw = data.get("read_webpage") or {}
    ok = bool(ws.get("ok")) and bool(rw.get("ok"))
    if ok:
        prov = ws.get("provider", "?")
        rp   = rw.get("provider", "?")
        return True, f"Recherche web ({prov}) et lecture de page ({rp}) opérationnels."
    parts = []
    if not ws.get("ok"):
        parts.append("recherche web")
    if not rw.get("ok"):
        parts.append("lecture de page")
    return False, ", ".join(parts) + " : problème signalé."
