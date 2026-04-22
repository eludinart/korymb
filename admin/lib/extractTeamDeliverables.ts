import { splitCioSynthesisAndRoles } from "./splitCioResultSections";
import type { TeamRow } from "./types";

export type ParsedDeliverable = {
  title: string;
  body: string;
};

/** Repère la clé agent à partir du titre ### (libellé ou clé). */
export function matchDeliverableTitleToAgentKey(title: string, team: TeamRow[]): string | undefined {
  const t = title.trim().toLowerCase();
  for (const row of team) {
    const lab = String(row.label || "").trim().toLowerCase();
    const key = String(row.key || "").trim().toLowerCase();
    if (key && key === t) return String(row.key);
    if (lab && lab === t) return String(row.key);
  }
  return undefined;
}

/**
 * Extrait les blocs « ## Livrables bruts de l'équipe » (annexe générée par le backend).
 */
export function extractTeamDeliverablesFromResult(md: string): ParsedDeliverable[] {
  const src = String(md || "").replace(/\r\n/g, "\n");
  const m = src.match(/##\s*Livrables\s+bruts\s+de\s+l[''']équipe\s*([\s\S]*)/i);
  if (!m) return [];
  const block = m[1].trim();
  const parts = block.split(/(?=^###\s+)/m).map((p) => p.trim()).filter(Boolean);
  const out: ParsedDeliverable[] = [];
  for (const p of parts) {
    const h = p.match(/^###\s+(.+?)\s*\n+([\s\S]*)$/m);
    if (h) out.push({ title: h[1].trim(), body: h[2].trim() });
  }
  return out;
}

/** Si pas d'annexe équipe : propose le corps principal de la synthèse CIO comme livrable unique. */
export function extractFallbackCioDeliverable(md: string): ParsedDeliverable[] {
  const src = String(md || "").trim();
  if (!src) return [];
  const { primary } = splitCioSynthesisAndRoles(src);
  const body = (primary || src).trim();
  if (body.length < 80) return [];
  return [{ title: "Synthèse & livrable CIO", body }];
}

export function deliverablesForMissionPanel(md: string, team: TeamRow[]): ParsedDeliverable[] {
  const fromTeam = extractTeamDeliverablesFromResult(md);
  if (fromTeam.length) return fromTeam;
  const subs = team.filter((r) => r.key && r.key !== "coordinateur");
  if (subs.length === 0 && md.trim().length > 0) return extractFallbackCioDeliverable(md);
  return [];
}
