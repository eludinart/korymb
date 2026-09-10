"""
Sonde santé unique Korymb — source de vérité pour /health/tools et /admin/system-health.

Règle : si des clés sont présentes, une sonde live (quand c’est possible) décide de ok.
Cache ~2 min pour éviter de marteler les APIs.
"""
from __future__ import annotations

import socket
import time
from datetime import datetime, timezone
from typing import Any

from env_loader import load_backend_env

load_backend_env()

from integration_settings import getenv as integ_getenv
from tools import run_read_webpage, run_web_search

_CACHE: dict[str, Any] = {"t": 0.0, "ttl_s": 120, "payload": None}


def _env(name: str) -> str:
    return str(integ_getenv(name) or "").strip()


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


def _graph_error_detail(payload: dict) -> str:
    err = payload.get("error") if isinstance(payload, dict) else None
    if isinstance(err, dict):
        msg = str(err.get("message") or err.get("type") or "").strip()
        if msg:
            return msg[:180]
    return ""


def _row(
    *,
    configured: bool,
    ok: bool | None = None,
    note: str = "",
    probe_detail: str | None = None,
    **extra: Any,
) -> dict[str, Any]:
    out: dict[str, Any] = {"configured": bool(configured), "note": note}
    if ok is not None:
        out["ok"] = bool(ok)
    if probe_detail:
        out["probe_detail"] = str(probe_detail)[:220]
    out.update(extra)
    return out


def _probe_facebook_graph() -> tuple[bool, str]:
    token = _env("FACEBOOK_ACCESS_TOKEN") or _env("META_PAGE_ACCESS_TOKEN")
    page_id = _env("FACEBOOK_PAGE_ID")
    if not token or not page_id:
        return False, "FACEBOOK_ACCESS_TOKEN + FACEBOOK_PAGE_ID requis."
    if not page_id.isdigit():
        return False, "FACEBOOK_PAGE_ID invalide (attendu : chiffres uniquement, id de page)."
    try:
        import httpx

        r = httpx.get(
            f"https://graph.facebook.com/v19.0/{page_id}",
            params={"fields": "id,name", "access_token": token},
            timeout=12,
        )
        data = r.json() if r.content else {}
        if r.status_code == 200 and str((data or {}).get("id") or "").strip():
            name = str((data or {}).get("name") or "OK").strip()
            return True, f"Page OK ({name})"
        return False, _graph_error_detail(data) or f"HTTP {r.status_code}"
    except Exception as exc:
        return False, str(exc)[:160]


def _probe_instagram_graph() -> tuple[bool, str]:
    token = _env("INSTAGRAM_ACCESS_TOKEN") or _env("FACEBOOK_ACCESS_TOKEN") or _env("META_PAGE_ACCESS_TOKEN")
    ig_id = _env("INSTAGRAM_ACCOUNT_ID")
    if not token or not ig_id:
        return False, "INSTAGRAM_ACCESS_TOKEN + INSTAGRAM_ACCOUNT_ID requis."
    if not ig_id.isdigit():
        return False, "INSTAGRAM_ACCOUNT_ID invalide (attendu : chiffres)."
    try:
        import httpx

        r = httpx.get(
            f"https://graph.facebook.com/v19.0/{ig_id}",
            params={"fields": "id,username", "access_token": token},
            timeout=12,
        )
        data = r.json() if r.content else {}
        if r.status_code == 200 and str((data or {}).get("id") or "").strip():
            user = str((data or {}).get("username") or "OK").strip()
            return True, f"Compte OK (@{user})" if user != "OK" else "Compte OK"
        return False, _graph_error_detail(data) or f"HTTP {r.status_code}"
    except Exception as exc:
        return False, str(exc)[:160]


def _probe_smtp() -> tuple[bool, str]:
    host = _env("SMTP_HOST")
    if not host:
        return False, "SMTP_HOST manquant."
    last = ""
    for port in (465, 587):
        try:
            with socket.create_connection((host, port), timeout=2.5):
                return True, f"reachable:{port}"
        except Exception as exc:
            last = str(exc)[:120]
    return False, last or "SMTP injoignable"


