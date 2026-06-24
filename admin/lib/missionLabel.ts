import { stripMarkdownLight } from "./normalizeLooseMarkdown";

/** Intitulé lisible d'une mission (consigne utilisateur), sans markdown lourd. */
export function missionTitleLabel(mission: string | null | undefined, max = 120): string {
  const clean = stripMarkdownLight(String(mission || "")).trim();
  if (!clean) return "";
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** Ligne de contexte mission : nom en premier, pas le numéro technique. */
export function missionJobLine(opts: {
  jobId: string;
  mission?: string | null;
  agent?: string | null;
  status?: string | null;
}): string {
  const title = missionTitleLabel(opts.mission, 90);
  const name = title || `Mission ${opts.jobId}`;
  const parts = [name];
  if (opts.agent) parts.push(String(opts.agent));
  if (opts.status) parts.push(String(opts.status));
  return parts.join(" · ");
}

/** Libellé pour confirmations / toasts (ex. « Programme été 2026 »). */
export function missionActionLabel(jobId: string, mission?: string | null): string {
  return missionTitleLabel(mission, 90) || `Mission ${jobId}`;
}
