"""
tools/registry_extended.py — Outils plateformes v3.3 (Google Workspace, réseaux, CRM, paiements…).
"""
from __future__ import annotations

from typing import Any, Callable

from tools.google_api import (
    run_append_google_sheet,
    run_create_calendar_event,
    run_create_google_sheet,
    run_get_analytics_report,
    run_list_calendar_events,
    run_list_gmail,
    run_send_gmail,
)
from tools.platforms import (
    run_create_canva_design,
    run_create_pinterest_pin,
    run_crm_create_contact,
    run_crm_search_contacts,
    run_fetch_social_comments,
    run_get_paypal_balance,
    run_get_stripe_revenue,
    run_get_youtube_channel_stats,
    run_list_pending_comment_replies,
    run_reply_social_comment,
    run_search_youtube,
    run_send_discord_message,
    run_send_telegram_message,
    run_send_whatsapp_message,
    run_text_to_speech,
    run_trigger_webhook,
)

EXTENDED_TAG_TO_TOOLS: dict[str, tuple[str, ...]] = {
    "google": (
        "send_gmail",
        "list_gmail",
        "create_calendar_event",
        "list_calendar_events",
        "append_google_sheet",
        "create_google_sheet",
        "get_analytics_report",
    ),
    "social_auto": (
        "fetch_social_comments",
        "reply_social_comment",
        "list_pending_comment_replies",
    ),
    "youtube": ("search_youtube", "get_youtube_channel_stats"),
    "whatsapp": ("send_whatsapp_message",),
    "crm": ("crm_create_contact", "crm_search_contacts"),
    "payments": ("get_stripe_revenue", "get_paypal_balance"),
    "canva": ("create_canva_design",),
    "pinterest": ("create_pinterest_pin",),
    "messaging": ("send_discord_message", "send_telegram_message", "trigger_webhook"),
    "cms": ("wordpress_create_post",),
}

EXTENDED_EXECUTE_GATED: frozenset[str] = frozenset({
    "send_gmail",
    "create_calendar_event",
    "reply_social_comment",
    "send_whatsapp_message",
    "crm_create_contact",
    "create_pinterest_pin",
    "send_discord_message",
    "send_telegram_message",
    "trigger_webhook",
    "wordpress_create_post",
})