def _probe_wordpress() -> tuple[bool, str]:
    base = _env("WP_BASE_URL").rstrip("/")
    user = _env("WP_USER")
    password = _env("WP_APP_PASSWORD")
    if not base:
        return False, "WP_BASE_URL manquant."
    if not user or not password:
        return False, "WP_USER + WP_APP_PASSWORD requis."
    try:
        import httpx

        r = httpx.get(
            f"{base}/wp-json/wp/v2/users/me",
            auth=(user, password.replace(" ", "")),
            timeout=12,
            follow_redirects=True,
        )
        if r.status_code == 200:
            body = r.json() if r.content else {}
            name = str((body or {}).get("name") or (body or {}).get("slug") or "OK")
            return True, f"Auth OK ({name})"
        if r.status_code in (401, 403):
            return False, f"Auth WordPress refusée (HTTP {r.status_code}) — mot de passe d’application ou URL HTTPS."
        return False, f"HTTP {r.status_code}"
    except Exception as exc:
        return False, str(exc)[:160]


def _probe_google_drive() -> tuple[bool, str]:
    try:
        import httpx
        from tools import _get_google_drive_token

        token = _get_google_drive_token()
        if not token:
            return False, "Aucun token Drive disponible."
        r = httpx.get(
            "https://www.googleapis.com/drive/v3/about",
            params={"fields": "user(displayName)"},
            headers={"Authorization": f"Bearer {token}"},
            timeout=12,
        )
        if r.status_code == 200:
            name = (r.json().get("user") or {}).get("displayName") or "OK"
            return True, f"Token valide ({name})"
        try:
            msg = str(((r.json() or {}).get("error") or {}).get("message") or "")
        except Exception:
            msg = ""
        return False, (msg or f"HTTP {r.status_code}")[:160]
    except Exception as exc:
        return False, str(exc)[:160]


def _probe_crm() -> tuple[bool, bool, str]:
    provider = _env("CRM_PROVIDER").lower()
    if not provider:
        return False, False, ""
    if provider == "notion":
        if not _env("NOTION_API_KEY"):
            return True, False, "CRM_PROVIDER=notion sans NOTION_API_KEY."
        return True, True, "notion"
    if provider == "hubspot":
        if not _env("HUBSPOT_API_KEY"):
            return True, False, "CRM_PROVIDER=hubspot sans HUBSPOT_API_KEY."
        return True, True, "hubspot"
    return True, False, f"CRM_PROVIDER inconnu ({provider})."


