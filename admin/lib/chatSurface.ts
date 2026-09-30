import { buildCioDisplayModel, type CioJsonExecutive } from "./cioResultDisplay";

function stripChatQuestionBlocks(text: string): string {
  return String(text || "")
    .replace(/^##\s*Questions pour la suite\s*\n(?:\s*\d+\.\s+.+\n?)*/gim, "")
    .replace(/^(?:#{1,3}\s*)?Questions pour la suite\s*\n(?:\s*\d+\.\s+.+\n?)*/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function executiveToChatMarkdown(exec: CioJsonExecutive): string {
  const blocks: string[] = [];
  if (exec.missionName?.trim()) {
    blocks.push(`## ${exec.missionName.trim()}`, "");
  }
  if (exec.synthesis?.trim()) {
    blocks.push("## Synthèse", "", exec.synthesis.trim(), "");
  }
  if (exec.planSteps.length) {
    blocks.push("## Plan", "");
    for (const step of exec.planSteps.slice(0, 8)) {
      blocks.push(`- **${step.agent}** : ${step.task}`);
    }
    blocks.push("");
  }
  if (exec.delegations.length) {
    blocks.push("## Délégation", "");
    for (const d of exec.delegations.slice(0, 8)) {
      blocks.push(`- **${d.agent}** : ${d.text}`);
    }
    blocks.push("");
  }
  if (exec.recommendations.length) {
    blocks.push("## Suites recommandées", "");
    for (const r of exec.recommendations.slice(0, 8)) {
      blocks.push(`- ${r}`);
    }
    blocks.push("");
  }
  // Intentionnel : pas de « Questions pour la suite » en surface chat.
  return blocks.join("\n").trim();
}

/** Payload visible dans le chat — masque rôles, annexes et questions CIO / QCM non sollicités. */
export function toChatSurface(raw: string): string {
  if (String(raw || "").includes("[[korymb-degraded]]")) {
    return String(raw).trim();
  }
  const model = buildCioDisplayModel(raw);
  const parts: string[] = [];

  if (model.jsonExecutive) {
    const fromExec = executiveToChatMarkdown(model.jsonExecutive);
    if (fromExec.trim()) {
      parts.push(fromExec.trim());
    }
  } else if (model.ceoDecisionReport.trim()) {
    parts.push(stripChatQuestionBlocks(model.ceoDecisionReport.trim()));
  }

  const highlights = model.operationalBilan.slice(0, 3);
  if (highlights.length && !parts.length) {
    parts.push(
      "### En bref\n" +
        highlights.map((h) => `- ${h.agent ? `**${h.agent}** — ` : ""}${h.text}`).join("\n"),
    );
  }

  const joined = parts.join("\n\n").trim();
  const cleaned = stripChatQuestionBlocks(joined);
  if (cleaned) return cleaned;
  return stripChatQuestionBlocks(String(raw || "").trim()) || String(raw || "").trim();
}
