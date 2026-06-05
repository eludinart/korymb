import { extractBilan, extractSynthese } from "./missionBilan";
import { splitCioSynthesisAndRoles } from "./splitCioResultSections";

export type BilanLine = { agent: string; text: string };

export type CioPlanStep = {
  agent: string;
  task: string;
  completed?: boolean;
};

export type CioJsonExecutive = {
  missionName: string;
  synthesis: string;
  planSteps: CioPlanStep[];
  delegations: BilanLine[];
  /** Puces ## BILAN OPÉRATIONNEL extraites du livrable mixte JSON + markdown. */
  operationalHighlights: BilanLine[];
  questions: string[];
  recommendations: string[];
};

export type CioDisplayModel = {
  /** Synthèse / décision du CIO — texte complet pour arbitrage métier. */
  ceoDecisionReport: string;
  /** Liste opérationnelle par agent (secondaire). */
  operationalBilan: BilanLine[];
  rolesDetail: string;
  preamble: string;
  /** Livrable JSON structuré (plan mission) — affichage dédié. */
  jsonExecutive: CioJsonExecutive | null;
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

function stripOuterCodeFence(s: string): string {
  const trimmed = s.trim();
  if (!trimmed.startsWith("```")) return s;
  const afterOpen = trimmed.replace(/^```[a-zA-Z]*\r?\n?/, "");
  const afterClose = afterOpen.replace(/\r?\n?```\s*$/, "");
  return afterClose.trim().length > 40 ? afterClose.trim() : s;
}

function tryParseJsonObject(text: string): Record<string, unknown> | null {
  const t = stripOuterCodeFence(String(text || "")).trim();
  if (!t) return null;
  const candidates = [t];
  const embedded = t.match(/\{[\s\S]*\}/);
  if (embedded?.[0] && embedded[0] !== t) candidates.push(embedded[0]);
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* next */
    }
  }
  return null;
}

