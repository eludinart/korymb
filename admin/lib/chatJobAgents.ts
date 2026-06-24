import { agentHeaders, requestJson } from "./api";
import { normalizeTeamRows } from "./jobTeam";
import type { DriveArtifact } from "./types";

export type ChatJobDelivery = {
  surface: string;
  jobId: string;
  driveArtifacts: DriveArtifact[];
  deliverablesMarkdown: string;
};

/** Extrait l'id job d'un message chat (`a-xxx`, `ack-xxx`, `e-xxx`). */
export function extractJobIdFromMessageId(messageId: string): string | null {
  const m = messageId.match(/^(?:a|ack|e)-([a-f0-9-]+)$/i);
  return m?.[1] || null;
}

/** Agents mobilisés sur un job chat (équipe + événements de délégation). */
export async function fetchJobAgentKeys(jobId: string): Promise<string[]> {
  const { data } = await requestJson(`/jobs/${encodeURIComponent(jobId)}?log_offset=0&events_offset=0`, {
    headers: agentHeaders(),
    retries: 1,
  });
  const keys = new Set<string>();

  for (const row of normalizeTeamRows(data.team)) {
    const k = String(row.key || "").trim();
    if (k) keys.add(k);
  }

  const events = (data.events || []) as Array<{ type?: string; agent?: string; payload?: { to?: unknown } }>;
  for (const ev of events) {
    const actor = String(ev.agent || "").trim();
    if (actor) keys.add(actor);
    if (ev.type === "delegation" && Array.isArray(ev.payload?.to)) {
      for (const a of ev.payload.to as string[]) {
        if (a) keys.add(String(a));
      }
    }
  }

  keys.delete("");
  return [...keys];
}

/** Résultat chat + livrables Drive pour affichage sous la bulle. */
export async function fetchChatJobDelivery(jobId: string): Promise<ChatJobDelivery> {
  const { data } = await requestJson(`/jobs/${encodeURIComponent(jobId)}?log_offset=0&events_offset=0`, {
    headers: agentHeaders(),
    retries: 1,
  });
  const surface = String(data.result_surface || data.result || "");
  const raw = String(data.result || "");
  return {
    surface,
    jobId,
    driveArtifacts: (data.drive_artifacts || []) as DriveArtifact[],
    deliverablesMarkdown: raw,
  };
}
