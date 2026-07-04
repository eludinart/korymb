import type { HealthTone } from "./healthTone";

export type IntegrationRow = Record<string, unknown>;

const INTEGRATION_LABELS: Record<string, string> = {
  llm_mistral:     "LLM — Mistral",
  llm_openrouter:  "LLM — OpenRouter",
  llm_anthropic:   "LLM — Anthropic",
  google_oauth:    "Google OAuth / API",
  google_drive:    "Google Drive",
  facebook:        "Facebook (lecture + publication)",
  instagram:       "Instagram (lecture + publication)",
  smtp:            "SMTP (e-mail)",
  fleur_db:        "Base Fleur (MySQL)",
  tavily:          "Tavily AI Search",
  brave_search:    "Brave Search",
  jina_reader:     "Jina AI Reader (pages JS)",
  brevo:           "Brevo (newsletter)",
  deepl:           "DeepL (traduction)",
  image_gen:       "Génération d'images",
  gmail:           "Gmail API",
  google_calendar: "Google Calendar",
  google_sheets:   "Google Sheets",
  google_analytics: "Google Analytics (GA4)",
  meta_webhooks:   "Webhooks Meta (commentaires)",
  youtube:         "YouTube Data API",
  whatsapp:        "WhatsApp Business",
  crm:             "CRM (Notion / HubSpot)",
  stripe:          "Stripe (revenus)",
  paypal:          "PayPal",
  canva:           "Canva Autofill",
  pinterest:       "Pinterest",
  discord:         "Discord",
  telegram:        "Telegram",
  korymb_webhook:  "Webhook sortant (n8n/Zapier)",
  text_to_speech:  "Synthèse vocale (TTS)",
  web_tools:       "Recherche web (chaîne providers)",
};

export function integrationDisplayName(id: string): string {
  return INTEGRATION_LABELS[id] || id.replace(/_/g, " ");
}

function asBool(v: unknown): boolean | undefined {
  if (v === true || v === false) return v;
  return undefined;
}

export type OperationalRow = {
  configured?: boolean;
  ok?: boolean;
  reachable?: boolean;
};

/**
 * Pastilles santé — sémantique unifiée :
 * - vert (ok) : service opérationnel (clé présente + sonde OK si disponible)
 * - orange (warn) : clé API manquante ou configuration incomplète
 * - rouge (bad) : panne confirmée (sonde KO, service inaccessible)
 */
export function healthToneForOperationalStatus(
  row: OperationalRow,
  opts?: { worksWithoutKey?: boolean },
): HealthTone {
  const configured = asBool(row.configured) === true;
  const ok = asBool(row.ok);
  const reachable = asBool(row.reachable);

  if (opts?.worksWithoutKey) {
    if (ok === false || reachable === false) return "bad";
    return "ok";
  }

  if (!configured) return "warn";

  if (reachable === false) return "bad";
  if (ok === false) return "warn";
  if (reachable === true || ok === true) return "ok";

  return "warn";
}

/** Sonde outil (section « état en direct »). */
export function healthToneForToolProbe(
  row: OperationalRow | undefined,
  opts?: { worksWithoutKey?: boolean },
): HealthTone {
  if (!row) return opts?.worksWithoutKey ? "ok" : "warn";
  return healthToneForOperationalStatus(row, opts);
}

/** Déduit une tonalité pour la pastille santé à partir du bloc renvoyé par `/admin/system-health`. */
export function healthToneForIntegration(id: string, row: IntegrationRow): HealthTone {
  const configured = asBool(row.configured) === true;
  const providerSelected = asBool(row.provider_selected) === true;
  const ok = asBool(row.ok);
  const reachable = asBool(row.reachable);

  if (id === "web_tools") {
    if (ok === true) return "ok";
    if (ok === false) return "bad";
    return "warn";
  }

  if (id === "jina_reader") {
    if (ok === true) return "ok";
    if (ok === false) return "bad";
    return "warn";
  }

  if (id.startsWith("llm_")) {
    if (!providerSelected) return "neutral";
    if (!configured) return "warn";
    if (ok === false || reachable === false) return "bad";
    return "ok";
  }

  if (id === "google_drive") {
    const folder = asBool(row.folder_id_set) === true;
    if (!configured) return "warn";
    if (reachable === false) return "bad";
    if (reachable === true && folder) return "ok";
    if (reachable === true && !folder) return "warn";
    if (ok === true && folder) return "ok";
    if (ok === false) return "warn";
    return "warn";
  }

  if (id === "smtp" || id === "fleur_db") {
    return healthToneForOperationalStatus({
      configured,
      ok,
      reachable,
    });
  }

  return healthToneForOperationalStatus({
    configured,
    ok,
    reachable,
  });
}

export function healthStatusLabel(tone: HealthTone): string {
  if (tone === "ok") return "Opérationnel";
  if (tone === "warn") return "Clé manquante";
  if (tone === "bad") return "Indisponible";
  return "Non concerné";
}

/** Priorité pour le tri : indisponible > clé manquante > opérationnel > non concerné. */
export const HEALTH_TONE_RANK: Record<HealthTone, number> = {
  bad: 4,
  warn: 3,
  ok: 2,
  neutral: 1,
};

export type StatusSortOrder = "name" | "status-desc" | "status-asc";

export function compareByStatusThenName(
  toneA: HealthTone,
  toneB: HealthTone,
  nameA: string,
  nameB: string,
  order: StatusSortOrder,
): number {
  if (order === "name") return nameA.localeCompare(nameB, "fr");
  const diff =
    order === "status-desc"
      ? HEALTH_TONE_RANK[toneB] - HEALTH_TONE_RANK[toneA]
      : HEALTH_TONE_RANK[toneA] - HEALTH_TONE_RANK[toneB];
  if (diff !== 0) return diff;
  return nameA.localeCompare(nameB, "fr");
}

export function healthToneForCpuPercent(p: number | null | undefined): HealthTone {
  if (p == null || Number.isNaN(p)) return "neutral";
  if (p >= 90) return "bad";
  if (p >= 70) return "warn";
  return "ok";
}

export function healthToneForMemoryPercent(p: number | null | undefined): HealthTone {
  if (p == null || Number.isNaN(p)) return "neutral";
  if (p >= 92) return "bad";
  if (p >= 80) return "warn";
  return "ok";
}

export function healthToneForDiskPercent(p: number | null | undefined): HealthTone {
  if (p == null || Number.isNaN(p)) return "neutral";
  if (p >= 95) return "bad";
  if (p >= 85) return "warn";
  return "ok";
}
