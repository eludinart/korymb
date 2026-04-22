import { splitCioSynthesisAndRoles } from "./splitCioResultSections";
import type { TeamRow } from "./types";

export type ParsedDeliverable = {
  title: string;
  body: string;
};

/** Repère la clé agent à partir du titre ### (libellé ou clé), y compris « Commercial — … ». */
export function matchDeliverableTitleToAgentKey(title: string, team: TeamRow[]): string | undefined {
  const full = title.trim().toLowerCase();
  const head = title
    .split(/\s+[—–-]\s+/)[0]
    ?.trim()
    .toLowerCase();
  const candidates = [full, head].filter(Boolean) as string[];
  for (const t of candidates) {
    for (const row of team) {
      const lab = String(row.label || "").trim().toLowerCase();
      const key = String(row.key || "").trim().toLowerCase();
      if (key && key === t) return String(row.key);
      if (lab && lab === t) return String(row.key);
    }
  }
  return undefined;
}

/** Plusieurs pièces dans un même tour agent : `#### LIVRABLE — titre` (suffixe mission.py). */
function expandLivrableBlocksInDeliverable(item: ParsedDeliverable): ParsedDeliverable[] {
  const agentTitle = item.title.trim();
  const body = String(item.body || "").replace(/\r\n/g, "\n");
  const hasMarker = /(?:^|\n)####\s+LIVRABLE\s*[—:–-]\s*\S/m.test(body);
  if (!hasMarker) return [item];

  const rawChunks = body.split(/(?=^####\s+LIVRABLE\s*[—:–-]\s*.+$)/m).map((c) => c.trim());
  const chunks = rawChunks.filter((c) => c.length > 0);
  const out: ParsedDeliverable[] = [];
  let preamble = "";

  for (const chunk of chunks) {
    const hm = chunk.match(/^####\s+LIVRABLE\s*[—:–-]\s*(.+)$/m);
    if (!hm) {
      preamble = chunk;
      continue;
    }
    const livTitle = hm[1].trim();
    const afterHeader = chunk.slice((hm.index ?? 0) + hm[0].length).trim();
    const combined = [preamble, afterHeader].filter(Boolean).join("\n\n").trim();
    preamble = "";
    out.push({ title: `${agentTitle} — ${livTitle}`, body: combined || afterHeader });
  }

  return out.length ? out : [item];
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
    if (h) {
      const one = { title: h[1].trim(), body: h[2].trim() };
      out.push(...expandLivrableBlocksInDeliverable(one));
    }
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

export function deliverablesForMissionPanel(md: string, _team: TeamRow[]): ParsedDeliverable[] {
  const fromTeam = extractTeamDeliverablesFromResult(md);
  if (fromTeam.length) return fromTeam;
  // Même avec des sous-agents : si l'annexe « Livrables bruts de l'équipe » est absente,
  // on expose au moins la synthèse CIO (export / notes) au lieu d'un panneau vide.
  const fallback = extractFallbackCioDeliverable(md);
  if (fallback.length) return fallback;
  return [];
}