EXTENDED_TOOL_SCHEMAS: list[dict[str, Any]] = [
    {
        "name": "send_gmail",
        "description": "Envoie un email via Gmail API (Google OAuth).",
        "input_schema": {
            "type": "object",
            "properties": {
                "to": {"type": "string"},
                "subject": {"type": "string"},
                "body": {"type": "string"},
            },
            "required": ["to", "subject", "body"],
        },
    },
    {
        "name": "list_gmail",
        "description": "Liste les emails Gmail récents (requête Gmail optionnelle).",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Filtre Gmail (ex: is:unread)"},
                "limit": {"type": "integer"},
            },
            "required": [],
        },
    },
    {
        "name": "create_calendar_event",
        "description": "Crée un événement Google Calendar (RDV, sessions).",
        "input_schema": {
            "type": "object",
            "properties": {
                "summary": {"type": "string"},
                "start_at": {"type": "string", "description": "ISO 8601 UTC"},
                "end_at": {"type": "string", "description": "ISO 8601 UTC"},
                "description": {"type": "string"},
                "attendees": {"type": "string", "description": "Emails séparés par des virgules"},
            },
            "required": ["summary", "start_at", "end_at"],
        },
    },
    {
        "name": "list_calendar_events",
        "description": "Liste les événements à venir dans Google Calendar.",
        "input_schema": {
            "type": "object",
            "properties": {"days_ahead": {"type": "integer"}},
            "required": [],
        },
    },
    {
        "name": "append_google_sheet",
        "description": "Ajoute des lignes à une Google Sheet (CSV par ligne).",
        "input_schema": {
            "type": "object",
            "properties": {
                "spreadsheet_id": {"type": "string"},
                "range_a1": {"type": "string", "description": "ex: Sheet1!A1"},
                "values_csv": {"type": "string", "description": "Lignes CSV, virgules entre colonnes"},
            },
            "required": ["values_csv"],
        },
    },
    {
        "name": "create_google_sheet",
        "description": "Crée une Google Sheet avec en-têtes et lignes optionnelles.",
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "headers_row": {"type": "string", "description": "Colonnes séparées par des virgules"},
                "rows_csv": {"type": "string"},
            },
            "required": ["title", "headers_row"],
        },
    },
    {
        "name": "get_analytics_report",
        "description": "Rapport Google Analytics (sessions, users, etc.) sur N jours.",
        "input_schema": {
            "type": "object",
            "properties": {
                "metric": {"type": "string", "description": "ex: sessions, activeUsers"},
                "period_days": {"type": "integer"},
            },
            "required": [],
        },
    },
    {
        "name": "fetch_social_comments",
        "description": "Récupère les commentaires récents Facebook ou Instagram.",
        "input_schema": {
            "type": "object",
            "properties": {
                "platform": {"type": "string", "description": "facebook | instagram"},
                "limit": {"type": "integer"},
            },
            "required": [],
        },
    },
    {
        "name": "reply_social_comment",
        "description": "Publie une réponse à un commentaire Meta (FB/IG).",
        "input_schema": {
            "type": "object",
            "properties": {
                "platform": {"type": "string"},
                "comment_id": {"type": "string"},
                "message": {"type": "string"},
            },
            "required": ["comment_id", "message"],
        },
    },
    {
        "name": "list_pending_comment_replies",
        "description": "Liste les réponses commentaires générées par webhook, en attente d'approbation.",
        "input_schema": {
            "type": "object",
            "properties": {"limit": {"type": "integer"}},
            "required": [],
        },
    },
    {
        "name": "search_youtube",
        "description": "Recherche de vidéos YouTube par mots-clés.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "limit": {"type": "integer"},
            },
            "required": ["query"],
        },
    },
    {
        "name": "get_youtube_channel_stats",
        "description": "Statistiques d'une chaîne YouTube (abonnés, vues).",
        "input_schema": {
            "type": "object",
            "properties": {"channel_id": {"type": "string"}},
            "required": [],
        },
    },
    {
        "name": "send_whatsapp_message",
        "description": "Envoie un message WhatsApp Business.",
        "input_schema": {
            "type": "object",
            "properties": {
                "to_phone": {"type": "string", "description": "Numéro international sans +"},
                "message": {"type": "string"},
            },
            "required": ["to_phone", "message"],
        },
    },
    {
        "name": "crm_create_contact",
        "description": "Crée un contact CRM (Notion ou HubSpot selon CRM_PROVIDER).",
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "email": {"type": "string"},
                "notes": {"type": "string"},
                "company": {"type": "string"},
            },
            "required": ["name"],
        },
    },
    {
        "name": "crm_search_contacts",
        "description": "Recherche des contacts dans le CRM configuré.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "limit": {"type": "integer"},
            },
            "required": ["query"],
        },
    },
    {
        "name": "get_stripe_revenue",
        "description": "Revenus nets Stripe sur une période (comptabilité).",
        "input_schema": {
            "type": "object",
            "properties": {"period_days": {"type": "integer"}},
            "required": [],
        },
    },
    {
        "name": "get_paypal_balance",
        "description": "Solde du compte PayPal.",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "create_canva_design",
        "description": "Génère un visuel brandé via Canva Autofill API.",
        "input_schema": {
            "type": "object",
            "properties": {
                "template_id": {"type": "string"},
                "title": {"type": "string"},
                "text_fields_json": {"type": "string", "description": "JSON des champs texte"},
            },
            "required": ["title"],
        },
    },
    {
        "name": "create_pinterest_pin",
        "description": "Crée une épingle Pinterest.",
        "input_schema": {
            "type": "object",
            "properties": {
                "board_id": {"type": "string"},
                "title": {"type": "string"},
                "description": {"type": "string"},
                "link": {"type": "string"},
                "image_url": {"type": "string"},
            },
            "required": ["title", "description", "image_url"],
        },
    },
    {
        "name": "send_discord_message",
        "description": "Envoie un message sur Discord (webhook ou bot).",
        "input_schema": {
            "type": "object",
            "properties": {
                "message": {"type": "string"},
                "webhook_url": {"type": "string"},
            },
            "required": ["message"],
        },
    },
    {
        "name": "send_telegram_message",
        "description": "Envoie un message Telegram.",
        "input_schema": {
            "type": "object",
            "properties": {
                "message": {"type": "string"},
                "chat_id": {"type": "string"},
            },
            "required": ["message"],
        },
    },
    {
        "name": "trigger_webhook",
        "description": "Déclenche un webhook HTTP (n8n, Zapier, Make…).",
        "input_schema": {
            "type": "object",
            "properties": {
                "url": {"type": "string"},
                "payload_json": {"type": "string"},
                "event_name": {"type": "string"},
            },
            "required": [],
        },
    },
    {
        "name": "text_to_speech",
        "description": "Convertit un texte en fichier audio MP3 (OpenAI TTS ou ElevenLabs).",
        "input_schema": {
            "type": "object",
            "properties": {
                "text": {"type": "string"},
                "voice": {"type": "string"},
            },
            "required": ["text"],
        },
    },
    {
        "name": "wordpress_create_post",
        "description": (
            "Prépare un article WordPress (brouillon). La publication réelle attend la validation dirigeant."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "content": {"type": "string", "description": "HTML ou texte de l'article"},
                "excerpt": {"type": "string"},
            },
            "required": ["title", "content"],
        },
    },
]


