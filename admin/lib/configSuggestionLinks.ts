import { hrefForConnectorId } from "./integrationConnectors";

export type ConfigSuggestionLink = { href: string; label: string; external?: boolean };

type SuggestionLike = {
  kind: string;
  target_key?: string;
  payload?: Record<string, unknown>;
};

/** Alias target_key (suffixe après `integration:`) → id de groupe du catalogue. */
const INTEGRATION_GROUP_BY_TARGET: Record<string, string> = {
  web_search: "web_search",
  read_webpage: "web_search",
  instagram: "meta_social",
  facebook: "meta_social",
  meta_webhooks: "meta_social",
  google_drive: "google",
  smtp: "email",
  send_email: "email",
  send_newsletter: "newsletter",
  image_gen: "creative_media",
  generate_image: "creative_media",
  video_gen: "creative_media",
  generate_video: "creative_media",
  tts: "creative_media",
  text_to_speech: "creative_media",
  linkedin_publish: "linkedin_publish",
  post_linkedin: "linkedin_publish",
  wordpress: "wordpress",
  telegram: "messaging",
  discord: "messaging",
  webhook: "messaging",
  pinterest: "visual_social",
  canva: "visual_social",
  paypal: "payments",
  stripe: "payments",
  crm: "crm",
  whatsapp: "whatsapp",
  youtube: "youtube",
  google_analytics: "google_analytics",
};

const INTEGRATION_GROUP_LABELS: Record<string, string> = {
  web_search: "Recherche web",
  meta_social: "Instagram & Facebook",
  email: "Email",
  newsletter: "Newsletter",
  google_drive: "Google Workspace",
  google: "Google Workspace",
  google_analytics: "Google Analytics",
  media_ai: "Médias créatifs",
  creative_media: "Médias créatifs",
  video_gen: "Médias créatifs",
  tts: "Médias créatifs",
  linkedin_publish: "LinkedIn",
  wordpress: "WordPress",
  messaging: "Messagerie (Telegram, Discord)",
  visual_social: "Canva & Pinterest",
  payments: "Paiements",
  crm: "CRM",
  whatsapp: "WhatsApp",
  youtube: "YouTube",
};

const INTEGRATION_PROVIDER_LINKS: Record<string, ConfigSuggestionLink> = {
  web_search: { href: "https://app.tavily.com/home", label: "Créer la clé chez Tavily", external: true },
  meta_social: { href: "https://developers.facebook.com/apps/", label: "Ouvrir Meta for Developers", external: true },
  email: { href: "https://myaccount.google.com/apppasswords", label: "Mot de passe d’application Gmail", external: true },
  newsletter: { href: "https://app.brevo.com/settings/keys/api", label: "Créer la clé chez Brevo", external: true },
  google_oauth: { href: "https://console.cloud.google.com/apis/credentials", label: "Identifiants Google Cloud", external: true },
  google: { href: "https://console.cloud.google.com/apis/credentials", label: "Identifiants Google Cloud", external: true },
  google_drive: { href: "https://console.cloud.google.com/apis/credentials", label: "Identifiants Google Cloud", external: true },
  google_workspace: { href: "https://console.cloud.google.com/apis/library", label: "Activer les API Google", external: true },
  wordpress: { href: "https://wordpress.org/documentation/article/application-passwords/", label: "Mot de passe d’application WP", external: true },
  google_analytics: { href: "https://analytics.google.com/analytics/web/", label: "Ouvrir Google Analytics", external: true },
  media_ai: { href: "https://pollinations.ai/", label: "Images gratuites Pollinations", external: true },
  creative_media: { href: "https://pollinations.ai/", label: "Images gratuites Pollinations", external: true },
  youtube: { href: "https://console.cloud.google.com/apis/credentials", label: "Créer une clé API Google", external: true },
  whatsapp: { href: "https://developers.facebook.com/apps/", label: "WhatsApp Cloud API", external: true },
  crm: { href: "https://www.notion.so/profile/integrations", label: "Créer l’intégration Notion", external: true },
  payments: { href: "https://dashboard.stripe.com/apikeys", label: "Clés API Stripe", external: true },
  tiime: { href: "https://www.make.com/", label: "Ouvrir Make (Tiime)", external: true },
  visual_social: { href: "https://www.canva.com/developers/integrations", label: "Canva Developers", external: true },
  messaging: { href: "https://t.me/BotFather", label: "Créer un bot Telegram", external: true },
  tts: { href: "https://elevenlabs.io/app/settings/api-keys", label: "Créer la clé chez ElevenLabs", external: true },
  linkedin_publish: { href: "https://www.linkedin.com/developers/apps", label: "Créer l’app LinkedIn", external: true },
  video_gen: { href: "https://replicate.com/account/api-tokens", label: "Créer le jeton Replicate", external: true },
};

function integrationGroupFromTarget(targetKey: string): string {
  const raw = (targetKey || "").trim();
  const suffix = raw.startsWith("integration:")
    ? raw.slice("integration:".length)
    : raw.startsWith("tool:")
      ? raw.slice("tool:".length)
      : raw;
  if (!suffix) return "";
  return INTEGRATION_GROUP_BY_TARGET[suffix] || (suffix.includes(":") ? "" : suffix);
}

function jobIdFromSuggestion(s: SuggestionLike): string {
  const fromPayload = String(s.payload?.job_id || "").trim();
  if (fromPayload) return fromPayload;
  const key = s.target_key || "";
  if (key.startsWith("job:")) return key.slice(4).trim();
  return "";
}

export function configLinksForSuggestion(s: SuggestionLike): ConfigSuggestionLink[] {
  const kind = s.kind || "misc";
  const key = s.target_key || "";

  if (kind === "integration" || key.startsWith("integration:") || key.startsWith("tool:")) {
    const suffix = (key.startsWith("integration:")
      ? key.slice("integration:".length)
      : key.startsWith("tool:")
        ? key.slice("tool:".length)
        : key
    ).trim();
    const group = integrationGroupFromTarget(key);
    const href = suffix ? hrefForConnectorId(suffix) : group
      ? `/administration/integrations?group=${encodeURIComponent(group)}`
      : "/administration/integrations";
    const name = (group && INTEGRATION_GROUP_LABELS[group]) || "Intégrations & clés";
    const links: ConfigSuggestionLink[] = [{ href, label: `Configurer ${name}` }];
    const provider = group ? INTEGRATION_PROVIDER_LINKS[group] : undefined;
    if (provider) links.push(provider);
    return links;
  }

  if (kind === "budget") {
    const links: ConfigSuggestionLink[] = [
      { href: "/administration/budget", label: "Ouvrir Budget & coûts" },
      { href: "/administration/comportements", label: "Comportements" },
    ];
    const jobId = jobIdFromSuggestion(s);
    if (jobId) {
      links.push({ href: `/missions?job=${encodeURIComponent(jobId)}`, label: "Voir la mission" });
    }
    return links;
  }

  if (kind === "orchestration") {
    return [
      { href: "/administration/orchestration", label: "Ouvrir Orchestration CIO" },
      { href: "/administration/historique", label: "Historique" },
    ];
  }

  if (kind === "llm") {
    return [
      { href: "/administration/budget", label: "Ouvrir Budget & coûts" },
      { href: "/administration/comportements", label: "Comportements" },
    ];
  }

  return [{ href: "/administration/integrations", label: "Ouvrir l’administration" }];
}
