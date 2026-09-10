import type { HealthTone } from "./healthTone";

export type IntegrationFieldLike = { key: string };
export type IntegrationGroupLike = {
  id: string;
  fields: IntegrationFieldLike[];
  sourceIds?: string[];
};
export type IntegrationHealthRow = {
  ok?: boolean;
  configured?: boolean;
  probe_detail?: string;
  folder_id_set?: boolean;
};

function googleFamilyTone(
  values: Record<string, unknown>,
  health?: Record<string, IntegrationHealthRow> | null,
): HealthTone {
  const row = (id: string) => health?.[id];
  const gmail = row("gmail");
  const cal = row("google_calendar");
  const sheets = row("google_sheets");
  const oauth = row("google_oauth");
  const drive = row("google_drive");
  const anyConfigured =
    gmail?.configured === true ||
    cal?.configured === true ||
    sheets?.configured === true ||
    oauth?.configured === true ||
    drive?.configured === true;
  const anyBad =
    (gmail?.configured && gmail?.ok === false) ||
    (cal?.configured && cal?.ok === false) ||
    (sheets?.configured && sheets?.ok === false) ||
    (oauth?.configured && oauth?.ok === false) ||
    (drive?.configured && drive?.ok === false);
  if (anyBad) return "bad";
  if (anyConfigured) return "ok";
  const clientSet = values.GOOGLE_OAUTH_CLIENT_ID_set === true || values.GOOGLE_OAUTH_CLIENT_SECRET_set === true;
  return clientSet ? "warn" : "neutral";
}

/**
 * Pastille d'un module Intégrations.
 * Google / Workspace : OAuth / santé réelle — pas le ratio de champs optionnels.
 */
export function integrationGroupTone(
  group: IntegrationGroupLike,
  values: Record<string, unknown>,
  health?: Record<string, IntegrationHealthRow> | null,
): HealthTone {
  const filled = group.fields.filter((f) => values[`${f.key}_set`] === true).length;
  const total = group.fields.length;
  const row = (id: string) => health?.[id];

  if (group.id === "google" || group.id === "google_workspace" || group.id === "google_oauth" || group.id === "google_drive") {
    if (group.id === "google" || group.id === "google_workspace") {
      return googleFamilyTone(values, health);
    }
    if (group.id === "google_oauth") {
      const oauth = row("google_oauth");
      if (oauth?.configured && oauth?.ok === false) return "bad";
      if (oauth?.configured) return "ok";
      return filled > 0 ? "warn" : "neutral";
    }
    const drive = row("google_drive");
    const oauth = row("google_oauth");
    if ((drive?.configured && drive?.ok === false) || (oauth?.configured && oauth?.ok === false)) {
      return "bad";
    }
    if (drive?.configured || oauth?.configured) return "ok";
    return filled > 0 ? "warn" : "neutral";
  }

  if (group.id === "creative_media") {
    if (filled === 0) return "ok"; // gratuit déjà utilisable
    if (total > 0 && filled === total) return "ok";
    return "warn";
  }

  if (total === 0) return "neutral";
  if (filled === total) return "ok";
  if (filled > 0) return "warn";
  return "neutral";
}

export function integrationGroupStatusLabel(
  group: IntegrationGroupLike,
  values: Record<string, unknown>,
  health?: Record<string, IntegrationHealthRow> | null,
): string {
  const tone = integrationGroupTone(group, values, health);
  const filled = group.fields.filter((f) => values[`${f.key}_set`] === true).length;
  const total = group.fields.length;

  if (group.id === "google" || group.id === "google_workspace") {
    if (tone === "ok") return "Connecté";
    if (tone === "bad") return "À réparer";
    if (tone === "warn") return "App OAuth prête";
    return "À connecter";
  }
  if (group.id === "creative_media") {
    if (tone === "ok" && filled === 0) return "Gratuit actif";
    return `${filled} clé${filled === 1 ? "" : "s"}`;
  }
  if (tone === "ok") return "Prêt";
  if (tone === "bad") return "À réparer";
  if (filled > 0) return "Partiel";
  return "À brancher";
}

/** Deep-link catalog id → carte UI (fusion Google / médias). */
export function resolveIntegrationCardId(groupId: string): string {
  if (groupId === "google" || groupId === "google_oauth" || groupId === "google_drive" || groupId === "google_workspace") {
    return "google";
  }
  if (groupId === "creative_media" || groupId === "media_ai" || groupId === "tts" || groupId === "video_gen") {
    return "creative_media";
  }
  return groupId;
}
