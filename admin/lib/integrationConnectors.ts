/** Noms humains des connecteurs — page Intégrations. */

export type ConnectorMeta = {
  title: string;
  what: string;
  tags: string[];
  aliases: string[];
};

export const CONNECTOR_META: Record<string, ConnectorMeta> = {
  google: {
    title: "Google",
    what: "Un compte pour Gmail, Drive, l’agenda et Sheets.",
    tags: ["Gmail", "Drive", "Agenda", "Sheets"],
    aliases: ["gmail", "drive", "calendar", "agenda", "sheets", "workspace"],
  },
  linkedin_publish: {
    title: "LinkedIn",
    what: "Publier des posts depuis le Studio.",
    tags: ["LinkedIn"],
    aliases: ["linkedin", "réseau pro"],
  },
  meta_social: {
    title: "Instagram & Facebook",
    what: "Publier sur les pages Meta.",
    tags: ["Instagram", "Facebook"],
    aliases: ["meta", "ig", "fb"],
  },
  wordpress: {
    title: "WordPress",
    what: "Publier des articles sur le site.",
    tags: ["WordPress"],
    aliases: ["wp", "blog", "cms"],
  },
  email: {
    title: "Email (SMTP)",
    what: "Envoyer des e-mails (Gmail : mot de passe d’application).",
    tags: ["SMTP", "Gmail"],
    aliases: ["smtp", "mail", "courrier"],
  },
  creative_media: {
    title: "Images, voix, vidéo",
    what: "Sans clé : images et voix gratuites. Pour un clip : clé Replicate (Kling) ou fal.",
    tags: ["Images", "Voix", "Vidéo", "Kling", "Replicate"],
    aliases: ["kling", "minimax", "hailuo", "luma", "pika", "runway", "fal", "elevenlabs", "pollinations", "tts"],
  },
  youtube: {
    title: "YouTube",
    what: "Fiches et descriptions. Pas d’upload automatique.",
    tags: ["YouTube"],
    aliases: ["yt"],
  },
  visual_social: {
    title: "Canva & Pinterest",
    what: "Visuels Canva et épingles Pinterest.",
    tags: ["Canva", "Pinterest"],
    aliases: ["canva", "pinterest"],
  },
  messaging: {
    title: "Telegram & Discord",
    what: "Notifications et boutons Valider / Rejeter.",
    tags: ["Telegram", "Discord"],
    aliases: ["telegram", "discord", "webhook"],
  },
  newsletter: {
    title: "Newsletter Brevo",
    what: "Envoi de newsletters.",
    tags: ["Brevo"],
    aliases: ["brevo", "sendinblue"],
  },
  tiime: {
    title: "Tiime (factures)",
    what: "Les devis restent dans Korymb ; la facture légale est dans Tiime.",
    tags: ["Tiime"],
    aliases: ["facture", "compta"],
  },
  web_search: {
    title: "Recherche web",
    what: "Tavily, puis Brave, puis DuckDuckGo.",
    tags: ["Tavily", "Brave"],
    aliases: ["tavily", "duckduckgo"],
  },
  whatsapp: {
    title: "WhatsApp",
    what: "Messages via l’API Meta.",
    tags: ["WhatsApp"],
    aliases: ["whatsapp"],
  },
  crm: {
    title: "CRM externe",
    what: "Notion ou HubSpot, en plus des contacts Korymb.",
    tags: ["Notion", "HubSpot"],
    aliases: ["notion", "hubspot"],
  },
  payments: {
    title: "Paiements",
    what: "Stripe et PayPal.",
    tags: ["Stripe", "PayPal"],
    aliases: ["stripe", "paypal"],
  },
  google_analytics: {
    title: "Google Analytics",
    what: "Mesure d’audience du site.",
    tags: ["Analytics"],
    aliases: ["ga4", "analytics"],
  },
  fleur_db: {
    title: "Base Fleur d’ÅmÔurs",
    what: "Lecture de la base métier (optionnel).",
    tags: ["MySQL"],
    aliases: ["fleur", "mysql"],
  },
};

export function connectorMeta(cardId: string, fallbackLabel: string, fallbackDesc = ""): ConnectorMeta {
  return (
    CONNECTOR_META[cardId] || {
      title: fallbackLabel,
      what: fallbackDesc,
      tags: [],
      aliases: [],
    }
  );
}

