import type { HealthTone } from "./healthTone";
import { healthToneForToolProbe } from "./integrationHealth";

export type ToolProbeRowData = {
  key: string;
  title: string;
  tone: HealthTone;
  description: string;
  providerBadge?: string;
  webChain?: { tavily: boolean; brave: boolean };
};

export function buildToolProbeRows(toolsProbe: Record<string, unknown>): ToolProbeRowData[] {
  const ws = toolsProbe.web_search as {
    ok?: boolean;
    provider?: string;
    providers_configured?: Record<string, boolean>;
  } | undefined;
  const provs = ws?.providers_configured ?? {};
  const rp = toolsProbe.read_webpage as { ok?: boolean; provider?: string } | undefined;
  const gd = toolsProbe.google_drive as {
    ok?: boolean;
    configured?: boolean;
    folder_id_set?: boolean;
  } | undefined;

  const rows: ToolProbeRowData[] = [
    {
      key: "web_search",
      title: "Recherche web",
      tone: healthToneForToolProbe(ws, { worksWithoutKey: true }),
      description: "Chaîne Tavily → Brave → DuckDuckGo",
      providerBadge: ws?.ok ? String(ws.provider ?? "") : undefined,
      webChain: { tavily: Boolean(provs.tavily), brave: Boolean(provs.brave) },
    },
    {
      key: "read_webpage",
      title: "Lecture de pages (JS + HTML)",
      tone: healthToneForToolProbe(rp, { worksWithoutKey: true }),
      description: "Jina AI Reader (sans clé) → httpx direct · 8 000 caractères",
      providerBadge: rp?.ok ? String(rp.provider ?? "") : undefined,
    },
    {
      key: "describe_image",
      title: "Analyse d'images (Vision)",
      tone: healthToneForToolProbe(toolsProbe.describe_image as { ok?: boolean; configured?: boolean }),
      description: "Claude Haiku Vision via ANTHROPIC_API_KEY · décrit photos, posts, visuels",
    },
    {
      key: "instagram",
      title: "Instagram",
      tone: healthToneForToolProbe(toolsProbe.instagram as { ok?: boolean; configured?: boolean }),
      description: "Lecture des médias + publication · INSTAGRAM_ACCESS_TOKEN + ACCOUNT_ID",
    },
    {
      key: "facebook",
      title: "Facebook",
      tone: healthToneForToolProbe(toolsProbe.facebook as { ok?: boolean; configured?: boolean }),
      description: "Lecture des posts + publication · FACEBOOK_ACCESS_TOKEN + PAGE_ID",
    },
    {
      key: "search_linkedin",
      title: "Recherche LinkedIn",
      tone: healthToneForToolProbe(ws, { worksWithoutKey: true }),
      description: "Profils + entreprises via moteur web ciblé · sans clé LinkedIn",
    },
    {
      key: "send_email",
      title: "Email SMTP",
      tone: healthToneForToolProbe(toolsProbe.send_email as { ok?: boolean; configured?: boolean }),
      description: "Prospection unitaire · SMTP_HOST + USER + PASS",
    },
    {
      key: "google_drive",
      title: "Google Drive",
      tone: healthToneForToolProbe({
        configured: gd?.configured,
        ok: gd?.configured && gd?.folder_id_set ? gd?.ok : undefined,
      }),
      description: "Livrables · OAuth ou token API + GOOGLE_DRIVE_FOLDER_ID",
    },
    {
      key: "insights",
      title: "Insights Instagram / Facebook",
      tone: healthToneForToolProbe({
        configured: Boolean(
          (toolsProbe.get_instagram_insights as { configured?: boolean })?.configured ||
            (toolsProbe.get_facebook_insights as { configured?: boolean })?.configured,
        ),
        ok: Boolean(
          (toolsProbe.get_instagram_insights as { ok?: boolean })?.ok ||
            (toolsProbe.get_facebook_insights as { ok?: boolean })?.ok,
        ),
      }),
      description: "Métriques reach, impressions, engagement via Graph API",
    },
    {
      key: "schedule_social",
      title: "Planification posts",
      tone: healthToneForToolProbe(toolsProbe.schedule_social as { ok?: boolean; configured?: boolean }),
      description: "Posts IG/FB programmés · tokens Meta requis",
    },
    {
      key: "generate_image",
      title: "Génération d'images",
      tone: healthToneForToolProbe(toolsProbe.generate_image as { ok?: boolean; configured?: boolean }),
      description: "IMAGE_GEN_MODEL + clé API (OpenRouter ou dédiée)",
    },
    {
      key: "read_pdf",
      title: "Lecture PDF",
      tone: healthToneForToolProbe({ ok: true }, { worksWithoutKey: true }),
      description: "Extraction texte depuis URL publique · pypdf",
    },
    {
      key: "monitor_rss",
      title: "Veille RSS / Atom",
      tone: healthToneForToolProbe({ ok: true }, { worksWithoutKey: true }),
      description: "Flux d'actualités · feedparser · sans clé",
    },
    {
      key: "send_newsletter",
      title: "Newsletter Brevo",
      tone: healthToneForToolProbe(toolsProbe.send_newsletter as { ok?: boolean; configured?: boolean }),
      description: "Campagnes email marketing · BREVO_API_KEY",
    },
    {
      key: "translate_text",
      title: "Traduction DeepL",
      tone: healthToneForToolProbe(toolsProbe.translate_text as { ok?: boolean; configured?: boolean }),
      description: "Contenus multilingues · DEEPL_API_KEY",
    },
  ];

  for (const [key, title, description] of [
    ["gmail", "Gmail API", "Envoi et lecture emails Google"],
    ["google_calendar", "Google Calendar", "Agenda et RDV"],
    ["google_sheets", "Google Sheets", "Exports tableaux et leads"],
    ["google_analytics", "Google Analytics", "Métriques trafic GA4"],
    ["meta_webhooks", "Webhooks Meta", "Commentaires FB/IG automatiques"],
    ["youtube", "YouTube", "Recherche vidéos et stats chaîne"],
    ["whatsapp", "WhatsApp Business", "Messages clients"],
    ["crm", "CRM", "Notion ou HubSpot"],
    ["stripe", "Stripe", "Revenus paiements"],
    ["paypal", "PayPal", "Solde compte"],
    ["canva", "Canva", "Visuels brandés"],
    ["pinterest", "Pinterest", "Épingles visuelles"],
    ["discord", "Discord", "Notifications équipe"],
    ["telegram", "Telegram", "Bot messagerie"],
    ["webhook", "Webhook sortant", "n8n · Zapier · Make"],
    ["text_to_speech", "Synthèse vocale", "MP3 OpenAI ou ElevenLabs"],
  ] as const) {
    const row = toolsProbe[key] as { ok?: boolean; configured?: boolean } | undefined;
    rows.push({
      key,
      title,
      tone: healthToneForToolProbe(row),
      description,
    });
  }

  return rows;
}
