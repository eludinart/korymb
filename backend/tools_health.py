"""
Sondes d'accessibilité des outils Korymb v3.2 — résultat mis en cache 2 min.
Vérifie : web_search, read_webpage, describe_image, réseaux, Drive, email, PDF, RSS, image gen, newsletter, traduction.
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
    test_url = "https://example.com"
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
    has_smtp      = bool(os.getenv("SMTP_HOST", "").strip() and os.getenv("SMTP_USER", "").strip())
    has_brevo     = bool(os.getenv("BREVO_API_KEY", "").strip())
    has_deepl     = bool(os.getenv("DEEPL_API_KEY", "").strip())
    has_image_gen = bool(
        os.getenv("IMAGE_GEN_MODEL", "").strip()
        and (os.getenv("IMAGE_GEN_API_KEY", "").strip() or os.getenv("OPENROUTER_API_KEY", "").strip())
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
            "probe_url_note": "example.com — page HTML stable (httpbin.org souvent inaccessible)",
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
            "folder_id_set": bool(os.getenv("GOOGLE_DRIVE_FOLDER_ID", "").strip()),
            "note": "GOOGLE_API_ACCESS_TOKEN ou OAuth refresh + client id/secret.",
        },
        "send_email": {
            "ok": has_smtp,
            "configured": has_smtp,
            "note": "SMTP_HOST + SMTP_USER + SMTP_PASS — brouillon si non configuré.",
        },
        "send_newsletter": {
            "ok": has_brevo,
            "configured": has_brevo,
            "note": "BREVO_API_KEY — campagnes email marketing.",
        },
        "generate_image": {
            "ok": has_image_gen,
            "configured": has_image_gen,
            "note": "IMAGE_GEN_MODEL + clé API (IMAGE_GEN_API_KEY ou OPENROUTER_API_KEY).",
        },
        "read_pdf": {
            "ok": True,
            "note": "Extraction texte PDF via pypdf (URL publique http/https).",
        },
        "monitor_rss": {
            "ok": True,
            "note": "Veille RSS/Atom via feedparser — sans clé API.",
        },
        "translate_text": {
            "ok": has_deepl,
            "configured": has_deepl,
            "note": "DeepL API — DEEPL_API_KEY.",
        },
        "get_instagram_insights": {
            "ok": has_ig,
            "configured": has_ig,
            "note": "Métriques Instagram Business via Graph API.",
        },
        "get_facebook_insights": {
            "ok": has_fb,
            "configured": has_fb,
            "note": "Métriques page Facebook via Graph API.",
        },
        "schedule_social": {
            "ok": has_ig or has_fb,
            "configured": has_ig or has_fb,
            "note": "Planification posts IG/FB — tokens Meta requis.",
        },
        # ── Google Workspace ─────────────────────────────────────────────────
        "gmail": {
            "ok": bool(os.getenv("GOOGLE_GMAIL_ACCESS_TOKEN", "").strip() or has_drive),
            "configured": bool(os.getenv("GOOGLE_GMAIL_ACCESS_TOKEN", "").strip() or has_drive),
            "note": "GOOGLE_GMAIL_ACCESS_TOKEN ou OAuth Google partagé.",
        },
        "google_calendar": {
            "ok": bool(os.getenv("GOOGLE_CALENDAR_ACCESS_TOKEN", "").strip() or has_drive),
            "configured": bool(os.getenv("GOOGLE_CALENDAR_ACCESS_TOKEN", "").strip() or has_drive),
            "note": "GOOGLE_CALENDAR_ACCESS_TOKEN ou OAuth Google partagé.",
        },
        "google_sheets": {
            "ok": bool(os.getenv("GOOGLE_SHEETS_ACCESS_TOKEN", "").strip() or has_drive),
            "configured": bool(os.getenv("GOOGLE_SHEETS_ACCESS_TOKEN", "").strip() or has_drive),
            "note": "GOOGLE_SHEETS_ACCESS_TOKEN ou OAuth Google partagé.",
        },
        "google_analytics": {
            "ok": bool(os.getenv("GA_PROPERTY_ID", "").strip()),
            "configured": bool(os.getenv("GA_PROPERTY_ID", "").strip()),
            "note": "GA_PROPERTY_ID + token Analytics ou OAuth.",
        },
        "meta_webhooks": {
            "ok": bool(os.getenv("META_WEBHOOK_VERIFY_TOKEN", "").strip() and os.getenv("META_PAGE_ACCESS_TOKEN", "").strip()),
            "configured": bool(os.getenv("META_WEBHOOK_VERIFY_TOKEN", "").strip()),
            "note": "Webhooks commentaires FB/IG — META_WEBHOOK_VERIFY_TOKEN + META_PAGE_ACCESS_TOKEN.",
        },
        "youtube": {
            "ok": bool(os.getenv("YOUTUBE_API_KEY", "").strip()),
            "configured": bool(os.getenv("YOUTUBE_API_KEY", "").strip()),
            "note": "YOUTUBE_API_KEY — Data API v3.",
        },
        "whatsapp": {
            "ok": bool(os.getenv("WHATSAPP_ACCESS_TOKEN", "").strip() and os.getenv("WHATSAPP_PHONE_NUMBER_ID", "").strip()),
            "configured": bool(os.getenv("WHATSAPP_ACCESS_TOKEN", "").strip()),
            "note": "WhatsApp Business Cloud API.",
        },
        "crm": {
            "ok": bool(
                (os.getenv("CRM_PROVIDER", "").strip() == "notion" and os.getenv("NOTION_API_KEY", "").strip())
                or (os.getenv("CRM_PROVIDER", "").strip() == "hubspot" and os.getenv("HUBSPOT_API_KEY", "").strip())
            ),
            "configured": bool(os.getenv("CRM_PROVIDER", "").strip()),
            "note": "CRM_PROVIDER=notion|hubspot + clés associées.",
        },
        "stripe": {
            "ok": bool(os.getenv("STRIPE_SECRET_KEY", "").strip()),
            "configured": bool(os.getenv("STRIPE_SECRET_KEY", "").strip()),
            "note": "STRIPE_SECRET_KEY — revenus.",
        },
        "paypal": {
            "ok": bool(os.getenv("PAYPAL_CLIENT_ID", "").strip() and os.getenv("PAYPAL_CLIENT_SECRET", "").strip()),
            "configured": bool(os.getenv("PAYPAL_CLIENT_ID", "").strip()),
            "note": "PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET.",
        },
        "canva": {
            "ok": bool(os.getenv("CANVA_API_KEY", "").strip()),
            "configured": bool(os.getenv("CANVA_API_KEY", "").strip()),
            "note": "CANVA_API_KEY — visuels brandés.",
        },
        "pinterest": {
            "ok": bool(os.getenv("PINTEREST_ACCESS_TOKEN", "").strip()),
            "configured": bool(os.getenv("PINTEREST_ACCESS_TOKEN", "").strip()),
            "note": "PINTEREST_ACCESS_TOKEN + PINTEREST_BOARD_ID.",
        },
        "discord": {
            "ok": bool(os.getenv("DISCORD_WEBHOOK_URL", "").strip() or os.getenv("DISCORD_BOT_TOKEN", "").strip()),
            "configured": bool(os.getenv("DISCORD_WEBHOOK_URL", "").strip() or os.getenv("DISCORD_BOT_TOKEN", "").strip()),
            "note": "DISCORD_WEBHOOK_URL ou DISCORD_BOT_TOKEN + CHANNEL_ID.",
        },
        "telegram": {
            "ok": bool(os.getenv("TELEGRAM_BOT_TOKEN", "").strip() and os.getenv("TELEGRAM_CHAT_ID", "").strip()),
            "configured": bool(os.getenv("TELEGRAM_BOT_TOKEN", "").strip()),
            "note": "TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID.",
        },
        "webhook": {
            "ok": bool(os.getenv("KORYMB_WEBHOOK_URL", "").strip() or os.getenv("NOTIFICATION_WEBHOOK_URL", "").strip()),
            "configured": bool(os.getenv("KORYMB_WEBHOOK_URL", "").strip() or os.getenv("NOTIFICATION_WEBHOOK_URL", "").strip()),
            "note": "KORYMB_WEBHOOK_URL ou NOTIFICATION_WEBHOOK_URL — n8n/Zapier.",
        },
        "text_to_speech": {
            "ok": bool(
                os.getenv("ELEVENLABS_API_KEY", "").strip()
                or os.getenv("TTS_API_KEY", "").strip()
                or os.getenv("OPENAI_API_KEY", "").strip()
            ),
            "configured": bool(os.getenv("TTS_PROVIDER", "").strip() or os.getenv("ELEVENLABS_API_KEY", "").strip()),
            "note": "TTS_PROVIDER + clé (OpenAI ou ElevenLabs).",
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