function strField(obj: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function strList(obj: Record<string, unknown>, ...keys: string[]): string[] {
  for (const k of keys) {
    const v = obj[k];
    if (!Array.isArray(v)) continue;
    return v.map((x) => String(x).trim()).filter(Boolean);
  }
  return [];
}

function formatAgentLabel(agent: string): string {
  const a = agent.trim();
  if (!a) return "Équipe";
  return a.charAt(0).toUpperCase() + a.slice(1);
}

function unescapeJsonString(s: string): string {
  return s.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\").trim();
}

function extractJsonStringField(raw: string, key: string): string {
  const re = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`);
  const m = raw.match(re);
  return m ? unescapeJsonString(m[1]) : "";
}

/** Extrait un tableau JSON par clé même si le document global est invalide. */
function extractBracketedArray(raw: string, key: string): string | null {
  const keyIdx = raw.indexOf(`"${key}"`);
  if (keyIdx < 0) return null;
  const b = raw.indexOf("[", keyIdx);
  if (b < 0) return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = b; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) return raw.slice(b, i + 1);
    }
  }
  return null;
}

function mapPlanArray(plan: unknown[]): CioPlanStep[] {
  const steps: CioPlanStep[] = [];
  for (const item of plan) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const agent = formatAgentLabel(String(row.agent || row.role || row.name || ""));
    const task = String(row.task || row.description || row.mission || row.objective || "").trim();
    if (!task) continue;
    const completed =
      typeof row.completed === "boolean"
        ? row.completed
        : typeof row.status === "string"
          ? /^(done|completed|terminé|termine|ok)$/i.test(row.status)
          : undefined;
    steps.push({ agent, task, completed });
  }
  return steps;
}

function extractPlanStepsLoose(raw: string): CioPlanStep[] {
  const arr = extractBracketedArray(raw, "plan");
  if (arr) {
    try {
      const parsed = JSON.parse(arr) as unknown;
      if (Array.isArray(parsed)) return mapPlanArray(parsed);
    } catch {
      /* regex fallback */
    }
  }

  const steps: CioPlanStep[] = [];
  const re =
    /"agent"\s*:\s*"([^"]+)"\s*,\s*"task"\s*:\s*"((?:\\.|[^"\\])*)"\s*,\s*"completed"\s*:\s*(true|false)/g;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = re.exec(raw)) !== null) {
    const agent = formatAgentLabel(m[1]);
    const task = unescapeJsonString(m[2]);
    const key = `${agent}::${task}`;
    if (!task || seen.has(key)) continue;
    seen.add(key);
    steps.push({ agent, task, completed: m[3] === "true" });
    if (steps.length >= 12) break;
  }
  return steps;
}

function enrichExecutiveFromMarkdown(exec: CioJsonExecutive, raw: string): CioJsonExecutive {
  const bilanRaw = extractBilan(raw);
  const operationalHighlights = bilanRaw ? parseBilanLines(bilanRaw) : exec.operationalHighlights;
  const synthesis =
    exec.synthesis ||
    extractSynthese(raw) ||
    extractSynthesisBlock(raw).replace(/^##\s*Synthèse[^\n]*\n?/i, "").trim();

  return { ...exec, synthesis, operationalHighlights };
}

function buildExecutiveFromParsedObject(data: Record<string, unknown>): CioJsonExecutive | null {
  const missionName = strField(data, "mission_name", "mission", "title", "name");
  const synthesis = strField(
    data,
    "synthese_decisionnelle",
    "synthese",
    "synthesis",
    "synthese_attendue",
    "executive_summary",
    "summary",
    "report",
    "result",
    "content",
  );

  const planSteps = Array.isArray(data.plan) ? mapPlanArray(data.plan) : [];

  const delegations: BilanLine[] = [];
  const st = data.sous_taches;
  if (st && typeof st === "object" && !Array.isArray(st)) {
    for (const [agent, task] of Object.entries(st as Record<string, unknown>)) {
      const t = String(task || "").trim();
      if (t) delegations.push({ agent: formatAgentLabel(agent), text: t });
    }
  }

  const agents = data.agents;
  if (Array.isArray(agents) && agents.length && !planSteps.length && !delegations.length) {
    for (const a of agents) {
      const name = formatAgentLabel(String(a));
      if (name) delegations.push({ agent: name, text: "Mobilisé sur cette mission" });
    }
  }

  const questions = strList(data, "clarifying_questions", "questions", "questions_strategiques");
  const recommendations = strList(data, "recommendations", "next_steps", "suites_recommandees");

  const recognizable =
    Boolean(missionName) ||
    planSteps.length > 0 ||
    delegations.length > 0 ||
    Boolean(synthesis) ||
    questions.length > 0;

  if (!recognizable) return null;

  return {
    missionName,
    synthesis,
    planSteps,
    delegations,
    operationalHighlights: [],
    questions,
    recommendations,
  };
}

function parseCioJsonExecutiveLoose(raw: string): CioJsonExecutive | null {
  const missionName = extractJsonStringField(raw, "mission_name") || extractJsonStringField(raw, "mission");
  const planSteps = extractPlanStepsLoose(raw);
  if (!missionName && planSteps.length === 0) return null;

  return {
    missionName,
    synthesis: "",
    planSteps,
    delegations: [],
    operationalHighlights: [],
    questions: [],
    recommendations: [],
  };
}

/** Transforme un livrable JSON (mission_name + plan), y compris JSON partiel / invalide. */
export function parseCioJsonExecutive(raw: string): CioJsonExecutive | null {
  const text = String(raw || "");
  const data = tryParseJsonObject(text);
  const fromStrict = data ? buildExecutiveFromParsedObject(data) : null;
  const fromLoose = fromStrict ? null : parseCioJsonExecutiveLoose(text);
  const base = fromStrict || fromLoose;
  if (!base) return null;
  return enrichExecutiveFromMarkdown(base, text);
}

function jsonExecutiveToMarkdown(exec: CioJsonExecutive): string {
  const blocks: string[] = [];

  if (exec.synthesis) {
    blocks.push("## Synthèse décisionnelle", "", exec.synthesis, "");
  }

  if (exec.operationalHighlights.length) {
    blocks.push("## Bilan opérationnel", "");
    for (const h of exec.operationalHighlights) {
      blocks.push(h.agent ? `- **${h.agent}** : ${h.text}` : `- ${h.text}`);
    }
    blocks.push("");
  }

  if (exec.planSteps.length) {
    blocks.push("## Ce que l'équipe a exécuté", "");
    for (const step of exec.planSteps) {
      const status =
        step.completed === true ? " *(terminé)*" : step.completed === false ? " *(en cours)*" : "";
      blocks.push(`### ${step.agent}${status}`, "", step.task, "");
    }
  }

  if (exec.delegations.length) {
    blocks.push("## Délégation par rôle", "");
    for (const d of exec.delegations) {
      blocks.push(`- **${d.agent}** : ${d.text}`);
    }
    blocks.push("");
  }

  if (exec.recommendations.length) {
    blocks.push("## Suites recommandées", "");
    for (const r of exec.recommendations) {
      blocks.push(`- ${r}`);
    }
    blocks.push("");
  }

  if (exec.questions.length) {
    blocks.push("## Questions pour la suite", "");
    exec.questions.forEach((q, i) => blocks.push(`${i + 1}. ${q}`));
  }

  return blocks.join("\n").trim();
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
  const jsonExecutive = parseCioJsonExecutive(raw);
  if (jsonExecutive) {
    const operationalBilan: BilanLine[] =
      jsonExecutive.operationalHighlights.length > 0
        ? jsonExecutive.operationalHighlights
        : [
            ...jsonExecutive.planSteps.map((s) => ({ agent: s.agent, text: s.task })),
            ...jsonExecutive.delegations,
          ];
    return {
      ceoDecisionReport: jsonExecutiveToMarkdown(jsonExecutive),
      operationalBilan,
      rolesDetail: "",
      preamble: "",
      jsonExecutive,
    };
  }

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
    jsonExecutive: null,
  };
}
