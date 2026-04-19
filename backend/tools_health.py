"""
Sondes d’accessibilité des outils gratuits (web) — résultat mis en cache pour limiter les appels externes.
"""
from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any

from tools import run_read_webpage, run_web_search

_CACHE: dict[str, Any] = {"t": 0.0, "ttl_s": 120, "payload": None}


def _web_search_failed(text: str) -> bool:
    t = (text or "").strip()
    return t.startswith("Erreur recherche") or t.startswith("DuckDuckGo non disponible")


def _read_webpage_failed(text: str) -> bool:
    t = (text or "").strip()
    return t.startswith("Impossible de lire") or t.startswith("Erreur outil read_webpage")


def probe_tools_health(*, force: bool = False) -> dict[str, Any]:
    """Appelle DDG et une page HTTP minimale ; met en cache ~2 min."""
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
    q = "korymb connectivity"
    ws_raw = run_web_search(q)
    ws_ok = not _web_search_failed(ws_raw)

    url = "https://example.com"
    rw_raw = run_read_webpage(url)
    rw_ok = not _read_webpage_failed(rw_raw)

    linkedin_note = "Meme fournisseur que la recherche web (DuckDuckGo)."
    payload = {
        "checked_at": checked,
        "cached": False,
        "cache_ttl_s": int(_CACHE["ttl_s"] or 120),
        "web_search": {
            "ok": ws_ok,
            "provider": "duckduckgo",
            "probe_query": q,
            "message": None if ws_ok else (ws_raw[:400] + ("…" if len(ws_raw) > 400 else "")),
        },
        "read_webpage": {
            "ok": rw_ok,
            "probe_url": url,
            "message": None if rw_ok else (rw_raw[:400] + ("…" if len(rw_raw) > 400 else "")),
        },
        "search_linkedin": {
            "ok": ws_ok,
            "note": linkedin_note,
        },
    }
    _CACHE["t"] = now
    _CACHE["payload"] = payload
    return dict(payload)


def tools_reachable_summary(data: dict[str, Any] | None) -> tuple[bool, str]:
    """True si tout le nécessaire prospection HTTP/DDG semble OK."""
    if not isinstance(data, dict):
        return False, "Pas de données"
    ws = data.get("web_search") or {}
    rw = data.get("read_webpage") or {}
    ok = bool(ws.get("ok")) and bool(rw.get("ok"))
    if ok:
        return True, "Recherche web et lecture HTTP accessibles."
    parts = []
    if not ws.get("ok"):
        parts.append("recherche web (DuckDuckGo)")
    if not rw.get("ok"):
        parts.append("lecture de page HTTP")
    return False, ", ".join(parts) + " : problème signalé."