export type FamilyMeta = {
  title: string;
  what: string;
};

export const FAMILY_META: Record<string, FamilyMeta> = {
  studio: { title: "Réglage Studio", what: "Économique (gratuit) ou qualité publication." },
  images: { title: "Images", what: "Sans clé : Pollinations. Qualité : OpenRouter." },
  voix: { title: "Voix", what: "Sans clé : Edge TTS. Qualité : ElevenLabs." },
  video: { title: "Vidéo / Kling", what: "Clip MP4 : clé Replicate (Kling) ou fal.ai." },
  instagram: { title: "Instagram", what: "Publier sur le compte Instagram." },
  facebook: { title: "Facebook", what: "Publier sur la page Facebook." },
  canva: { title: "Canva", what: "Templates et visuels Canva." },
  pinterest: { title: "Pinterest", what: "Épingles sur un board." },
  telegram: { title: "Telegram", what: "Notifications et boutons Valider / Rejeter." },
  discord: { title: "Discord", what: "Notifications sur un salon." },
  webhooks: { title: "Webhooks", what: "URLs de notification Korymb." },
};

export type DirectoryTile = {
  id: string;
  cardId: string;
  title: string;
  what: string;
  tags: string[];
  aliases: string[];
  field?: string;
  family?: string;
  technique?: boolean;
  statusKeys?: string[];
  /** Prêt dès qu’une des clés statusKeys est définie (ex. Replicate ou fal). */
  statusAny?: boolean;
  freeOk?: boolean;
  /** Champs du formulaire principal — le reste va en Options avancées. */
  simpleKeys?: string[];
  howto?: string;
  setupUrl?: string;
  setupLabel?: string;
};

