import { extractBilan, extractSynthese } from "./missionBilan";
import { splitCioSynthesisAndRoles } from "./splitCioResultSections";

export type BilanLine = { agent: string; text: string };

export type CioDisplayModel = {
  /** Synthèse / décision du CIO — texte complet pour arbitrage métier. */
  ceoDecisionReport: string;
  /** Liste opérationnelle par agent (secondaire). */
  operationalBilan: BilanLine[];
  rolesDetail: string;
  preamble: string;
};

const PREAMBLE_RE =
  /^(?:voici la note|conformément à tes directives|optimisée pour être injectée|source de vérité|core_source)/i;

const META_HEADING_RE = /^#+\s*CORE_SOURCE/i;

/** Parse les lignes type `[Commercial] * …` du bilan opérationnel. */
export function parseBilanLines(text: string): BilanLine[] {
  const items: BilanLine[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const tagged = line.match(/^\[([^\]]+)\]\s*(?:[*•\-]\s*)?(.*)$/);
    if (tagged) {
      const body = (tagged[2] || "").trim();
      if (body) items.push({ agent: tagged[1].trim(), text: body });
      continue;
    }
    const bullet = line.match(/^[*•\-]\s+(.+)$/);
    if (bullet) {
      const agentMatch = bullet[1].match(/^\[([^\]]+)\]\s*(.*)$/);
      if (agentMatch) {
        items.push({ agent: agentMatch[1].trim(), text: (agentMatch[2] || "").trim() });
      } else {
        items.push({ agent: "", text: bullet[1].trim() });
      }
    }
  }
  return items;
}

function stripBilanBlock(text: string): string {
  return text
    .replace(/##\s*BILAN\s*[A-ZÀÉÈÊËÎÏÔÙÛÜ\s]+\n[\s\S]*?(?=\n##\s|\n#\s[^#]|$)/gi, "")
    .replace(/^BILAN\s*[A-ZÀÉÈÊËÎÏÔÙÛÜ\s]*[\n:][\s\S]*?(?=\n##\s|\n#\s|$)/im, "")
    .trim();
}

function splitPreamble(body: string): { preamble: string; rest: string } {
  const lines = body.split("\n");
  const preambleLines: string[] = [];
  const restLines: string[] = [];
  let pastPreamble = false;

  for (const line of lines) {
    const t = line.trim();
    if (!pastPreamble) {
      if (!t) {
        if (preambleLines.length) preambleLines.push(line);
        continue;
      }
      if (META_HEADING_RE.test(t) || PREAMBLE_RE.test(t)) {
        preambleLines.push(line);
        continue;
      }
      if (/^##\s+/.test(t) || /^#\s+/.test(t)) {
        pastPreamble = true;
        restLines.push(line);
        continue;
      }
      if (preambleLines.length && t.length < 120 && !t.startsWith("*") && !t.startsWith("-")) {
        preambleLines.push(line);
        continue;
      }
      pastPreamble = true;
    }
    restLines.push(line);
  }

  return {
    preamble: preambleLines.join("\n").trim(),
    rest: restLines.join("\n").trim(),
  };
}

/** Extrait le bloc « Synthèse décisionnelle » avec son titre pour lecture décisionnelle. */
function extractSynthesisBlock(text: string): string {
  const m = text.match(
    /(##\s*Synthèse(?:\s+décisionnelle)?[\s\S]*?)(?=\n##\s+BILAN|\n##\s+Réponses\s+des\s+rôles|\n##\s+QUESTIONS|$)/i,
  );
  if (m?.[1]?.trim() && m[1].trim().length > 80) return m[1].trim();
  return "";
}

/** Structure le markdown CIO : décision CIO complète en premier, bilan agents en annexe. */
export function buildCioDisplayModel(raw: string): CioDisplayModel {
  const split = splitCioSynthesisAndRoles(String(raw || ""));
  const bilanRaw = extractBilan(raw) || extractBilan(split.primary);
  const operationalBilan = bilanRaw ? parseBilanLines(bilanRaw) : [];

  const syntheseSection =
    extractSynthesisBlock(raw) ||
    extractSynthesisBlock(split.primary) ||
    extractSynthese(raw) ||
    extractSynthese(split.primary);

  let bodyForCeo = stripBilanBlock(split.primary);
  const { preamble, rest } = splitPreamble(bodyForCeo);
  bodyForCeo = rest || bodyForCeo;

  let ceoDecisionReport = (syntheseSection || stripBilanBlock(bodyForCeo) || bodyForCeo).trim();

  if (!ceoDecisionReport && split.primary) {
    ceoDecisionReport = stripBilanBlock(split.primary).trim();
  }

  return {
    ceoDecisionReport,
    operationalBilan,
    rolesDetail: split.rolesDetail,
    preamble,
  };
}
