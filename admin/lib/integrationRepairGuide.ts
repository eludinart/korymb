import type { HealthTone } from "./healthTone";
import {
  healthStatusLabel,
  healthToneForIntegration,
  type IntegrationRow,
  type OperationalRow,
} from "./integrationHealth";

export type RepairGuide = {
  reason: string;
  steps: string[];
  externalHref?: string;
  externalLabel?: string;
};

/** Tile annuaire → ids santé system-health à croiser. */
export const TILE_HEALTH_IDS: Record<string, string[]> = {
  google: ["google_oauth", "google_drive", "gmail", "google_calendar", "google_sheets"],
  linkedin: ["post_linkedin"],
  instagram: ["instagram"],
  facebook: ["facebook"],
  wordpress: ["wordpress"],
  email: ["smtp"],
  images: ["image_gen"],
  voix: ["text_to_speech"],
  video: ["generate_video"],
  youtube: ["youtube"],
  canva: ["canva"],
  pinterest: ["pinterest"],
  telegram: ["telegram"],
  discord: ["discord"],
  newsletter: ["brevo"],
  web_search: ["web_tools", "tavily", "brave_search"],
  whatsapp: ["whatsapp"],
  notion: ["crm"],
  hubspot: ["crm"],
  stripe: ["stripe"],
  paypal: ["paypal"],
  analytics: ["google_analytics"],
  webhooks: ["korymb_webhook"],
};

const DEFAULT_STEPS: Record<string, string[]> = {
  facebook: [
    "Ouvrir Meta for Developers → Graph API Explorer.",
    "Générer un Page Access Token (permissions pages_manage_posts, pages_read_engagement).",
    "Copier l’ID de page (chiffres uniquement) : Page → Paramètres → À propos.",
    "Coller token + Page ID dans Intégrations → Facebook, enregistrer, puis rafraîchir la santé.",
  ],
  instagram: [
    "Ouvrir Meta for Developers → Graph API Explorer.",
    "Générer un jeton Instagram Business (instagram_basic, instagram_content_publish).",
    "Récupérer l’Instagram Account ID (chiffres).",
    "Coller token + Account ID dans Intégrations → Instagram, enregistrer, rafraîchir la santé.",
  ],
  wordpress: [
    "Vérifier l’URL du site en https:// (pas http://) dans Intégrations → WordPress.",
    "Sur le site : Utilisateurs → Profil → Mot de passe d’application → créer un mot de passe.",
    "Coller l’utilisateur WP + le mot de passe d’application (espaces retirés ou conservés selon WP).",
    "Enregistrer, puis rafraîchir la santé : la sonde doit répondre Auth OK.",
  ],
  smtp: [
    "Renseigner SMTP_HOST, SMTP_USER et SMTP_PASS (Gmail : mot de passe d’application).",
    "Hôte typique Gmail : smtp.gmail.com (ports 465 ou 587).",
    "Enregistrer, puis rafraîchir la santé.",
  ],
  google_drive: [
    "Dans Google Cloud : activer Drive API + scopes drive.file / drive.",
    "Reconnecter Google (OAuth) depuis Intégrations pour renouveler le refresh token avec les bons scopes.",
    "Renseigner GOOGLE_DRIVE_FOLDER_ID (ID du dossier cible dans l’URL Drive).",
    "Enregistrer et rafraîchir la santé.",
  ],
  google_oauth: [
    "Vérifier Client ID + Client Secret (type Application Web) dans Google Cloud.",
    "Ajouter l’URI de redirection Korymb, puis cliquer Connecter Google.",
    "Si Drive est en erreur de scopes : reconnecter après avoir activé les API nécessaires.",
  ],
  crm: [
    "Choisir CRM_PROVIDER=notion ou hubspot.",
    "Coller la clé API correspondante (Notion secret ou HubSpot private app).",
    "Pour Notion : partager la base Contacts avec l’intégration.",
    "Enregistrer et rafraîchir la santé.",
  ],
  post_linkedin: [
    "Créer / ouvrir l’app LinkedIn Developers (OpenID Connect + Share).",
    "Coller Client ID + Secret, URI de callback exacte, puis Connecter LinkedIn.",
    "Vérifier que LINKEDIN_ACCESS_TOKEN et LINKEDIN_AUTHOR_URN sont renseignés après OAuth.",
  ],
  telegram: [
    "Créer un bot via BotFather, coller TELEGRAM_BOT_TOKEN.",
    "Envoyer un message au bot, récupérer TELEGRAM_CHAT_ID.",
    "Option HITL : TELEGRAM_HITL_BOT_TOKEN dédié pour les boutons Valider.",
  ],
  web_tools: [
    "DuckDuckGo marche sans clé. Pour la qualité : ajouter TAVILY_API_KEY (recommandé) ou BRAVE_SEARCH_API_KEY.",
    "Enregistrer dans Intégrations → Recherche web, puis rafraîchir la santé.",
  ],
};