def probe_tools_health(*, force: bool = False) -> dict[str, Any]:
    """Sonde unique (cache ~2 min) — utilisée par /health/tools et /admin/system-health."""
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

    checked = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    q = "korymb connectivity test"
    test_url = "https://example.com"

    ws_raw = run_web_search(q)
    ws_ok = not _web_search_failed(ws_raw)
    ws_provider = _detect_web_provider(ws_raw) if ws_ok else "none"

    rw_raw = run_read_webpage(test_url)
    rw_ok = not _read_webpage_failed(rw_raw)
    rw_provider = _detect_read_provider(rw_raw) if rw_ok else "none"

    has_tavily = bool(_env("TAVILY_API_KEY"))
    has_brave = bool(_env("BRAVE_SEARCH_API_KEY"))
    has_anthropic = bool(_env("ANTHROPIC_API_KEY"))
    has_ig_keys = bool(_env("INSTAGRAM_ACCESS_TOKEN") and _env("INSTAGRAM_ACCOUNT_ID"))
    has_fb_keys = bool(_env("FACEBOOK_ACCESS_TOKEN") and _env("FACEBOOK_PAGE_ID"))
    fb_ok, fb_detail = (_probe_facebook_graph() if has_fb_keys else (False, ""))
    ig_ok, ig_detail = (_probe_instagram_graph() if has_ig_keys else (False, ""))

    has_drive_keys = bool(
        _env("GOOGLE_DRIVE_ACCESS_TOKEN")
        or _env("GOOGLE_API_ACCESS_TOKEN")
        or (_env("GOOGLE_OAUTH_REFRESH_TOKEN") and _env("GOOGLE_OAUTH_CLIENT_ID"))
    )
    drive_folder = bool(_env("GOOGLE_DRIVE_FOLDER_ID"))
    drive_ok, drive_detail = (_probe_google_drive() if has_drive_keys else (False, ""))

    has_smtp_keys = bool(_env("SMTP_HOST") and _env("SMTP_USER") and _env("SMTP_PASS"))
    smtp_ok, smtp_detail = (_probe_smtp() if has_smtp_keys else (False, ""))

    wp_configured = bool(_env("WP_BASE_URL"))
    has_wp_keys = bool(_env("WP_BASE_URL") and _env("WP_USER") and _env("WP_APP_PASSWORD"))
    wp_ok, wp_detail = (
        _probe_wordpress()
        if has_wp_keys
        else (False, "WP_USER + WP_APP_PASSWORD manquants." if wp_configured else "")
    )

    crm_configured, crm_ok, crm_detail = _probe_crm()
    has_brevo = bool(_env("BREVO_API_KEY"))
    has_deepl = bool(_env("DEEPL_API_KEY"))

    try:
        from tools.media_engines import catalog_status as _media_status

        _media = _media_status()
        _media_ready = _media.get("ready") if isinstance(_media.get("ready"), dict) else {}
        has_image_gen = bool(_media_ready.get("image"))
        has_tts = bool(_media_ready.get("tts"))
        has_video = bool(_media_ready.get("video"))
        image_note = "Clé Mistral (Flux) — Pollinations en repli."
        tts_note = "Chaîne voix : Edge TTS → Pollinations → OpenAI → ElevenLabs."
        video_note = "Storyboard Mistral / Pollinations ; clip si Replicate / fal / Runway."
    except Exception:
        has_image_gen = bool(_env("MISTRAL_API_KEY"))
        has_tts = bool(_env("ELEVENLABS_API_KEY") or _env("TTS_API_KEY") or _env("OPENAI_API_KEY"))
        has_video = bool(
            _env("REPLICATE_API_TOKEN")
            or _env("FAL_KEY")
            or _env("RUNWAY_API_KEY")
            or _env("VIDEO_GEN_API_KEY")
            or _env("MISTRAL_API_KEY")
        )
        image_note = "Clé Mistral ou IMAGE_GEN / OpenRouter."
        tts_note = "TTS_PROVIDER + clé."
        video_note = "Storyboard Mistral ou VIDEO_GEN_PROVIDER + clé."

    has_google_oauth = bool(
        _env("GOOGLE_API_ACCESS_TOKEN")
        or (
            _env("GOOGLE_OAUTH_REFRESH_TOKEN")
            and _env("GOOGLE_OAUTH_CLIENT_ID")
            and _env("GOOGLE_OAUTH_CLIENT_SECRET")
        )
    )

    payload: dict[str, Any] = {
        "checked_at": checked,
        "cached": False,
        "cache_ttl_s": int(_CACHE["ttl_s"] or 120),
        "web_search": {
            "ok": ws_ok,
            "provider": ws_provider,
            "providers_configured": {"tavily": has_tavily, "brave": has_brave, "duckduckgo": True},
            "probe_query": q,
            "message": None if ws_ok else (ws_raw[:400] + ("…" if len(ws_raw) > 400 else "")),
        },
        "read_webpage": {
            "ok": rw_ok,
            "provider": rw_provider,
            "jina_available": True,
            "probe_url": test_url,
            "probe_url_note": "example.com — page HTML stable",
            "message": None if rw_ok else (rw_raw[:400] + ("…" if len(rw_raw) > 400 else "")),
        },
        "search_linkedin": {
            "ok": ws_ok,
            "note": "Même provider que web_search (site:linkedin.com).",
        },
        "describe_image": _row(configured=has_anthropic, ok=has_anthropic, note="Claude Haiku Vision."),
        "instagram": _row(
            configured=has_ig_keys,
            ok=ig_ok,
            probe_detail=ig_detail or None,
            note="INSTAGRAM_ACCESS_TOKEN + ACCOUNT_ID.",
        ),
        "facebook": _row(
            configured=has_fb_keys,
            ok=fb_ok,
            probe_detail=fb_detail or None,
            note="FACEBOOK_ACCESS_TOKEN + PAGE_ID numérique.",
        ),
        "google_drive": _row(
            configured=has_drive_keys,
            ok=bool(drive_ok and drive_folder),
            reachable=drive_ok,
            folder_id_set=drive_folder,
            probe_detail=drive_detail
            or ("GOOGLE_DRIVE_FOLDER_ID manquant." if drive_ok and not drive_folder else None),
            note="OAuth / token Drive + dossier.",
        ),
        "send_email": _row(
            configured=has_smtp_keys,
            ok=smtp_ok,
            reachable=smtp_ok,
            probe_detail=smtp_detail or None,
            note="SMTP_HOST + USER + PASS.",
        ),
        "send_newsletter": _row(configured=has_brevo, ok=has_brevo, note="BREVO_API_KEY."),
        "generate_image": _row(configured=has_image_gen, ok=has_image_gen, note=image_note),
        "read_pdf": _row(configured=True, ok=True, note="PDF via pypdf — sans clé."),
        "monitor_rss": _row(configured=True, ok=True, note="RSS/Atom via feedparser — sans clé."),
        "translate_text": _row(configured=has_deepl, ok=has_deepl, note="DEEPL_API_KEY."),
        "get_instagram_insights": _row(configured=has_ig_keys, ok=ig_ok, note="Métriques IG."),
        "get_facebook_insights": _row(configured=has_fb_keys, ok=fb_ok, note="Métriques page FB."),
        "schedule_social": _row(configured=has_ig_keys or has_fb_keys, ok=ig_ok or fb_ok, note="Tokens Meta."),
        "gmail": _row(
            configured=bool(_env("GOOGLE_GMAIL_ACCESS_TOKEN") or has_google_oauth),
            ok=bool(_env("GOOGLE_GMAIL_ACCESS_TOKEN") or (has_google_oauth and drive_ok)),
            note="Gmail — token dédié ou OAuth Google.",
        ),
        "google_calendar": _row(
            configured=bool(_env("GOOGLE_CALENDAR_ACCESS_TOKEN") or has_google_oauth),
            ok=bool(_env("GOOGLE_CALENDAR_ACCESS_TOKEN") or (has_google_oauth and drive_ok)),
            note="Calendar — token dédié ou OAuth Google.",
        ),
        "google_sheets": _row(
            configured=bool(_env("GOOGLE_SHEETS_ACCESS_TOKEN") or has_google_oauth),
            ok=bool(_env("GOOGLE_SHEETS_ACCESS_TOKEN") or (has_google_oauth and drive_ok)),
            note="Sheets — token dédié ou OAuth Google.",
        ),
        "google_analytics": _row(
            configured=bool(_env("GA_PROPERTY_ID")),
            ok=bool(_env("GA_PROPERTY_ID")),
            note="GA_PROPERTY_ID.",
        ),
        "meta_webhooks": _row(
            configured=bool(_env("META_WEBHOOK_VERIFY_TOKEN")),
            ok=bool(
                _env("META_WEBHOOK_VERIFY_TOKEN")
                and (_env("META_PAGE_ACCESS_TOKEN") or _env("FACEBOOK_ACCESS_TOKEN"))
            ),
            note="VERIFY_TOKEN + token page.",
        ),
        "youtube": _row(configured=bool(_env("YOUTUBE_API_KEY")), ok=bool(_env("YOUTUBE_API_KEY")), note="YOUTUBE_API_KEY."),
        "whatsapp": _row(
            configured=bool(_env("WHATSAPP_ACCESS_TOKEN") and _env("WHATSAPP_PHONE_NUMBER_ID")),
            ok=bool(_env("WHATSAPP_ACCESS_TOKEN") and _env("WHATSAPP_PHONE_NUMBER_ID")),
            note="WhatsApp Cloud API.",
        ),
        "crm": _row(configured=crm_configured, ok=crm_ok, probe_detail=crm_detail or None, note="notion|hubspot + clé."),
        "stripe": _row(configured=bool(_env("STRIPE_SECRET_KEY")), ok=bool(_env("STRIPE_SECRET_KEY")), note="STRIPE_SECRET_KEY."),
        "paypal": _row(
            configured=bool(_env("PAYPAL_CLIENT_ID") and _env("PAYPAL_CLIENT_SECRET")),
            ok=bool(_env("PAYPAL_CLIENT_ID") and _env("PAYPAL_CLIENT_SECRET")),
            note="PAYPAL_CLIENT_ID + SECRET.",
        ),
        "canva": _row(configured=bool(_env("CANVA_API_KEY")), ok=bool(_env("CANVA_API_KEY")), note="CANVA_API_KEY."),
        "pinterest": _row(
            configured=bool(_env("PINTEREST_ACCESS_TOKEN")),
            ok=bool(_env("PINTEREST_ACCESS_TOKEN") and _env("PINTEREST_BOARD_ID")),
            note="PINTEREST_ACCESS_TOKEN + BOARD_ID.",
        ),
        "discord": _row(
            configured=bool(_env("DISCORD_WEBHOOK_URL") or _env("DISCORD_BOT_TOKEN")),
            ok=bool(_env("DISCORD_WEBHOOK_URL") or _env("DISCORD_BOT_TOKEN")),
            note="Webhook ou bot Discord.",
        ),
        "telegram": _row(
            configured=bool(_env("TELEGRAM_BOT_TOKEN") or _env("TELEGRAM_HITL_BOT_TOKEN")),
            ok=bool(_env("TELEGRAM_BOT_TOKEN") and _env("TELEGRAM_CHAT_ID")),
            note="Bot + CHAT_ID (HITL optionnel).",
        ),
        "wordpress": _row(
            configured=wp_configured,
            ok=wp_ok,
            probe_detail=wp_detail or None,
            note="WP_BASE_URL + USER + APP_PASSWORD.",
        ),
        "webhook": _row(
            configured=bool(_env("KORYMB_WEBHOOK_URL") or _env("NOTIFICATION_WEBHOOK_URL")),
            ok=bool(_env("KORYMB_WEBHOOK_URL") or _env("NOTIFICATION_WEBHOOK_URL")),
            note="Webhook sortant n8n/Zapier/Make.",
        ),
        "text_to_speech": _row(configured=has_tts, ok=has_tts, note=tts_note),
        "create_branded_pdf": _row(configured=True, ok=True, note="PDF brandé fpdf2 — sans clé."),
        "generate_video": _row(configured=has_video, ok=has_video, note=video_note),
        "post_linkedin": _row(
            configured=bool(
                _env("LINKEDIN_ACCESS_TOKEN")
                or (_env("LINKEDIN_CLIENT_ID") and _env("LINKEDIN_CLIENT_SECRET"))
            ),
            ok=bool(_env("LINKEDIN_ACCESS_TOKEN") and _env("LINKEDIN_AUTHOR_URN")),
            probe_detail=(
                None
                if (_env("LINKEDIN_ACCESS_TOKEN") and _env("LINKEDIN_AUTHOR_URN"))
                else (
                    "App OAuth présente — Connecter LinkedIn pour le token."
                    if _env("LINKEDIN_CLIENT_ID")
                    else None
                )
            ),
            note="ACCESS_TOKEN + AUTHOR_URN après OAuth.",
        ),
        "tavily": _row(configured=has_tavily, ok=has_tavily, note="Tavily AI Search."),
        "brave_search": _row(configured=has_brave, ok=has_brave, note="Brave Search."),
        "jina_reader": _row(configured=True, ok=rw_ok, note="r.jina.ai — sans clé."),
        "google_oauth": _row(
            configured=has_google_oauth,
            ok=bool(has_google_oauth and drive_ok),
            probe_detail=drive_detail if has_google_oauth else None,
            note="Client ID/Secret + refresh Google.",
        ),
        "web_tools": _row(
            configured=True,
            ok=ws_ok,
            active_provider=ws_provider,
            providers_configured={"tavily": has_tavily, "brave": has_brave, "duckduckgo": True},
            note="Chaîne recherche web.",
        ),
    }

    # Alias historiques (UI / mapping system-health)
    payload["smtp"] = dict(payload["send_email"])
    payload["brevo"] = dict(payload["send_newsletter"])
    payload["deepl"] = dict(payload["translate_text"])
    payload["image_gen"] = dict(payload["generate_image"])
    payload["korymb_webhook"] = dict(payload["webhook"])

    _CACHE["t"] = now
    _CACHE["payload"] = payload
    return dict(payload)


