import { buildCioDisplayModel } from "./cioResultDisplay";

/** Payload visible dans le chat — masque rôles, annexes et questions CIO longues. */
export function toChatSurface(raw: string): string {
  const model = buildCioDisplayModel(raw);
  const parts: string[] = [];

  if (model.ceoDecisionReport.trim()) {
    parts.push(model.ceoDecisionReport.trim());
  } else if (model.jsonExecutive?.synthesis?.trim()) {
    parts.push(model.jsonExecutive.synthesis.trim());
  }

  const highlights = model.operationalBilan.slice(0, 3);
  if (highlights.length && !model.ceoDecisionReport.trim()) {
    parts.push(
      "### En bref\n" +
        highlights.map((h) => `- ${h.agent ? `**${h.agent}** — ` : ""}${h.text}`).join("\n"),
    );
  }

  return parts.join("\n\n").trim() || String(raw || "").trim();
}
