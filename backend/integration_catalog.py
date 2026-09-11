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
        "TIIME_MAKE_WEBHOOK_URL",
        "TIIME_WEBHOOK_URL",
        "WP_BASE_URL",
        "WP_USER",
        "TELEGRAM_CHAT_ID",
        "KORYMB_PUBLIC_URL",
        "VIDEO_GEN_PROVIDER",
        "VIDEO_GEN_MODEL",
        "LINKEDIN_AUTHOR_URN",
        "ELEVENLABS_VOICE_ID",
        "MEDIA_ENGINE_MODE",
        "IMAGE_ENGINE_CHAIN",
        "IMAGE_FREE_ENGINE",
        "IMAGE_FREE_BASE_URL",
        "POLLINATIONS_IMAGE_MODEL",
        "IMAGE_HF_MODEL",
        "TTS_ENGINE_CHAIN",
        "TTS_FREE_ENGINE",
        "EDGE_TTS_VOICE",
        "TTS_FREE_BASE_URL",
        "VIDEO_ENGINE_CHAIN",
        "VIDEO_HF_MODEL",
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
            {
                "key": "FACEBOOK_PAGE_ID",
                "label": "Facebook Page ID",
                "secret": False,
                "hint": "Chiffres uniquement (Paramètres de la page → À propos). Pas un jeton.",
            },
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
        "label": "Google Workspace",
        "description": "Un clic pour Gmail, Drive, Calendar et Sheets",
        "oauth": "google",
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
        "priority": True,
        "fields": [
            {"key": "GOOGLE_GMAIL_ACCESS_TOKEN", "label": "Gmail Token dédié (optionnel)"},
            {"key": "GOOGLE_CALENDAR_ACCESS_TOKEN", "label": "Calendar Token dédié (optionnel)"},
            {"key": "GOOGLE_SHEETS_ACCESS_TOKEN", "label": "Sheets Token dédié (optionnel)"},
            {"key": "GOOGLE_CALENDAR_ID", "label": "Calendar ID", "secret": False, "placeholder": "primary"},
            {"key": "GOOGLE_SHEETS_DEFAULT_ID", "label": "Spreadsheet ID par défaut", "secret": False},
        ],
    },
    {
        "id": "wordpress",
        "label": "WordPress (CMS)",
        "description": "Publication d'articles via REST API (Application Password). Brouillon à la préparation, publish après validation.",
        "fields": [
            {"key": "WP_BASE_URL", "label": "URL du site", "secret": False, "placeholder": "https://www.exemple.fr"},
            {"key": "WP_USER", "label": "Utilisateur WP", "secret": False},
            {"key": "WP_APP_PASSWORD", "label": "Application Password"},
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
        "label": "Images",
        "description": "Studio : mode Économique sans clé, Qualité avec OpenRouter. Chaînes en Options avancées.",
        "fields": [
            {
                "key": "MEDIA_ENGINE_MODE",
                "label": "Mode Studio (economy | quality)",
                "secret": False,
                "placeholder": "economy",
                "hint": "economy = Mistral puis gratuit. quality = Mistral puis OpenRouter.",
            },
            {
                "key": "IMAGE_ENGINE_CHAIN",
                "label": "Chaîne image (mistral,pollinations,huggingface,openrouter)",
                "secret": False,
                "placeholder": "mistral,pollinations,huggingface,openrouter",
            },
            {
                "key": "IMAGE_FREE_ENGINE",
                "label": "Moteur image gratuit (1 = Pollinations actif)",
                "secret": False,
                "placeholder": "1",
            },
            {
                "key": "IMAGE_FREE_BASE_URL",
                "label": "URL image gratuite",
                "secret": False,
                "placeholder": "https://image.pollinations.ai/prompt",
            },
            {"key": "POLLINATIONS_API_KEY", "label": "Clé Pollinations (optionnelle)"},
            {
                "key": "POLLINATIONS_IMAGE_MODEL",
                "label": "Modèle Pollinations (optionnel)",
                "secret": False,
            },
            {"key": "HUGGINGFACE_API_TOKEN", "label": "Jeton Hugging Face (image / vidéo)"},
            {
                "key": "IMAGE_HF_MODEL",
                "label": "Modèle Hugging Face image",
                "secret": False,
            },
            {"key": "ANTHROPIC_API_KEY", "label": "Anthropic (Vision describe_image)"},
            {"key": "IMAGE_GEN_MODEL", "label": "Modèle génération image payant", "secret": False},
            {"key": "IMAGE_GEN_API_KEY", "label": "Clé génération image (OpenRouter / DALL·E)"},
            {"key": "IMAGE_GEN_BASE_URL", "label": "Base URL image API payante", "secret": False},
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
        "id": "tiime",
        "label": "Tiime — facturation électronique",
        "description": "Factures légales via Tiime (PA). Devis dans Korymb ; émission facture dans Tiime ou via Make (offre Business).",
        "fields": [
            {
                "key": "TIIME_MAKE_WEBHOOK_URL",
                "label": "Webhook Make/Tiime (URL)",
                "secret": False,
                "hint": "Scénario Make : module Tiime Apps — création facture depuis devis Korymb",
            },
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
            {"key": "TELEGRAM_BOT_TOKEN", "label": "Telegram Bot Token (Hermes — ne pas webhooker)"},
            {"key": "TELEGRAM_CHAT_ID", "label": "Telegram Chat ID", "secret": False},
            {"key": "TELEGRAM_HITL_BOT_TOKEN", "label": "Bot HITL dédié (boutons Valider/Rejeter)"},
            {"key": "TELEGRAM_WEBHOOK_SECRET", "label": "Secret webhook HITL"},
            {"key": "KORYMB_PUBLIC_URL", "label": "URL publique Korymb", "secret": False, "placeholder": "https://app.exemple.fr"},
            {"key": "KORYMB_WEBHOOK_URL", "label": "Webhook Korymb (sortant)"},
            {"key": "NOTIFICATION_WEBHOOK_URL", "label": "Webhook notifications"},
        ],
    },
    {
        "id": "tts",
        "label": "Synthèse vocale (TTS)",
        "description": "Chaîne Edge TTS (gratuit) → Pollinations → OpenAI → ElevenLabs.",
        "fields": [
            {
                "key": "TTS_ENGINE_CHAIN",
                "label": "Chaîne voix (edge,pollinations,openai,elevenlabs)",
                "secret": False,
                "placeholder": "edge,pollinations,openai,elevenlabs",
            },
            {
                "key": "TTS_FREE_ENGINE",
                "label": "Moteur voix gratuit (1 = Edge / Pollinations)",
                "secret": False,
                "placeholder": "1",
            },
            {
                "key": "EDGE_TTS_VOICE",
                "label": "Voix Edge TTS",
                "secret": False,
                "placeholder": "fr-FR-DeniseNeural",
            },
            {
                "key": "TTS_FREE_BASE_URL",
                "label": "URL TTS gratuite (Pollinations)",
                "secret": False,
            },
            {"key": "TTS_PROVIDER", "label": "Provider préféré (openai | elevenlabs | edge)", "secret": False},
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
        "id": "linkedin_publish",
        "label": "LinkedIn",
        "description": "Publier des posts depuis le Studio. Un clic Connecter LinkedIn après Client ID / Secret.",
        "oauth": "linkedin",
        "fields": [
            {"key": "LINKEDIN_CLIENT_ID", "label": "Client ID (app LinkedIn)", "secret": False},
            {"key": "LINKEDIN_CLIENT_SECRET", "label": "Client Secret"},
            {"key": "LINKEDIN_ACCESS_TOKEN", "label": "Access Token (w_member_social)"},
            {
                "key": "LINKEDIN_AUTHOR_URN",
                "label": "URN auteur",
                "secret": False,
                "placeholder": "urn:li:person:…",
            },
        ],
    },
    {
        "id": "video_gen",
        "label": "Vidéo IA (storyboard + clip)",
        "description": "Sans clé : storyboard d’images. Clip MP4 : clé Replicate (Kling) ou fal.ai, collée ci-dessous.",
        "fields": [
            {
                "key": "VIDEO_ENGINE_CHAIN",
                "label": "Chaîne vidéo (huggingface,replicate,fal,runway,storyboard)",
                "secret": False,
                "placeholder": "huggingface,replicate,fal,runway,storyboard",
            },
            {
                "key": "VIDEO_HF_MODEL",
                "label": "Modèle Hugging Face vidéo (optionnel)",
                "secret": False,
            },
            {
                "key": "VIDEO_GEN_PROVIDER",
                "label": "Provider préféré (replicate | fal | runway)",
                "secret": False,
                "placeholder": "replicate",
            },
            {
                "key": "VIDEO_GEN_MODEL",
                "label": "Modèle (ex. kwaivgi/kling-v2.1-standard)",
                "secret": False,
            },
            {"key": "VIDEO_GEN_API_KEY", "label": "Clé générique (si pas de clé dédiée)"},
            {"key": "REPLICATE_API_TOKEN", "label": "Clé Replicate (Kling, MiniMax…)"},
            {"key": "FAL_KEY", "label": "Clé fal.ai (Kling via fal)"},
            {"key": "RUNWAY_API_KEY", "label": "Clé Runway"},
        ],
    },
    {
        "id": "fleur_db",
        "label": "Base produit externe (MySQL)",
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

# Console fournisseur : création de clé / app. Jamais de secret ici.
INTEGRATION_SETUP: dict[str, dict[str, Any]] = {
    "web_search": {
        "setup_url": "https://app.tavily.com/home",
        "setup_label": "Créer une clé Tavily",
        "setup_how": "Ouvrez Tavily, créez une clé API, collez-la ci-dessous. Brave est un repli optionnel.",
        "fields": {
            "TAVILY_API_KEY": {"setup_url": "https://app.tavily.com/home", "setup_label": "Clés Tavily"},
            "BRAVE_SEARCH_API_KEY": {
                "setup_url": "https://api.search.brave.com/app/keys",
                "setup_label": "Clés Brave Search",
            },
        },
    },
    "meta_social": {
        "setup_url": "https://developers.facebook.com/apps/",
        "setup_label": "Ouvrir Meta for Developers",
        "setup_how": "Créez une app (type Business), ajoutez Instagram / Facebook Login, puis générez un jeton Page.",
        "fields": {
            "INSTAGRAM_ACCESS_TOKEN": {
                "setup_url": "https://developers.facebook.com/tools/explorer/",
                "setup_label": "Graph API Explorer",
            },
            "FACEBOOK_ACCESS_TOKEN": {
                "setup_url": "https://developers.facebook.com/tools/explorer/",
                "setup_label": "Graph API Explorer",
            },
            "FACEBOOK_PAGE_ID": {
                "setup_url": "https://www.facebook.com/pages/?category=your_pages",
                "setup_label": "Vos Pages Facebook",
            },
            "META_PAGE_ACCESS_TOKEN": {
                "setup_url": "https://developers.facebook.com/tools/explorer/",
                "setup_label": "Graph API Explorer",
            },
        },
    },
    "email": {
        "setup_url": "https://myaccount.google.com/apppasswords",
        "setup_label": "Mot de passe d’application Gmail",
        "setup_how": "Pour Gmail : activez la validation en 2 étapes, créez un mot de passe d’application, collez-le comme mot de passe SMTP (hôte smtp.gmail.com).",
    },
    "newsletter": {
        "setup_url": "https://app.brevo.com/settings/keys/api",
        "setup_label": "Créer une clé Brevo",
        "setup_how": "Brevo → SMTP & API → Clés API. Copiez la clé v3, puis l’e-mail expéditeur validé.",
        "fields": {
            "BREVO_API_KEY": {
                "setup_url": "https://app.brevo.com/settings/keys/api",
                "setup_label": "Clés API Brevo",
            },
        },
    },
    "google_oauth": {
        "setup_url": "https://console.cloud.google.com/apis/credentials",
        "setup_label": "Créer des identifiants Google",
        "setup_how": (
            "Un bouton « Connecter Google » branche Gmail, Drive, Calendar et Sheets. "
            "Créez une app OAuth Web, activez les API, ajoutez l’URI de redirection, puis connectez. "
            "Client ID / Secret et jetons manuels : Options avancées."
        ),
        "fields": {
            "GOOGLE_OAUTH_CLIENT_ID": {
                "setup_url": "https://console.cloud.google.com/apis/credentials",
                "setup_label": "Identifiants OAuth",
            },
            "GOOGLE_OAUTH_CLIENT_SECRET": {
                "setup_url": "https://console.cloud.google.com/apis/credentials",
                "setup_label": "Identifiants OAuth",
            },
        },
    },
    "google_drive": {
        "setup_url": "https://drive.google.com",
        "setup_label": "Ouvrir Google Drive",
        "setup_how": "Optionnel : ID du dossier Drive (URL …/folders/ID). Sinon Korymb gère le dossier workspace.",
    },
    "google_workspace": {
        "setup_url": "https://console.cloud.google.com/apis/library",
        "setup_label": "Activer Gmail, Calendar, Sheets",
        "setup_how": (
            "Activez une fois les API Gmail, Calendar et Sheets dans Google Cloud. "
            "Avec OAuth connecté, rien d’autre n’est obligatoire."
        ),
    },
    "wordpress": {
        "setup_url": "https://wordpress.org/documentation/article/application-passwords/",
        "setup_label": "Mots de passe d’application WordPress",
        "setup_how": "Utilisateurs → Profil → Mots de passe d’application. Si l’URL du site est renseignée, un lien direct s’affiche.",
    },
    "google_analytics": {
        "setup_url": "https://analytics.google.com/analytics/web/",
        "setup_label": "Ouvrir Google Analytics",
        "setup_how": "Admin GA4 → Paramètres de la propriété → ID de propriété (chiffres). Le jeton peut venir de Connecter Google.",
    },
    "media_ai": {
        "setup_url": "https://pollinations.ai/",
        "setup_label": "Images gratuites (Pollinations)",
        "setup_how": (
            "Le Studio tourne en mode Économique sans clé. "
            "Pour Qualité publication : ajoutez une clé image (OpenRouter). "
            "Chaînes de moteurs et options fines : Options avancées."
        ),
        "fields": {
            "ANTHROPIC_API_KEY": {
                "setup_url": "https://console.anthropic.com/settings/keys",
                "setup_label": "Clés Anthropic",
            },
            "DEEPL_API_KEY": {
                "setup_url": "https://www.deepl.com/your-account/keys",
                "setup_label": "Clés DeepL",
            },
            "IMAGE_GEN_API_KEY": {
                "setup_url": "https://openrouter.ai/keys",
                "setup_label": "Clés OpenRouter",
            },
            "POLLINATIONS_API_KEY": {
                "setup_url": "https://auth.pollinations.ai/",
                "setup_label": "Compte Pollinations",
            },
            "HUGGINGFACE_API_TOKEN": {
                "setup_url": "https://huggingface.co/settings/tokens",
                "setup_label": "Jetons Hugging Face",
            },
        },
    },
    "youtube": {
        "setup_url": "https://console.cloud.google.com/apis/library/youtube.googleapis.com",
        "setup_label": "Activer l’API YouTube",
        "setup_how": "Activez YouTube Data API v3, puis créez une clé API (pas OAuth) dans Identifiants.",
        "fields": {
            "YOUTUBE_API_KEY": {
                "setup_url": "https://console.cloud.google.com/apis/credentials",
                "setup_label": "Créer une clé API Google",
            },
        },
    },
    "whatsapp": {
        "setup_url": "https://developers.facebook.com/apps/",
        "setup_label": "WhatsApp Cloud API",
        "setup_how": "App Meta → produit WhatsApp → jetons et Phone number ID.",
    },
    "crm": {
        "setup_url": "https://www.notion.so/profile/integrations",
        "setup_label": "Créer une intégration Notion",
        "setup_how": "Notion : nouvelle intégration interne, copiez le secret, partagez la base Contacts. HubSpot : application privée.",
        "fields": {
            "NOTION_API_KEY": {
                "setup_url": "https://www.notion.so/profile/integrations",
                "setup_label": "Intégrations Notion",
            },
            "HUBSPOT_API_KEY": {
                "setup_url": "https://app.hubspot.com/private-apps",
                "setup_label": "Apps privées HubSpot",
            },
        },
    },
    "payments": {
        "setup_url": "https://dashboard.stripe.com/apikeys",
        "setup_label": "Clés API Stripe",
        "setup_how": "Stripe : clé secrète sk_… PayPal : app dans le tableau développeur (Client ID + Secret).",
        "fields": {
            "STRIPE_SECRET_KEY": {
                "setup_url": "https://dashboard.stripe.com/apikeys",
                "setup_label": "Clés Stripe",
            },
            "PAYPAL_CLIENT_ID": {
                "setup_url": "https://developer.paypal.com/dashboard/applications/live",
                "setup_label": "Apps PayPal",
            },
            "PAYPAL_CLIENT_SECRET": {
                "setup_url": "https://developer.paypal.com/dashboard/applications/live",
                "setup_label": "Apps PayPal",
            },
        },
    },
    "tiime": {
        "setup_url": "https://www.make.com/",
        "setup_label": "Ouvrir Make (scénario Tiime)",
        "setup_how": "Les factures légales restent dans Tiime. Ici : URL du webhook Make qui crée la facture depuis un devis Korymb.",
    },
    "visual_social": {
        "setup_url": "https://www.canva.com/developers/integrations",
        "setup_label": "Canva Developers",
        "setup_how": "Canva : créez une intégration et copiez la clé. Pinterest : app développeur → jeton d’accès.",
        "fields": {
            "CANVA_API_KEY": {
                "setup_url": "https://www.canva.com/developers/integrations",
                "setup_label": "Intégrations Canva",
            },
            "PINTEREST_ACCESS_TOKEN": {
                "setup_url": "https://developers.pinterest.com/apps/",
                "setup_label": "Apps Pinterest",
            },
        },
    },
    "messaging": {
        "setup_url": "https://t.me/BotFather",
        "setup_label": "Créer un bot Telegram (BotFather)",
        "setup_how": "Telegram : parlez à BotFather (/newbot) et copiez le token. Discord : salon → Paramètres → Intégrations → Webhooks.",
        "fields": {
            "TELEGRAM_BOT_TOKEN": {"setup_url": "https://t.me/BotFather", "setup_label": "BotFather"},
            "TELEGRAM_HITL_BOT_TOKEN": {"setup_url": "https://t.me/BotFather", "setup_label": "BotFather"},
            "DISCORD_WEBHOOK_URL": {
                "setup_url": "https://discord.com/developers/applications",
                "setup_label": "Portail Discord",
            },
            "DISCORD_BOT_TOKEN": {
                "setup_url": "https://discord.com/developers/applications",
                "setup_label": "Portail Discord",
            },
        },
    },
    "tts": {
        "setup_url": "https://elevenlabs.io/app/settings/api-keys",
        "setup_label": "Créer une clé ElevenLabs",
        "setup_how": (
            "Voix gratuite déjà active (Edge TTS). "
            "Voix de marque : clé ElevenLabs. Studio = Économique / Qualité ; chaînes en Avancé."
        ),
        "fields": {
            "ELEVENLABS_API_KEY": {
                "setup_url": "https://elevenlabs.io/app/settings/api-keys",
                "setup_label": "Clés ElevenLabs",
            },
            "OPENAI_API_KEY": {
                "setup_url": "https://platform.openai.com/api-keys",
                "setup_label": "Clés OpenAI",
            },
            "TTS_API_KEY": {
                "setup_url": "https://platform.openai.com/api-keys",
                "setup_label": "Clés OpenAI",
            },
        },
    },
    "linkedin_publish": {
        "setup_url": "https://www.linkedin.com/developers/apps",
        "setup_label": "Créer une app LinkedIn",
        "setup_how": (
            "LinkedIn Developers → votre app → Auth → Authorized redirect URLs : collez "
            "l’URI affichée ci-dessous, caractère pour caractère (localhost ≠ 127.0.0.1). "
            "Produits : Sign In with LinkedIn using OpenID Connect + Share on LinkedIn. "
            "Puis Client ID / Secret et Connecter LinkedIn."
        ),
        "fields": {
            "LINKEDIN_CLIENT_ID": {
                "setup_url": "https://www.linkedin.com/developers/apps",
                "setup_label": "Apps LinkedIn",
            },
            "LINKEDIN_CLIENT_SECRET": {
                "setup_url": "https://www.linkedin.com/developers/apps",
                "setup_label": "Apps LinkedIn",
            },
        },
    },
    "video_gen": {
        "setup_url": "https://replicate.com/account/api-tokens",
        "setup_label": "Créer un jeton Replicate",
        "setup_how": (
            "Sans clé : storyboard d’images. "
            "Clip MP4 : une clé Replicate ou fal.ai. Détail providers en Options avancées."
        ),
        "fields": {
            "REPLICATE_API_TOKEN": {
                "setup_url": "https://replicate.com/account/api-tokens",
                "setup_label": "Jetons Replicate",
            },
            "FAL_KEY": {"setup_url": "https://fal.ai/dashboard/keys", "setup_label": "Clés fal.ai"},
            "RUNWAY_API_KEY": {
                "setup_url": "https://app.runwayml.com/settings",
                "setup_label": "Compte Runway",
            },
            "VIDEO_GEN_API_KEY": {
                "setup_url": "https://replicate.com/account/api-tokens",
                "setup_label": "Jetons Replicate",
            },
        },
    },
}

for group in INTEGRATION_GROUPS:
    group.setdefault(
        "priority",
        group["id"]
        in {
            "email",
            "google_oauth",
            "google_drive",
            "google_workspace",
            "wordpress",
            "meta_social",
            "messaging",
            "tiime",
            "tts",
            "media_ai",
            "video_gen",
            "linkedin_publish",
            "newsletter",
            "youtube",
            "visual_social",
        },
    )
    extra = INTEGRATION_SETUP.get(str(group["id"]), {})
    field_setup = dict(extra.get("fields") or {})
    for key, val in extra.items():
        if key == "fields":
            continue
        group.setdefault(key, val)
    for field in group["fields"]:
        field.setdefault("secret", _secret(str(field["key"])))
        for key, val in field_setup.get(str(field["key"]), {}).items():
            field.setdefault(key, val)

# Sections UI : essentielles / création / métier / technique
_GROUP_SECTIONS: dict[str, str] = {
    "google_oauth": "essentials",
    "google_drive": "essentials",
    "google_workspace": "essentials",
    "wordpress": "essentials",
    "meta_social": "essentials",
    "linkedin_publish": "essentials",
    "email": "essentials",
    "media_ai": "creative",
    "tts": "creative",
    "video_gen": "creative",
    "newsletter": "business",
    "tiime": "business",
    "messaging": "business",
    "youtube": "business",
    "visual_social": "business",
    "google_analytics": "advanced",
    "web_search": "advanced",
    "whatsapp": "advanced",
    "crm": "advanced",
    "payments": "advanced",
    "fleur_db": "advanced",
}

# Champs « options avancées » (tuyauterie) — le simple reste visible
_ADVANCED_FIELD_KEYS: frozenset[str] = frozenset(
    {
        "GOOGLE_API_ACCESS_TOKEN",
        "GOOGLE_OAUTH_REFRESH_TOKEN",
        "GOOGLE_OAUTH_TOKEN_ENDPOINT",
        "GOOGLE_DRIVE_ACCESS_TOKEN",
        "GOOGLE_GMAIL_ACCESS_TOKEN",
        "GOOGLE_CALENDAR_ACCESS_TOKEN",
        "GOOGLE_SHEETS_ACCESS_TOKEN",
        "GOOGLE_SHEETS_DEFAULT_ID",
        "GOOGLE_ANALYTICS_ACCESS_TOKEN",
        "META_PAGE_ACCESS_TOKEN",
        "META_WEBHOOK_VERIFY_TOKEN",
        "BREVO_DEFAULT_LIST_ID",
        "IMAGE_ENGINE_CHAIN",
        "IMAGE_FREE_ENGINE",
        "IMAGE_FREE_BASE_URL",
        "POLLINATIONS_API_KEY",
        "POLLINATIONS_IMAGE_MODEL",
        "HUGGINGFACE_API_TOKEN",
        "IMAGE_HF_MODEL",
        "IMAGE_GEN_MODEL",
        "IMAGE_GEN_BASE_URL",
        "ANTHROPIC_API_KEY",
        "DEEPL_API_KEY",
        "TTS_ENGINE_CHAIN",
        "TTS_FREE_ENGINE",
        "TTS_EDGE_VOICE",
        "TTS_FREE_BASE_URL",
        "TTS_PROVIDER",
        "TTS_API_KEY",
        "TTS_BASE_URL",
        "TTS_MODEL",
        "TTS_VOICE",
        "TTS_OUTPUT_DIR",
        "ELEVENLABS_MODEL",
        "OPENAI_API_KEY",
        "VIDEO_ENGINE_CHAIN",
        "VIDEO_HF_MODEL",
        "VIDEO_GEN_PROVIDER",
        "VIDEO_GEN_MODEL",
        "VIDEO_GEN_API_KEY",
        "RUNWAY_API_KEY",
        "CANVA_DEFAULT_TEMPLATE_ID",
        "PINTEREST_BOARD_ID",
        "DISCORD_BOT_TOKEN",
        "DISCORD_CHANNEL_ID",
        "TELEGRAM_BOT_TOKEN",
        "TELEGRAM_WEBHOOK_SECRET",
        "KORYMB_PUBLIC_URL",
        "KORYMB_WEBHOOK_URL",
        "NOTIFICATION_WEBHOOK_URL",
        "LINKEDIN_AUTHOR_URN",
        "PAYPAL_API_BASE",
    }
)

for group in INTEGRATION_GROUPS:
    group["section"] = _GROUP_SECTIONS.get(str(group["id"]), "advanced")
    # Les groupes « advanced » ne sont plus priority (cachés derrière Technique)
    if group["section"] == "advanced":
        group["priority"] = False
    for field in group["fields"]:
        if str(field.get("key") or "") in _ADVANCED_FIELD_KEYS:
            field["advanced"] = True
        else:
            field.setdefault("advanced", False)


def all_integration_keys() -> frozenset[str]:
    keys: set[str] = set()
    for group in INTEGRATION_GROUPS:
        for field in group["fields"]:
            keys.add(str(field["key"]))
    return frozenset(keys)


INTEGRATION_KEYS: frozenset[str] = all_integration_keys()
