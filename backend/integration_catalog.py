"""
Catalogue des champs de configuration intégrations (clés .env / runtime).
Source unique pour l'API admin et la validation des surcharges.
"""
from __future__ import annotations

from typing import Any

# type: field = { key, label, secret?, placeholder?, hint? }
# type: group = { id, label, description?, fields }


def _secret(key: str) -> bool:
    k = key.upper()
    if k.endswith("_ID") or k.endswith("_BASE") or k.endswith("_MODEL") or k.endswith("_PROVIDER"):
        return False
    if k in {
        "SMTP_HOST",
        "SMTP_USER",
        "GOOGLE_CALENDAR_ID",
        "GOOGLE_OAUTH_TOKEN_ENDPOINT",
        "PAYPAL_API_BASE",
        "TTS_BASE_URL",
        "TTS_OUTPUT_DIR",
        "TTS_PROVIDER",
        "TTS_VOICE",
        "TTS_MODEL",
        "ELEVENLABS_MODEL",
        "IMAGE_GEN_BASE_URL",
        "CRM_PROVIDER",
        "BREVO_SENDER_NAME",
        "BREVO_SENDER_EMAIL",
    }:
        return False
    return any(x in k for x in ("_KEY", "_SECRET", "_TOKEN", "_PASS", "API_KEY"))