const EXTERNAL: Record<string, { href: string; label: string }> = {
  facebook: { href: "https://developers.facebook.com/tools/explorer/", label: "Graph API Explorer" },
  instagram: { href: "https://developers.facebook.com/tools/explorer/", label: "Graph API Explorer" },
  wordpress: {
    href: "https://wordpress.org/documentation/article/application-passwords/",
    label: "Doc mot de passe d’application",
  },
  smtp: { href: "https://myaccount.google.com/apppasswords", label: "Mots de passe d’application Google" },
  google_drive: { href: "https://console.cloud.google.com/apis/library", label: "API Google Cloud" },
  google_oauth: { href: "https://console.cloud.google.com/apis/credentials", label: "Identifiants Google" },
  crm: { href: "https://www.notion.so/profile/integrations", label: "Intégrations Notion" },
  post_linkedin: { href: "https://www.linkedin.com/developers/apps", label: "Apps LinkedIn" },
  telegram: { href: "https://t.me/BotFather", label: "BotFather" },
  web_tools: { href: "https://app.tavily.com/home", label: "Clés Tavily" },
  tavily: { href: "https://app.tavily.com/home", label: "Clés Tavily" },
  youtube: { href: "https://console.cloud.google.com/apis/credentials", label: "Clé API Google" },
  whatsapp: { href: "https://developers.facebook.com/apps/", label: "Apps Meta" },
};

function detailText(row?: IntegrationRow | null): string {
  if (!row) return "";
  return String(row.probe_detail || row.note || "").trim();
}

function reasonFromDetail(id: string, detail: string, tone: HealthTone, row?: IntegrationRow | null): string {
  const d = detail.toLowerCase();
  if (/expired|session has expired|oauthexception|code.:.?190/.test(d)) {
    return "Jeton d’accès expiré ou révoqué — la publication / lecture Meta échouera jusqu’au renouvellement.";
  }
  if (/invalide|chiffres|isdigit|not a valid/.test(d) && (id === "facebook" || id === "instagram")) {
    return "Identifiant de page / compte invalide (attendu : uniquement des chiffres).";
  }
  if (/auth wordpress|rest_not_logged_in|http 401|http 403|refusée/.test(d)) {
    return "WordPress refuse l’authentification (URL, utilisateur ou mot de passe d’application).";
  }
  if (/insufficient|scope|403/.test(d) && (id === "google_drive" || id === "google_oauth" || id === "gmail")) {
    return "Le token Google n’a pas les scopes nécessaires (reconnecter OAuth après activation des API).";
  }
  if (/folder_id|dossier manquant|folder_id_set/.test(d) || (id === "google_drive" && row?.folder_id_set === false)) {
    return "Google Drive est authentifié mais aucun dossier cible (GOOGLE_DRIVE_FOLDER_ID) n’est défini.";
  }
  if (/sans notion_api_key|sans hubspot_api_key|crm_provider/.test(d)) {
    return "Un fournisseur CRM est déclaré sans la clé API correspondante.";
  }
  if (/app oauth présente|connecter linkedin/.test(d)) {
    return "L’application LinkedIn est prête, mais le compte n’est pas encore connecté (pas de token).";
  }
  if (/injoignable|reachable|timeout|econnrefused/.test(d)) {
    return "Le service réseau est injoignable depuis le serveur (hôte, port ou pare-feu).";
  }
  if (tone === "warn" && row && row.configured !== true) {
    return "Configuration incomplète : une ou plusieurs clés obligatoires manquent.";
  }
  if (detail) return detail.slice(0, 240);
  if (tone === "bad") return "La sonde a échoué — le connecteur n’est pas opérationnel.";
  return "État à corriger avant d’utiliser ce connecteur en production.";
}