export const DIRECTORY_TILES: DirectoryTile[] = [
  {
    id: "google",
    cardId: "google",
    title: "Google",
    what: "Un compte pour Gmail, Drive, l’agenda et Sheets.",
    tags: ["Gmail", "Drive", "Agenda", "Sheets"],
    aliases: ["gmail", "workspace", "calendar"],
    simpleKeys: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"],
    howto: "Créez une app OAuth Web, collez l’URI ci-dessous, enregistrez Client ID et Secret, puis Connecter Google.",
    setupUrl: "https://console.cloud.google.com/apis/credentials",
    setupLabel: "Identifiants Google",
  },
  {
    id: "linkedin",
    cardId: "linkedin_publish",
    title: "LinkedIn",
    what: "Publier des posts depuis le Studio.",
    tags: ["LinkedIn"],
    aliases: ["linkedin"],
    statusKeys: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
    simpleKeys: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
    howto: "Dans l’app LinkedIn → Auth, collez l’URI ci-dessous (localhost ≠ 127.0.0.1). Produits : OpenID Connect + Share. Puis Connecter LinkedIn.",
    setupUrl: "https://www.linkedin.com/developers/apps",
    setupLabel: "Créer une app LinkedIn",
  },
  {
    id: "instagram",
    cardId: "meta_social",
    title: "Instagram",
    what: "Publier sur le compte Instagram.",
    tags: ["Instagram"],
    aliases: ["ig", "meta"],
    field: "INSTAGRAM_ACCESS_TOKEN",
    family: "instagram",
    statusKeys: ["INSTAGRAM_ACCESS_TOKEN", "INSTAGRAM_ACCOUNT_ID"],
    simpleKeys: ["INSTAGRAM_ACCESS_TOKEN", "INSTAGRAM_ACCOUNT_ID"],
    howto: "Meta for Developers → Graph API Explorer : jeton du compte Instagram + identifiant du compte.",
    setupUrl: "https://developers.facebook.com/tools/explorer/",
    setupLabel: "Graph API Explorer",
  },
  {
    id: "facebook",
    cardId: "meta_social",
    title: "Facebook",
    what: "Publier sur la page Facebook.",
    tags: ["Facebook"],
    aliases: ["fb", "meta"],
    field: "FACEBOOK_ACCESS_TOKEN",
    family: "facebook",
    statusKeys: ["FACEBOOK_ACCESS_TOKEN", "FACEBOOK_PAGE_ID"],
    simpleKeys: ["FACEBOOK_ACCESS_TOKEN", "FACEBOOK_PAGE_ID"],
    howto: "Jeton de la Page + ID de la page (Paramètres → À propos, chiffres uniquement).",
    setupUrl: "https://www.facebook.com/pages/?category=your_pages",
    setupLabel: "Vos pages Facebook",
  },
  {
    id: "wordpress",
    cardId: "wordpress",
    title: "WordPress",
    what: "Publier des articles sur le site.",
    tags: ["WordPress"],
    aliases: ["wp", "blog"],
    statusKeys: ["WP_BASE_URL", "WP_APP_PASSWORD"],
    simpleKeys: ["WP_BASE_URL", "WP_USER", "WP_APP_PASSWORD"],
    howto: "URL du site, utilisateur, puis Utilisateurs → Profil → mot de passe d’application.",
    setupUrl: "https://wordpress.org/documentation/article/application-passwords/",
    setupLabel: "Mots de passe d’application",
  },
  {
    id: "email",
    cardId: "email",
    title: "Email",
    what: "Envoyer des e-mails (Gmail : mot de passe d’application).",
    tags: ["SMTP", "Gmail"],
    aliases: ["smtp", "mail"],
    statusKeys: ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"],
    simpleKeys: ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"],
    howto: "Gmail : validation en 2 étapes, mot de passe d’application, hôte smtp.gmail.com.",
    setupUrl: "https://myaccount.google.com/apppasswords",
    setupLabel: "Mot de passe d’application Gmail",
  },
  {
    id: "images",
    cardId: "creative_media",
    title: "Images",
    what: "Sans clé : Pollinations. Qualité : OpenRouter.",
    tags: ["Pollinations", "OpenRouter"],
    aliases: ["image", "dalle", "pollinations"],
    field: "IMAGE_GEN_API_KEY",
    family: "images",
    statusKeys: ["IMAGE_GEN_API_KEY"],
    freeOk: true,
    simpleKeys: ["MEDIA_ENGINE_MODE", "IMAGE_GEN_API_KEY"],
    howto: "Rien à coller pour le mode gratuit. Pour la qualité publication : clé OpenRouter.",
    setupUrl: "https://openrouter.ai/keys",
    setupLabel: "Clés OpenRouter",
  },
  {
    id: "voix",
    cardId: "creative_media",
    title: "Voix",
    what: "Sans clé : Edge TTS. Qualité : ElevenLabs.",
    tags: ["Edge TTS", "ElevenLabs"],
    aliases: ["tts", "elevenlabs", "audio"],
    field: "ELEVENLABS_API_KEY",
    family: "voix",
    statusKeys: ["ELEVENLABS_API_KEY"],
    freeOk: true,
    simpleKeys: ["EDGE_TTS_VOICE", "ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID"],
    howto: "La voix Edge marche sans clé. Pour une voix de marque : clé + Voice ID ElevenLabs.",
    setupUrl: "https://elevenlabs.io/app/settings/api-keys",
    setupLabel: "Clés ElevenLabs",
  },
  {
    id: "video",
    cardId: "creative_media",
    title: "Vidéo / Kling",
    what: "Clip MP4 : une clé Replicate (Kling) ou fal.ai.",
    tags: ["Kling", "Replicate", "fal"],
    aliases: ["kling", "minimax", "hailuo", "runway", "fal"],
    field: "REPLICATE_API_TOKEN",
    family: "video",
    statusKeys: ["REPLICATE_API_TOKEN", "FAL_KEY"],
    statusAny: true,
    simpleKeys: ["REPLICATE_API_TOKEN", "FAL_KEY", "VIDEO_GEN_MODEL"],
    howto: "Sans clé : storyboard d’images. Pour un clip : collez Replicate (recommandé pour Kling) ou fal.ai. Le modèle Kling peut rester tel quel.",
    setupUrl: "https://replicate.com/account/api-tokens",
    setupLabel: "Jetons Replicate",
  },
  {
    id: "youtube",
    cardId: "youtube",
    title: "YouTube",
    what: "Fiches et descriptions. Pas d’upload automatique.",
    tags: ["YouTube"],
    aliases: ["yt"],
    statusKeys: ["YOUTUBE_API_KEY"],
    simpleKeys: ["YOUTUBE_API_KEY", "YOUTUBE_CHANNEL_ID"],
    howto: "Activez YouTube Data API v3, puis créez une clé API (pas OAuth).",
    setupUrl: "https://console.cloud.google.com/apis/credentials",
    setupLabel: "Clés API Google",
  },
  {
    id: "canva",
    cardId: "visual_social",
    title: "Canva",
    what: "Templates et visuels Canva.",
    tags: ["Canva"],
    aliases: ["canva"],
    field: "CANVA_API_KEY",
    family: "canva",
    statusKeys: ["CANVA_API_KEY"],
    simpleKeys: ["CANVA_API_KEY", "CANVA_DEFAULT_TEMPLATE_ID"],
    howto: "Canva Developers : créez une intégration, copiez la clé. Le Template ID est l’identifiant du modèle par défaut.",
    setupUrl: "https://www.canva.com/developers/integrations",
    setupLabel: "Intégrations Canva",
  },
  {
    id: "pinterest",
    cardId: "visual_social",
    title: "Pinterest",
    what: "Épingles sur un board.",
    tags: ["Pinterest"],
    aliases: ["pinterest"],
    field: "PINTEREST_ACCESS_TOKEN",
    family: "pinterest",
    statusKeys: ["PINTEREST_ACCESS_TOKEN", "PINTEREST_BOARD_ID"],
    simpleKeys: ["PINTEREST_ACCESS_TOKEN", "PINTEREST_BOARD_ID"],
    howto: "App Pinterest : jeton d’accès + ID du board (dans l’URL du tableau).",
    setupUrl: "https://developers.pinterest.com/apps/",
    setupLabel: "Apps Pinterest",
  },
  {
    id: "telegram",
    cardId: "messaging",
    title: "Telegram",
    what: "Notifications et boutons Valider / Rejeter.",
    tags: ["Telegram"],
    aliases: ["telegram"],
    field: "TELEGRAM_HITL_BOT_TOKEN",
    family: "telegram",
    statusKeys: ["TELEGRAM_HITL_BOT_TOKEN", "TELEGRAM_CHAT_ID"],
    simpleKeys: ["TELEGRAM_HITL_BOT_TOKEN", "TELEGRAM_CHAT_ID"],
    howto: "BotFather → /newbot, collez le token. Chat ID : envoyez un message au bot puis lisez l’ID du chat.",
    setupUrl: "https://t.me/BotFather",
    setupLabel: "BotFather",
  },
  {
    id: "discord",
    cardId: "messaging",
    title: "Discord",
    what: "Notifications sur un salon.",
    tags: ["Discord"],
    aliases: ["discord"],
    field: "DISCORD_WEBHOOK_URL",
    family: "discord",
    statusKeys: ["DISCORD_WEBHOOK_URL"],
    simpleKeys: ["DISCORD_WEBHOOK_URL"],
    howto: "Salon → Paramètres → Intégrations → Webhooks → copier l’URL.",
    setupUrl: "https://discord.com/developers/applications",
    setupLabel: "Applications Discord",
  },
  {
    id: "brevo",
    cardId: "newsletter",
    title: "Brevo",
    what: "Envoi de newsletters.",
    tags: ["Brevo"],
    aliases: ["brevo", "sendinblue"],
    statusKeys: ["BREVO_API_KEY"],
    simpleKeys: ["BREVO_API_KEY", "BREVO_SENDER_EMAIL", "BREVO_SENDER_NAME"],
    howto: "Brevo → SMTP & API → Clés API (v3), puis l’e-mail expéditeur validé.",
    setupUrl: "https://app.brevo.com/settings/keys/api",
    setupLabel: "Clés API Brevo",
  },
  {
    id: "tiime",
    cardId: "tiime",
    title: "Tiime",
    what: "Les devis restent dans Korymb ; la facture légale est dans Tiime.",
    tags: ["Factures"],
    aliases: ["tiime", "facture"],
    statusKeys: ["TIIME_MAKE_WEBHOOK_URL"],
    simpleKeys: ["TIIME_MAKE_WEBHOOK_URL"],
    howto: "Optionnel : URL du scénario Make qui crée la facture Tiime depuis un devis Korymb.",
    setupUrl: "https://www.make.com/",
    setupLabel: "Make",
  },
  {
    id: "web_search",
    cardId: "web_search",
    title: "Recherche web",
    what: "Tavily, puis Brave, puis DuckDuckGo.",
    tags: ["Tavily", "Brave"],
    aliases: ["tavily", "duckduckgo"],
    technique: true,
    freeOk: true,
    statusKeys: ["TAVILY_API_KEY", "BRAVE_SEARCH_API_KEY"],
    statusAny: true,
    simpleKeys: ["TAVILY_API_KEY", "BRAVE_SEARCH_API_KEY"],
    howto: "Collez une clé Tavily (recommandé). Brave est un repli. DuckDuckGo marche sans clé.",
    setupUrl: "https://app.tavily.com/home",
    setupLabel: "Clés Tavily",
  },
  {
    id: "whatsapp",
    cardId: "whatsapp",
    title: "WhatsApp",
    what: "Messages via l’API Meta.",
    tags: ["WhatsApp"],
    aliases: ["whatsapp"],
    technique: true,
    family: "whatsapp",
    statusKeys: ["WHATSAPP_ACCESS_TOKEN"],
    simpleKeys: ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"],
    howto: "App Meta → produit WhatsApp : jeton et Phone number ID.",
    setupUrl: "https://developers.facebook.com/apps/",
    setupLabel: "Apps Meta",
  },
  {
    id: "notion",
    cardId: "crm",
    title: "Notion",
    what: "CRM externe, en plus des contacts Korymb.",
    tags: ["Notion"],
    aliases: ["notion", "crm"],
    technique: true,
    family: "notion",
    statusKeys: ["NOTION_API_KEY"],
    simpleKeys: ["NOTION_API_KEY", "NOTION_CONTACTS_DATABASE_ID"],
    howto: "Intégration interne Notion, copiez le secret, partagez la base Contacts.",
    setupUrl: "https://www.notion.so/profile/integrations",
    setupLabel: "Intégrations Notion",
  },
  {
    id: "hubspot",
    cardId: "crm",
    title: "HubSpot",
    what: "CRM externe, en plus des contacts Korymb.",
    tags: ["HubSpot"],
    aliases: ["hubspot"],
    technique: true,
    family: "hubspot",
    statusKeys: ["HUBSPOT_API_KEY"],
    simpleKeys: ["HUBSPOT_API_KEY"],
    howto: "HubSpot → application privée → copiez la clé.",
    setupUrl: "https://app.hubspot.com/private-apps",
    setupLabel: "Apps privées HubSpot",
  },
  {
    id: "stripe",
    cardId: "payments",
    title: "Stripe",
    what: "Encaisser des paiements.",
    tags: ["Stripe"],
    aliases: ["stripe"],
    technique: true,
    family: "stripe",
    statusKeys: ["STRIPE_SECRET_KEY"],
    simpleKeys: ["STRIPE_SECRET_KEY"],
    howto: "Dashboard Stripe → clé secrète sk_…",
    setupUrl: "https://dashboard.stripe.com/apikeys",
    setupLabel: "Clés Stripe",
  },
  {
    id: "paypal",
    cardId: "payments",
    title: "PayPal",
    what: "Encaisser des paiements.",
    tags: ["PayPal"],
    aliases: ["paypal"],
    technique: true,
    family: "paypal",
    statusKeys: ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"],
    simpleKeys: ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"],
    howto: "Tableau développeur PayPal : Client ID + Secret.",
    setupUrl: "https://developer.paypal.com/dashboard/applications/live",
    setupLabel: "Apps PayPal",
  },
  {
    id: "analytics",
    cardId: "google_analytics",
    title: "Google Analytics",
    what: "Mesure d’audience du site.",
    tags: ["Analytics"],
    aliases: ["ga4", "analytics"],
    technique: true,
    statusKeys: ["GA_PROPERTY_ID"],
    simpleKeys: ["GA_PROPERTY_ID"],
    howto: "Admin GA4 → Paramètres de la propriété → ID de propriété (chiffres).",
    setupUrl: "https://analytics.google.com/analytics/web/",
    setupLabel: "Google Analytics",
  },
  {
    id: "fleur",
    cardId: "fleur_db",
    title: "Base Fleur d’ÅmÔurs",
    what: "Lecture de la base métier (optionnel).",
    tags: ["MySQL"],
    aliases: ["fleur", "mysql"],
    technique: true,
    family: "fleur",
    simpleKeys: ["FLEUR_DB_HOST", "FLEUR_DB_USER", "FLEUR_DB_PASSWORD", "FLEUR_DB_NAME"],
    howto: "Connexion lecture seule : hôte, utilisateur, mot de passe. Le port est en options avancées.",
  },
  {
    id: "webhooks",
    cardId: "messaging",
    title: "Webhooks",
    what: "Notifications sortantes (n8n, Zapier, Make).",
    tags: ["Webhook"],
    aliases: ["n8n", "zapier", "webhook"],
    technique: true,
    family: "webhooks",
    statusKeys: ["KORYMB_WEBHOOK_URL", "NOTIFICATION_WEBHOOK_URL"],
    statusAny: true,
    simpleKeys: ["KORYMB_WEBHOOK_URL", "NOTIFICATION_WEBHOOK_URL"],
    howto: "Collez l’URL du scénario (Make, n8n, Zapier) qui reçoit les événements Korymb.",
  },
];