INTEGRATION_GROUPS: list[dict[str, Any]] = [
    {
        "id": "web_search",
        "label": "Recherche web",
        "description": "Chaîne Tavily → Brave → DuckDuckGo",
        "fields": [
            {"key": "TAVILY_API_KEY", "label": "Tavily API Key"},
            {"key": "BRAVE_SEARCH_API_KEY", "label": "Brave Search API Key"},
        ],
    },
    {
        "id": "meta_social",
        "label": "Meta — Instagram & Facebook",
        "description": "Publication, lecture et insights",
        "fields": [
            {"key": "INSTAGRAM_ACCESS_TOKEN", "label": "Instagram Access Token"},
            {"key": "INSTAGRAM_ACCOUNT_ID", "label": "Instagram Account ID", "secret": False},
            {"key": "FACEBOOK_ACCESS_TOKEN", "label": "Facebook Page Access Token"},
            {"key": "FACEBOOK_PAGE_ID", "label": "Facebook Page ID", "secret": False},
            {"key": "META_PAGE_ACCESS_TOKEN", "label": "Meta Page Token (webhooks / réponses)"},
            {"key": "META_WEBHOOK_VERIFY_TOKEN", "label": "Webhook Verify Token"},
        ],
    },
    {
        "id": "email",
        "label": "Email",
        "fields": [
            {"key": "SMTP_HOST", "label": "SMTP Host", "secret": False},
            {"key": "SMTP_USER", "label": "SMTP User", "secret": False},
            {"key": "SMTP_PASS", "label": "SMTP Password"},
        ],
    },
    {
        "id": "newsletter",
        "label": "Newsletter Brevo",
        "fields": [
            {"key": "BREVO_API_KEY", "label": "Brevo API Key"},
            {"key": "BREVO_DEFAULT_LIST_ID", "label": "Liste par défaut (ID)", "secret": False},
            {"key": "BREVO_SENDER_EMAIL", "label": "Email expéditeur", "secret": False},
            {"key": "BREVO_SENDER_NAME", "label": "Nom expéditeur", "secret": False},
        ],
    },
    {
        "id": "google_oauth",
        "label": "Google OAuth & API",
        "description": "Token partagé ou refresh OAuth pour Gmail, Drive, Calendar, Sheets",
        "fields": [
            {"key": "GOOGLE_API_ACCESS_TOKEN", "label": "Access Token (Bearer)"},
            {"key": "GOOGLE_OAUTH_REFRESH_TOKEN", "label": "Refresh Token"},
            {"key": "GOOGLE_OAUTH_CLIENT_ID", "label": "Client ID", "secret": False},
            {"key": "GOOGLE_OAUTH_CLIENT_SECRET", "label": "Client Secret"},
            {"key": "GOOGLE_OAUTH_TOKEN_ENDPOINT", "label": "Token Endpoint", "secret": False},
        ],
    },
    {
        "id": "google_drive",
        "label": "Google Drive",
        "fields": [
            {"key": "GOOGLE_DRIVE_ACCESS_TOKEN", "label": "Drive Access Token (optionnel)"},
            {"key": "GOOGLE_DRIVE_FOLDER_ID", "label": "Dossier cible (ID)", "secret": False},
        ],
    },
    {
        "id": "google_workspace",
        "label": "Gmail, Calendar, Sheets",
        "fields": [
            {"key": "GOOGLE_GMAIL_ACCESS_TOKEN", "label": "Gmail Token dédié (optionnel)"},
            {"key": "GOOGLE_CALENDAR_ACCESS_TOKEN", "label": "Calendar Token dédié (optionnel)"},
            {"key": "GOOGLE_SHEETS_ACCESS_TOKEN", "label": "Sheets Token dédié (optionnel)"},
            {"key": "GOOGLE_CALENDAR_ID", "label": "Calendar ID", "secret": False, "placeholder": "primary"},
            {"key": "GOOGLE_SHEETS_DEFAULT_ID", "label": "Spreadsheet ID par défaut", "secret": False},
        ],
    },
    {
        "id": "google_analytics",
        "label": "Google Analytics",
        "fields": [
            {"key": "GA_PROPERTY_ID", "label": "Property ID GA4", "secret": False},
            {"key": "GOOGLE_ANALYTICS_ACCESS_TOKEN", "label": "Analytics Token (optionnel)"},
        ],
    },
    {
        "id": "media_ai",
        "label": "Images & traduction",
        "fields": [
            {"key": "ANTHROPIC_API_KEY", "label": "Anthropic (Vision describe_image)"},
            {"key": "IMAGE_GEN_MODEL", "label": "Modèle génération image", "secret": False},
            {"key": "IMAGE_GEN_API_KEY", "label": "Clé génération image"},
            {"key": "IMAGE_GEN_BASE_URL", "label": "Base URL image API", "secret": False},
            {"key": "DEEPL_API_KEY", "label": "DeepL API Key"},
        ],
    },
    {
        "id": "youtube",
        "label": "YouTube",
        "fields": [
            {"key": "YOUTUBE_API_KEY", "label": "YouTube Data API Key"},
            {"key": "YOUTUBE_CHANNEL_ID", "label": "Channel ID", "secret": False},
        ],
    },
    {
        "id": "whatsapp",
        "label": "WhatsApp Business",
        "fields": [
            {"key": "WHATSAPP_ACCESS_TOKEN", "label": "Access Token"},
            {"key": "WHATSAPP_PHONE_NUMBER_ID", "label": "Phone Number ID", "secret": False},
        ],
    },
    {
        "id": "crm",
        "label": "CRM",
        "fields": [
            {"key": "CRM_PROVIDER", "label": "Provider (notion | hubspot)", "secret": False},
            {"key": "NOTION_API_KEY", "label": "Notion API Key"},
            {"key": "NOTION_CONTACTS_DATABASE_ID", "label": "Notion Database ID", "secret": False},
            {"key": "HUBSPOT_API_KEY", "label": "HubSpot API Key"},
        ],
    },
    {
        "id": "payments",
        "label": "Paiements",
        "fields": [
            {"key": "STRIPE_SECRET_KEY", "label": "Stripe Secret Key"},
            {"key": "PAYPAL_CLIENT_ID", "label": "PayPal Client ID", "secret": False},
            {"key": "PAYPAL_CLIENT_SECRET", "label": "PayPal Client Secret"},
            {"key": "PAYPAL_API_BASE", "label": "PayPal API Base URL", "secret": False},
        ],
    },
    {
        "id": "visual_social",
        "label": "Canva & Pinterest",
        "fields": [
            {"key": "CANVA_API_KEY", "label": "Canva API Key"},
            {"key": "CANVA_DEFAULT_TEMPLATE_ID", "label": "Template ID par défaut", "secret": False},
            {"key": "PINTEREST_ACCESS_TOKEN", "label": "Pinterest Access Token"},
            {"key": "PINTEREST_BOARD_ID", "label": "Board ID", "secret": False},
        ],
    },
    {
        "id": "messaging",
        "label": "Discord, Telegram & Webhooks",
        "fields": [
            {"key": "DISCORD_WEBHOOK_URL", "label": "Discord Webhook URL"},
            {"key": "DISCORD_BOT_TOKEN", "label": "Discord Bot Token"},
            {"key": "DISCORD_CHANNEL_ID", "label": "Discord Channel ID", "secret": False},
            {"key": "TELEGRAM_BOT_TOKEN", "label": "Telegram Bot Token"},
            {"key": "TELEGRAM_CHAT_ID", "label": "Telegram Chat ID", "secret": False},
            {"key": "KORYMB_WEBHOOK_URL", "label": "Webhook Korymb (sortant)"},
            {"key": "NOTIFICATION_WEBHOOK_URL", "label": "Webhook notifications"},
        ],
    },
    {
        "id": "tts",
        "label": "Synthèse vocale (TTS)",
        "fields": [
            {"key": "TTS_PROVIDER", "label": "Provider (openai | elevenlabs)", "secret": False},
            {"key": "TTS_API_KEY", "label": "TTS API Key"},
            {"key": "TTS_BASE_URL", "label": "TTS Base URL", "secret": False},
            {"key": "TTS_MODEL", "label": "Modèle TTS", "secret": False},
            {"key": "TTS_VOICE", "label": "Voix", "secret": False},
            {"key": "TTS_OUTPUT_DIR", "label": "Dossier sortie MP3", "secret": False},
            {"key": "ELEVENLABS_API_KEY", "label": "ElevenLabs API Key"},
            {"key": "ELEVENLABS_VOICE_ID", "label": "ElevenLabs Voice ID", "secret": False},
            {"key": "ELEVENLABS_MODEL", "label": "ElevenLabs Model", "secret": False},
            {"key": "OPENAI_API_KEY", "label": "OpenAI API Key (TTS fallback)"},
        ],
    },
    {
        "id": "fleur_db",
        "label": "Base Fleur d'ÅmÔurs (MySQL)",
        "description": "Connexion lecture seule pour le Comptable / Développeur",
        "fields": [
            {"key": "FLEUR_DB_HOST", "label": "Hôte", "secret": False},
            {"key": "FLEUR_DB_PORT", "label": "Port", "secret": False},
            {"key": "FLEUR_DB_USER", "label": "Utilisateur", "secret": False},
            {"key": "FLEUR_DB_PASSWORD", "label": "Mot de passe"},
            {"key": "FLEUR_DB_NAME", "label": "Base", "secret": False},
        ],
    },
]

for group in INTEGRATION_GROUPS:
    for field in group["fields"]:
        field.setdefault("secret", _secret(str(field["key"])))


def all_integration_keys() -> frozenset[str]:
    keys: set[str] = set()
    for group in INTEGRATION_GROUPS:
        for field in group["fields"]:
            keys.add(str(field["key"]))
    return frozenset(keys)


INTEGRATION_KEYS: frozenset[str] = all_integration_keys()
