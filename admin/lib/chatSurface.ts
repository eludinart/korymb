import { buildCioDisplayModel, type CioJsonExecutive } from "./cioResultDisplay";

const QCM_FENCE_RE = /```korymb-qcm\s*\n([\s\S]*?)```/i;

function stripChatQuestionBlocks(text: string): string {
  return String(text || "")
    .replace(/^##\s*Questions pour la suite\s*\n(?:\s*\d+\.\s+.+\n?)*/gim, "")
    .replace(/^(?:#{1,3}\s*)?Questions pour la suite\s*\n(?:\s*\d+\.\s+.+\n?)*/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractQcmFences(text: string): { body: string; fences: string[] } {
  const fences: string[] = [];
  const body = String(text || "").replace(/```korymb-qcm\s*\n[\s\S]*?```/gi, (m) => {
    fences.push(m);
    return "\n";
  });
  return { body: body.trim(), fences };
}

function promoteNumberedQuestionsToQcm(text: string): string {
  const raw = String(text || "");
  if (QCM_FENCE_RE.test(raw)) return raw;
  const m = raw.match(
    /^(?:#{1,3}\s*)?Questions pour la suite\s*\n((?:\s*\d+\.\s+.+\n?)+)/im,
  );
  if (!m?.[1]) return raw;
  const prompts = [...m[1].matchAll(/^\s*\d+\.\s+(.+)$/gm)]
    .map((x) => String(x[1] || "").trim())
    .filter(Boolean)
    .slice(0, 8);
  if (!prompts.length) return raw;

  const questions = prompts.map((prompt, i) => {
    const single = /1\s*seul|un\s*seul|priorit[eé]\s+absolue/i.test(prompt);
    return {
      id: `q-${i + 1}`,
      prompt,
      selection: single ? "single" : "multi",
      options: single
        ? [
            { id: "opt-a", label: "Option A — préciser en commentaire" },
            { id: "opt-b", label: "Option B — préciser en commentaire" },
            { id: "opt-c", label: "Autre (commentaire)" },
          ]
        : [
            { id: "yes", label: "Oui, traiter" },
            { id: "later", label: "Plus tard" },
            { id: "no", label: "Non / ignorer" },
          ],
    };
  });
  const payload = {
    title: "Questionnaire",
    questions,
    comment_label: "Commentaire (optionnel)",
  };
  const fence = "```korymb-qcm\n" + JSON.stringify(payload, null, 2) + "\n```";
  const intro = stripChatQuestionBlocks(raw);
  return intro ? `${intro}\n\n${fence}` : fence;
}

function executiveToChatMarkdown(
  exec: CioJsonExecutive,
  opts?: { withQuestionsAsQcm?: boolean },
): string {
  const withQuestionsAsQcm = Boolean(opts?.withQuestionsAsQcm);
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
  if (withQuestionsAsQcm && exec.questions.length) {
    const payload = {
      title: exec.missionName?.trim() || "Questionnaire",
      questions: exec.questions.slice(0, 8).map((prompt, i) => {
        const single = /1\s*seul|un\s*seul|priorit[eé]\s+absolue/i.test(prompt);
        return {
          id: `q-${i + 1}`,
          prompt,
          selection: single ? "single" : "multi",
          options: single
            ? [
                { id: "opt-a", label: "Option A — préciser en commentaire" },
                { id: "opt-b", label: "Option B — préciser en commentaire" },
                { id: "opt-c", label: "Autre (commentaire)" },
              ]
            : [
                { id: "yes", label: "Oui, traiter" },
                { id: "later", label: "Plus tard" },
                { id: "no", label: "Non / ignorer" },
              ],
        };
      }),
      comment_label: "Commentaire (optionnel)",
    };
    blocks.push("```korymb-qcm", JSON.stringify(payload, null, 2), "```");
  }
  return blocks.join("\n").trim();
}

/** Payload visible dans le chat — masque rôles / annexes ; préserve ou promeut les QCM. */
export function toChatSurface(raw: string): string {
  if (String(raw || "").includes("[[korymb-degraded]]")) {
    return String(raw).trim();
  }
  const original = String(raw || "");
  const { body, fences } = extractQcmFences(original);
  const hasQcmAlready = fences.length > 0;
  const wantsQcmShape =
    hasQcmAlready ||
    /Questions pour la suite/i.test(original) ||
    /"clarifying_questions"\s*:/i.test(original);

  const model = buildCioDisplayModel(body || original);
  const parts: string[] = [];

  if (model.jsonExecutive) {
    const fromExec = executiveToChatMarkdown(model.jsonExecutive, {
      withQuestionsAsQcm: wantsQcmShape && !hasQcmAlready,
    });
    if (fromExec.trim()) parts.push(fromExec.trim());
  } else if (model.ceoDecisionReport.trim()) {
    const report = wantsQcmShape
      ? promoteNumberedQuestionsToQcm(model.ceoDecisionReport.trim())
      : stripChatQuestionBlocks(model.ceoDecisionReport.trim());
    if (report) parts.push(report);
  }

  const highlights = model.operationalBilan.slice(0, 3);
  if (highlights.length && !parts.length) {
    parts.push(
      "### En bref\n" +
        highlights.map((h) => `- ${h.agent ? `**${h.agent}** — ` : ""}${h.text}`).join("\n"),
    );
  }

  let joined = parts.join("\n\n").trim();
  if (!wantsQcmShape) {
    joined = stripChatQuestionBlocks(joined);
  } else if (!hasQcmAlready) {
    joined = promoteNumberedQuestionsToQcm(joined || original);
  }

  if (fences.length) {
    const withoutDup = joined.replace(/```korymb-qcm\s*\n[\s\S]*?```/gi, "").trim();
    joined = [withoutDup, ...fences].filter(Boolean).join("\n\n").trim();
  }

  if (joined) return joined;
  return wantsQcmShape ? promoteNumberedQuestionsToQcm(original) : stripChatQuestionBlocks(original) || original.trim();
}