export function familyMeta(family: string): FamilyMeta {
  return FAMILY_META[family] || { title: family, what: "" };
}

export function fieldFamily(key: string): string {
  const k = key.toUpperCase();
  if (k === "MEDIA_ENGINE_MODE") return "studio";
  if (k.startsWith("INSTAGRAM_")) return "instagram";
  if (k.startsWith("FACEBOOK_") || k.startsWith("META_")) return "facebook";
  if (k.startsWith("CANVA_")) return "canva";
  if (k.startsWith("PINTEREST_")) return "pinterest";
  if (k.startsWith("TELEGRAM_")) return "telegram";
  if (k.startsWith("DISCORD_")) return "discord";
  if (k.startsWith("WHATSAPP_")) return "whatsapp";
  if (k.startsWith("NOTION_") || k === "CRM_PROVIDER") return "notion";
  if (k.startsWith("HUBSPOT_")) return "hubspot";
  if (k.startsWith("STRIPE_")) return "stripe";
  if (k.startsWith("PAYPAL_")) return "paypal";
  if (k.startsWith("TAVILY") || k.startsWith("BRAVE")) return "web_search";
  if (k.startsWith("FLEUR_")) return "fleur";
  if (k.startsWith("GA_") || k.startsWith("GOOGLE_ANALYTICS")) return "analytics";
  if (k.startsWith("KORYMB_") || k === "NOTIFICATION_WEBHOOK_URL") return "webhooks";
  if (k.startsWith("TTS_") || k.startsWith("ELEVEN") || k === "OPENAI_API_KEY" || k.startsWith("EDGE_")) {
    return "voix";
  }
  if (k.startsWith("VIDEO_") || k === "REPLICATE_API_TOKEN" || k === "FAL_KEY" || k === "RUNWAY_API_KEY") {
    return "video";
  }
  if (
    k.startsWith("IMAGE_") ||
    k.startsWith("POLLINATIONS") ||
    k.startsWith("HUGGINGFACE") ||
    k === "ANTHROPIC_API_KEY" ||
    k === "DEEPL_API_KEY"
  ) {
    return "images";
  }
  return "";
}