def _run_wp_create(inp: dict[str, Any]) -> str:
    from tools.wordpress import run_wordpress_create_post

    return run_wordpress_create_post(
        str(inp.get("title", "")),
        str(inp.get("content", "") or inp.get("html", "")),
        str(inp.get("excerpt", "") or ""),
        str(inp.get("status") or "draft"),
    )


def dispatch_extended_tool(name: str, inp: dict[str, Any]) -> str | None:
    handlers: dict[str, Callable[..., str]] = {
        "send_gmail": lambda: run_send_gmail(
            str(inp.get("to", "")), str(inp.get("subject", "")), str(inp.get("body", ""))
        ),
        "list_gmail": lambda: run_list_gmail(str(inp.get("query", "") or ""), int(inp.get("limit") or 10)),
        "create_calendar_event": lambda: run_create_calendar_event(
            str(inp.get("summary", "")),
            str(inp.get("start_at", "")),
            str(inp.get("end_at", "")),
            str(inp.get("description", "") or ""),
            str(inp.get("attendees", "") or ""),
        ),
        "list_calendar_events": lambda: run_list_calendar_events(int(inp.get("days_ahead") or 7)),
        "append_google_sheet": lambda: run_append_google_sheet(
            str(inp.get("spreadsheet_id", "") or ""),
            str(inp.get("range_a1", "") or "Sheet1!A1"),
            str(inp.get("values_csv", "")),
        ),
        "create_google_sheet": lambda: run_create_google_sheet(
            str(inp.get("title", "")),
            str(inp.get("headers_row", "")),
            str(inp.get("rows_csv", "") or ""),
        ),
        "get_analytics_report": lambda: run_get_analytics_report(
            str(inp.get("metric", "sessions") or "sessions"),
            int(inp.get("period_days") or 7),
        ),
        "fetch_social_comments": lambda: run_fetch_social_comments(
            str(inp.get("platform", "facebook") or "facebook"),
            int(inp.get("limit") or 10),
        ),
        "reply_social_comment": lambda: run_reply_social_comment(
            str(inp.get("platform", "facebook") or "facebook"),
            str(inp.get("comment_id", "")),
            str(inp.get("message", "")),
        ),
        "list_pending_comment_replies": lambda: run_list_pending_comment_replies(int(inp.get("limit") or 10)),
        "search_youtube": lambda: run_search_youtube(str(inp.get("query", "")), int(inp.get("limit") or 8)),
        "get_youtube_channel_stats": lambda: run_get_youtube_channel_stats(str(inp.get("channel_id", "") or "")),
        "send_whatsapp_message": lambda: run_send_whatsapp_message(
            str(inp.get("to_phone", "")), str(inp.get("message", ""))
        ),
        "crm_create_contact": lambda: run_crm_create_contact(
            str(inp.get("name", "")),
            str(inp.get("email", "") or ""),
            str(inp.get("notes", "") or ""),
            str(inp.get("company", "") or ""),
        ),
        "crm_search_contacts": lambda: run_crm_search_contacts(
            str(inp.get("query", "")), int(inp.get("limit") or 10)
        ),
        "get_stripe_revenue": lambda: run_get_stripe_revenue(int(inp.get("period_days") or 30)),
        "get_paypal_balance": lambda: run_get_paypal_balance(),
        "create_canva_design": lambda: run_create_canva_design(
            str(inp.get("template_id", "") or ""),
            str(inp.get("title", "")),
            str(inp.get("text_fields_json", "{}") or "{}"),
        ),
        "create_pinterest_pin": lambda: run_create_pinterest_pin(
            str(inp.get("board_id", "") or ""),
            str(inp.get("title", "")),
            str(inp.get("description", "")),
            str(inp.get("link", "") or ""),
            str(inp.get("image_url", "")),
        ),
        "send_discord_message": lambda: run_send_discord_message(
            str(inp.get("message", "")), str(inp.get("webhook_url", "") or "")
        ),
        "send_telegram_message": lambda: run_send_telegram_message(
            str(inp.get("message", "")), str(inp.get("chat_id", "") or "")
        ),
        "trigger_webhook": lambda: run_trigger_webhook(
            str(inp.get("url", "") or ""),
            str(inp.get("payload_json", "{}") or "{}"),
            str(inp.get("event_name", "korymb_event") or "korymb_event"),
        ),
        "text_to_speech": lambda: run_text_to_speech(
            str(inp.get("text", "")), str(inp.get("voice", "") or "")
        ),
        "wordpress_create_post": lambda: _run_wp_create(inp),
    }
    fn = handlers.get(name)
    if fn is None:
        return None
    return fn()
