import { buildCioDisplayModel } from "./cioResultDisplay";
import {
  extractBilan,
  extractCioStrategicQuestions,
  extractSynthese,
  firstNLines,
} from "./missionBilan";

export type MissionExecutiveBriefModel = {
  missionName: string;
  /** Cœur décisionnel — ce que le dirigeant doit retenir. */
  synthesis: string;
  recommendations: string[];
  questions: string[];
  alerts: string[];
};

/** Assez long pour une liste (ex. 5 fiches concurrents), sans noyer le dirigeant. */
const EXEC_SYNTHESIS_MAX = 12_000;

/**
 * Synthèse pour le bandeau dirigeant.
 * Ne pas utiliser extractShortSummary (limité à 5 lignes) : ça coupe les listes numériques.
 */
function fallbackExecutiveSynthesis(raw: string): string {
  const bilan = extractBilan(raw);
  if (bilan && bilan.trim().length > 40) {
    const t = bilan.trim();
    return t.length > EXEC_SYNTHESIS_MAX ? `${t.slice(0, EXEC_SYNTHESIS_MAX - 1)}…` : t;
  }

  const synthese = extractSynthese(raw);
  if (synthese && synthese.trim().length > 40) {
    const t = synthese.trim();
    return t.length > EXEC_SYNTHESIS_MAX ? `${t.slice(0, EXEC_SYNTHESIS_MAX - 1)}…` : t;
  }

  const intro = raw.match(/^([\s\S]*?)(?=\n##\s|\n---\s*\n##|$)/)?.[1]?.trim();
  if (intro && intro.length > 40) {
    return intro.length > EXEC_SYNTHESIS_MAX ? `${intro.slice(0, EXEC_SYNTHESIS_MAX - 1)}…` : intro;
  }

  const generous = firstNLines(raw, 120).trim();
  if (generous.length > 40) {
    return generous.length > EXEC_SYNTHESIS_MAX
      ? `${generous.slice(0, EXEC_SYNTHESIS_MAX - 1)}…`
      : generous;
  }
  return "";
}

function parseListItems(text: string): string[] {
  const items: string[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const numbered = t.match(/^\d+\.\s+(.+)$/);
    const bullet = t.match(/^[-*•]\s+(.+)$/);
    const body = numbered?.[1] || bullet?.[1];
    if (body && body.length > 5) items.push(body.trim());
  }
  return items;
}

function resolveSynthesis(raw: string): { missionName: string; synthesis: string } {
  const model = buildCioDisplayModel(raw);
  const exec = model.jsonExecutive;

  if (exec?.synthesis?.trim()) {
    return { missionName: exec.missionName, synthesis: exec.synthesis.trim() };
  }

  const syntheseMd = extractSynthese(raw);
  if (syntheseMd?.trim()) {
    return { missionName: exec?.missionName || "", synthesis: syntheseMd.trim() };
  }

  const ceo = model.ceoDecisionReport.trim();
  if (ceo) {
    const synBlock = ceo.match(/##[^\n]*Synthèse[^\n]*\n([\s\S]*?)(?=\n##\s|$)/i);
    if (synBlock?.[1]?.trim() && synBlock[1].trim().length > 40) {
      return { missionName: exec?.missionName || "", synthesis: synBlock[1].trim() };
    }
    const verbosePlan =
      ceo.includes("## Ce que l'équipe") ||
      ceo.includes("## Plan") ||
      ceo.includes("## Délégation") ||
      (exec?.planSteps.length ?? 0) > 0;
    if (verbosePlan) {
      const name = exec?.missionName || "";
      if (name) {
        return {
          missionName: name,
          synthesis: `Mission « ${name} » — livrable disponible. Les arbitrages et suites recommandées sont listés ci-dessous.`,
        };
      }
      return { missionName: "", synthesis: "" };
    }
    if (ceo.length > 40 && ceo.length <= EXEC_SYNTHESIS_MAX) {
      return { missionName: exec?.missionName || "", synthesis: ceo };
    }
    if (ceo.length > EXEC_SYNTHESIS_MAX) {
      const fallback = fallbackExecutiveSynthesis(raw);
      if (fallback) {
        return { missionName: exec?.missionName || "", synthesis: fallback };
      }
    }
  }

  const fallback = fallbackExecutiveSynthesis(raw);
  if (fallback) {
    return { missionName: exec?.missionName || "", synthesis: fallback };
  }

  return { missionName: exec?.missionName || "", synthesis: "" };
}

/** Extrait uniquement l'essentiel décisionnel d'un livrable CIO. */
export function buildMissionExecutiveBrief(
  result: string | null | undefined,
  opts?: { deliveryWarnings?: string[]; deliveryBlocked?: boolean },
): MissionExecutiveBriefModel | null {
  const raw = String(result || "").trim();
  if (!raw) return null;

  const model = buildCioDisplayModel(raw);
  const exec = model.jsonExecutive;
  const { missionName, synthesis } = resolveSynthesis(raw);

  let questions = exec?.questions ?? [];
  if (!questions.length) {
    const qBlock = extractCioStrategicQuestions(raw);
    if (qBlock) questions = parseListItems(qBlock);
  }

  const recommendations = exec?.recommendations ?? [];

  const alerts = [...(opts?.deliveryWarnings ?? [])];
  if (opts?.deliveryBlocked) {
    alerts.unshift("Livraison bloquée — vérifiez les alertes avant de valider.");
  }

  const hasContent =
    Boolean(synthesis.trim()) || questions.length > 0 || recommendations.length > 0 || alerts.length > 0;

  if (!hasContent) return null;

  return {
    missionName,
    synthesis,
    recommendations,
    questions,
    alerts,
  };
}