export function splitTileFields<T extends { key: string }>(
  tile: DirectoryTile | undefined,
  fields: T[],
): { simple: T[]; advanced: T[] } {
  const map = new Map(fields.map((f) => [f.key, f]));
  if (!tile) return { simple: fields, advanced: [] };
  const scoped = tile.family ? fields.filter((f) => fieldFamily(f.key) === tile.family) : fields;
  const wanted = tile.simpleKeys?.length ? tile.simpleKeys : scoped.map((f) => f.key);
  const simple = wanted.map((k) => map.get(k)).filter((f): f is T => Boolean(f));
  const simpleSet = new Set(simple.map((f) => f.key));
  const advanced = scoped.filter((f) => !simpleSet.has(f.key));
  return { simple, advanced };
}

export function resolveDirectoryTile(cardId: string, field?: string): DirectoryTile | undefined {
  if (field) {
    const byKey = DIRECTORY_TILES.find((t) => t.simpleKeys?.includes(field) || t.field === field);
    if (byKey) return byKey;
    const fam = fieldFamily(field);
    if (fam) {
      const byFam = DIRECTORY_TILES.find((t) => t.family === fam);
      if (byFam) return byFam;
    }
  }
  return DIRECTORY_TILES.find((t) => t.cardId === cardId && !t.family) || DIRECTORY_TILES.find((t) => t.cardId === cardId);
}

