import type { HealthTone } from "./healthTone";

export type IntegrationRow = Record<string, unknown>;

const INTEGRATION_LABELS: Record<string, string> = {
  llm_openrouter:  "LLM — OpenRouter",
  llm_anthropic:   "LLM — Anthropic",
  google_oauth:    "Google OAuth / API",
  google_drive:    "Google Drive",
  facebook:        "Facebook (lecture + publication)",
  instagram:       "Instagram (lecture + publication)",
  smtp:            "SMTP (e-mail)",
  fleur_db:        "Base Fleur (MySQL)",
  // Recherche & lecture
  tavily:          "Tavily AI Search",
  brave_search:    "Brave Search",
  jina_reader:     "Jina AI Reader (pages JS)",
  web_tools:       "Recherche web (chaîne providers)",
};

export function integrationDisplayName(id: string): string {
  return INTEGRATION_LABELS[id] || id.replace(/_/g, " ");
}

function asBool(v: unknown): boolean | undefined {
  if (v === true || v === false) return v;
  return undefined;
}

/** Déduit une tonalité pour la pastille santé à partir du bloc renvoyé par `/admin/system-health`. */
export function healthToneForIntegration(id: string, row: IntegrationRow): HealthTone {
  const configured = asBool(row.configured) === true;
  const providerSelected = asBool(row.provider_selected) === true;
  const ok = asBool(row.ok);
  const reachable = row.reachable;

  if (id === "web_tools") {
    if (ok === true) return "ok";
    if (ok === false) return "bad";
    return "neutral";
  }

  if (id === "jina_reader") {
    if (ok === true) return "ok";
    if (ok === false) return "bad";
    return "neutral";
  }

  // Tavily et Brave : optionnels, neutre si non configurés, ok si configurés
  if (id === "tavily" || id === "brave_search") {
    if (!configured) return "neutral";
    return "ok";
  }

  if (id.startsWith("llm_")) {
    if (providerSelected && configured) return "ok";
    if (providerSelected && !configured) return "bad";
    if (configured && !providerSelected) return "warn";
    return "neutral";
  }

  if (id === "google_drive") {
    const folder = asBool(row.folder_id_set) === true;
    if (!configured) return "neutral";
    if (configured && folder) return "ok";
    return "warn";
  }

  if (id === "smtp") {
    if (!configured) return "neutral";
    if (reachable === true) return "ok";
    if (reachable === false) return "bad";
    return "warn";
  }

  if (id === "fleur_db") {
    if (!configured) return "neutral";
    if (reachable === true) return "ok";
    if (reachable === false) return "bad";
    return "warn";
  }

  if (configured) return "ok";
  return "neutral";
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