def integrations_from_tools_probe(
    tools_probe: dict[str, Any],
    *,
    llm_cfg: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Vue intégrations dérivée de la sonde unique — plus de logique parallèle dans core_health."""
    cfg = llm_cfg or {}
    tp = tools_probe or {}

    def take(key: str) -> dict[str, Any]:
        row = dict(tp.get(key) or {})
        if "configured" not in row:
            row["configured"] = bool(row.get("ok"))
        return row

    status: dict[str, Any] = {
        "llm_mistral": {
            "configured": bool(_env("MISTRAL_API_KEY")),
            "provider_selected": str(cfg.get("llm_provider") or "") == "mistral",
        },
        "llm_openrouter": {
            "configured": bool(_env("OPENROUTER_API_KEY")),
            "provider_selected": str(cfg.get("llm_provider") or "") == "openrouter",
        },
        "llm_anthropic": {
            "configured": bool(_env("ANTHROPIC_API_KEY")),
            "provider_selected": str(cfg.get("llm_provider") or "") == "anthropic",
        },
        "google_oauth": take("google_oauth"),
        "google_drive": take("google_drive"),
        "facebook": take("facebook"),
        "instagram": take("instagram"),
        "smtp": take("send_email"),
        "tavily": take("tavily"),
        "brave_search": take("brave_search"),
        "jina_reader": take("jina_reader"),
        "brevo": take("send_newsletter"),
        "deepl": take("translate_text"),
        "image_gen": take("generate_image"),
        "gmail": take("gmail"),
        "google_calendar": take("google_calendar"),
        "google_sheets": take("google_sheets"),
        "google_analytics": take("google_analytics"),
        "meta_webhooks": take("meta_webhooks"),
        "youtube": take("youtube"),
        "whatsapp": take("whatsapp"),
        "crm": take("crm"),
        "stripe": take("stripe"),
        "paypal": take("paypal"),
        "canva": take("canva"),
        "pinterest": take("pinterest"),
        "discord": take("discord"),
        "telegram": take("telegram"),
        "wordpress": take("wordpress"),
        "korymb_webhook": take("webhook"),
        "text_to_speech": take("text_to_speech"),
        "web_tools": take("web_tools"),
        "post_linkedin": take("post_linkedin"),
    }

    fleur_cfg = bool(_env("FLEUR_DB_HOST") and _env("FLEUR_DB_USER"))
    fleur_ok = False
    fleur_detail = ""
    if fleur_cfg:
        try:
            from db_fleur import _get_conn  # type: ignore

            with _get_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT 1 AS ok")
                    _ = cur.fetchone()
            fleur_ok = True
        except Exception as exc:
            fleur_detail = str(exc)[:180]
    status["fleur_db"] = _row(
        configured=fleur_cfg,
        ok=fleur_ok if fleur_cfg else None,
        reachable=fleur_ok if fleur_cfg else None,
        probe_detail=fleur_detail or None,
        note="Base Fleur (MySQL).",
    )

    for llm_id in ("llm_mistral", "llm_openrouter", "llm_anthropic"):
        row = status[llm_id]
        if row.get("provider_selected"):
            row["ok"] = bool(row.get("configured"))

    configured = sum(1 for v in status.values() if bool(v.get("configured")))
    reachable = sum(1 for v in status.values() if bool(v.get("ok")) or bool(v.get("reachable")))
    return {
        "integrations": status,
        "tools_probe": tp,
        "summary": {
            "configured_count": configured,
            "reachable_count": reachable,
            "total_integrations": len(status),
        },
    }


def tools_reachable_summary(data: dict[str, Any] | None) -> tuple[bool, str]:
    if not isinstance(data, dict):
        return False, "Pas de données de santé."
    ws = data.get("web_search") or {}
    rw = data.get("read_webpage") or {}
    ok = bool(ws.get("ok")) and bool(rw.get("ok"))
    if ok:
        return True, f"Recherche web ({ws.get('provider', '?')}) et lecture ({rw.get('provider', '?')}) OK."
    parts = []
    if not ws.get("ok"):
        parts.append("recherche web")
    if not rw.get("ok"):
        parts.append("lecture de page")
    return False, ", ".join(parts) + " : problème signalé."