export function repairGuideForConnector(id: string, row?: IntegrationRow | null): RepairGuide | null {
  const tone = row ? healthToneForIntegration(id, row) : "warn";
  if (tone === "ok" || tone === "neutral") return null;

  const detail = detailText(row);
  const reason = reasonFromDetail(id, detail, tone, row);
  const steps = DEFAULT_STEPS[id] || [
    "Ouvrir Intégrations et compléter les champs du connecteur.",
    "Enregistrer, puis revenir à Santé système et rafraîchir.",
  ];
  const ext = EXTERNAL[id];
  return {
    reason,
    steps,
    externalHref: ext?.href,
    externalLabel: ext?.label,
  };
}

export function statusBadgeClass(tone: HealthTone): string {
  if (tone === "ok") return "bg-emerald-100 text-emerald-800";
  if (tone === "warn") return "bg-amber-100 text-amber-900";
  if (tone === "bad") return "bg-red-100 text-red-800";
  return "bg-slate-100 text-slate-600";
}

export type ConnectorHealthView = {
  tone: HealthTone;
  label: string;
  row?: IntegrationRow;
  healthId?: string;
  guide: RepairGuide | null;
};

/** Agrège la santé pour une tuile annuaire (pire statut parmi les ids liés). */
export function connectorHealthForTile(
  tileId: string,
  healthMap?: Record<string, IntegrationRow> | null,
  fallback?: { tone: HealthTone; label: string },
): ConnectorHealthView {
  const ids = TILE_HEALTH_IDS[tileId] || [];
  if (!healthMap || ids.length === 0) {
    const tone = fallback?.tone || "neutral";
    return {
      tone,
      label: fallback?.label || healthStatusLabel(tone),
      guide: null,
    };
  }

  let worst: ConnectorHealthView | null = null;
  const rank: Record<HealthTone, number> = { bad: 4, warn: 3, ok: 2, neutral: 1 };
  for (const hid of ids) {
    const row = healthMap[hid];
    if (!row) continue;
    const tone = healthToneForIntegration(hid, row);
    const label = healthStatusLabel(tone, row as OperationalRow);
    const candidate: ConnectorHealthView = {
      tone,
      label,
      row,
      healthId: hid,
      guide: repairGuideForConnector(hid, row),
    };
    if (!worst || rank[tone] > rank[worst.tone]) worst = candidate;
  }

  if (worst) return worst;
  const tone = fallback?.tone || "neutral";
  return {
    tone,
    label: fallback?.label || healthStatusLabel(tone),
    guide: null,
  };
}

export function connectorHealthForId(
  healthId: string,
  healthMap?: Record<string, IntegrationRow> | null,
): ConnectorHealthView {
  const row = healthMap?.[healthId];
  if (!row) {
    return { tone: "neutral", label: "Non concerné", guide: null, healthId };
  }
  const tone = healthToneForIntegration(healthId, row);
  return {
    tone,
    label: healthStatusLabel(tone, row as OperationalRow),
    row,
    healthId,
    guide: repairGuideForConnector(healthId, row),
  };
}