/** Santé système / sondes → tuile Intégrations. */
const CONNECTOR_ID_TO_TILE: Record<string, string> = {
  google_oauth: "google",
  google_drive: "google",
  gmail: "google",
  google_calendar: "google",
  google_sheets: "google",
  facebook: "facebook",
  instagram: "instagram",
  meta_webhooks: "facebook",
  smtp: "email",
  send_email: "email",
  fleur_db: "fleur",
  tavily: "web_search",
  brave_search: "web_search",
  web_search: "web_search",
  web_tools: "web_search",
  jina_reader: "web_search",
  read_webpage: "web_search",
  brevo: "brevo",
  send_newsletter: "brevo",
  deepl: "images",
  image_gen: "images",
  generate_image: "images",
  describe_image: "images",
  google_analytics: "analytics",
  youtube: "youtube",
  whatsapp: "whatsapp",
  crm: "notion",
  stripe: "stripe",
  paypal: "paypal",
  canva: "canva",
  pinterest: "pinterest",
  discord: "discord",
  telegram: "telegram",
  wordpress: "wordpress",
  korymb_webhook: "webhooks",
  text_to_speech: "voix",
  tts: "voix",
  video_gen: "video",
  generate_video: "video",
  linkedin_publish: "linkedin",
  search_linkedin: "linkedin",
  post_linkedin: "linkedin",
  tiime: "tiime",
};

