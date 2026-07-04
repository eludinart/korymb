import { splitCioSynthesisAndRoles } from "./splitCioResultSections";
import type { TeamRow } from "./types";

export type ParsedDeliverable = {
  title: string;
  body: string;
};

const LIVRABLE_HEADING_RE = /^####\s+LIVRABLE\s*[—:–\-]\s*(.+)$/im;

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

function normalizeDeliverableTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[—–\-:]+/g, "-");
}

function mergeParsedDeliverables(lists: ParsedDeliverable[][]): ParsedDeliverable[] {
  const byKey = new Map<string, ParsedDeliverable>();
  for (const list of lists) {
    for (const item of list) {
      if (!item.title.trim() || !item.body.trim()) continue;
      const key = normalizeDeliverableTitle(item.title);
      const prev = byKey.get(key);
      if (!prev || item.body.length > prev.body.length) {
        byKey.set(key, item);
      }
    }
  }
  return Array.from(byKey.values());
}

/** Plusieurs pièces dans un même tour agent : `#### LIVRABLE — titre` (suffixe mission.py). */
function expandLivrableBlocksInDeliverable(item: ParsedDeliverable): ParsedDeliverable[] {
  const agentTitle = item.title.trim();
  const body = String(item.body || "").replace(/\r\n/g, "\n");
  const hasMarker = /(?:^|\n)####\s+LIVRABLE\s*[—:–\-]\s*\S/m.test(body);
  if (!hasMarker) return [item];

  const rawChunks = body.split(/(?=^####\s+LIVRABLE\s*[—:–\-]\s*.+$)/m).map((c) => c.trim());
  const chunks = rawChunks.filter((c) => c.length > 0);
  const out: ParsedDeliverable[] = [];
  let preamble = "";

  for (const chunk of chunks) {
    const hm = chunk.match(/^####\s+LIVRABLE\s*[—:–\-]\s*(.+)$/m);
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
 * Blocs `#### LIVRABLE — …` partout dans le markdown (synthèse CIO, annexe, rôles).
 * Aligné sur `parse_livrable_blocks` côté backend.
 */
export function parseLivrableBlocksFromMarkdown(md: string): ParsedDeliverable[] {
  const src = String(md || "").replace(/\r\n/g, "\n");
  const re = /^####\s+LIVRABLE\s*[—:–\-]\s*(.+)$/gim;
  const matches = [...src.matchAll(re)];
  if (!matches.length) return [];

  const out: ParsedDeliverable[] = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const title = (m[1] || "").trim();
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? src.length) : src.length;
    const body = src.slice(start, end).trim();
    if (title && body.length > 0) {
      out.push({ title, body });
    }
  }
  return out;
}

function isTableRow(line: string): boolean {
  return /^\s*\|.+\|\s*$/.test(line);
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|[\s:|\-]+\|\s*$/.test(line);
}

function inferTableTitle(lines: string[], tableStart: number, fallbackIndex: number): string {
  for (let j = tableStart - 1; j >= Math.max(0, tableStart - 3); j--) {
    const line = lines[j].trim();
    if (!line || isTableRow(line)) continue;
    const bold = line.match(/^\*\*(.+?)\*\*$/);
    if (bold) return bold[1].trim();
    const heading = line.match(/^#{1,4}\s+(.+)$/);
    if (heading) return heading[1].trim();
    if (line.length <= 120) return line.replace(/[.:]+$/, "").trim();
  }
  return `Tableau ${fallbackIndex + 1}`;
}

/** Extrait les tableaux Markdown actionnables (prospection, listes) comme livrables lisibles. */
export function extractMarkdownTableDeliverables(text: string): ParsedDeliverable[] {
  const src = String(text || "").replace(/\r\n/g, "\n");
  if (!src.trim()) return [];
  const lines = src.split("\n");
  const out: ParsedDeliverable[] = [];
  let i = 0;

  while (i < lines.length) {
    if (!isTableRow(lines[i])) {
      i++;
      continue;
    }
    const start = i;
    while (i < lines.length && isTableRow(lines[i])) i++;
    const tableLines = lines.slice(start, i);
    if (tableLines.length < 2 || !isTableSeparator(tableLines[1])) continue;

    const dataRows = tableLines.slice(2).filter((r) => r.trim());
    if (!dataRows.length) continue;

    const title = inferTableTitle(lines, start, out.length);
    out.push({ title, body: tableLines.join("\n") });
  }
  return out;
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
  if (LIVRABLE_HEADING_RE.test(body)) return [];
  return [{ title: "Synthèse & livrable CIO", body }];
}

/**
 * Tous les livrables affichables dans l'app : annexe équipe, blocs LIVRABLE, tableaux, repli synthèse.
 */
export function deliverablesForMissionPanel(md: string): ParsedDeliverable[] {
  const src = String(md || "");
  if (!src.trim()) return [];

  const fromTeam = extractTeamDeliverablesFromResult(src);
  const fromMarkers = parseLivrableBlocksFromMarkdown(src);

  let merged = mergeParsedDeliverables([fromTeam, fromMarkers]);

  if (!merged.length) {
    const { primary, rolesDetail } = splitCioSynthesisAndRoles(src);
    const tables = mergeParsedDeliverables([
      extractMarkdownTableDeliverables(primary),
      extractMarkdownTableDeliverables(rolesDetail),
      extractMarkdownTableDeliverables(src),
    ]);
    if (tables.length) merged = tables;
  }

  if (!merged.length) {
    return extractFallbackCioDeliverable(src);
  }
  return merged;
}