export function hrefForDirectoryTile(tileId: string, extra?: { field?: string }): string {
  const tile = DIRECTORY_TILES.find((t) => t.id === tileId);
  if (!tile) return "/administration/integrations";
  const params = new URLSearchParams();
  params.set("group", tile.cardId);
  params.set("tile", tile.id);
  const field = extra?.field || tile.field;
  if (field) params.set("field", field);
  if (tile.technique) params.set("technique", "1");
  return `/administration/integrations?${params.toString()}`;
}

/** Un clic depuis Santé / recommandations vers le formulaire du connecteur. */
export function hrefForConnectorId(id: string): string {
  if (id.startsWith("llm_")) return "/administration/budget";
  if (id === "deepl") return hrefForDirectoryTile("images", { field: "DEEPL_API_KEY" });
  if (id === "describe_image") return hrefForDirectoryTile("images", { field: "ANTHROPIC_API_KEY" });
  const tileId = CONNECTOR_ID_TO_TILE[id];
  if (tileId) return hrefForDirectoryTile(tileId);
  return "/administration/integrations";
}

export function tileHaystack(tile: DirectoryTile): string {
  return [tile.title, tile.what, ...tile.tags, ...tile.aliases, tile.field || "", tile.family || ""]
    .join(" ")
    .toLowerCase();
}

export function tileTone(
  tile: DirectoryTile,
  values: Record<string, unknown>,
): "ok" | "warn" | "neutral" | "bad" {
  if (tile.freeOk) return "ok";
  const keys = tile.statusKeys || [];
  if (!keys.length) return "neutral";
  const filled = keys.filter((k) => values[`${k}_set`] === true).length;
  if (filled === 0) return "neutral";
  if (tile.statusAny || filled >= keys.length) return "ok";
  return "warn";
}

export function tileStatusLabel(tile: DirectoryTile, values: Record<string, unknown>): string {
  if (tile.freeOk) {
    const paid = (tile.statusKeys || []).some((k) => values[`${k}_set`] === true);
    return paid ? "Gratuit + clé" : "Gratuit actif";
  }
  const keys = tile.statusKeys || [];
  if (!keys.length) return "";
  const filled = keys.filter((k) => values[`${k}_set`] === true).length;
  if (filled === 0) return "À brancher";
  if (tile.statusAny || filled >= keys.length) return "Prêt";
  return "Partiel";
}
