"use client";

import { useMemo } from "react";
import ChoiceQuestionnaire from "./ChoiceQuestionnaire";
import { CIO_FREE_CONSIGNE_QUESTION } from "../lib/cioArbitrageAnswers";
import type { ChoiceQuestionnairePayload, QuestionSpecMap } from "../lib/choiceQuestionnaire";

type Props = {
  questions: string[];
  /** Options QCM indexées par libellé exact de question (missions / Décisions). */
  questionSpecs?: QuestionSpecMap;
  savedAnswers?: Record<string, string>;
  busy?: boolean;
  onValidateAndLaunch: (answers: Array<{ question: string; answer: string }>) => Promise<void>;
};

/**
 * Questionnaire CIO unifié : cases si options, sinon texte ; commentaire ; un Valider.
 */
export default function CioArbitrageQuestionnaire({
  questions,
  questionSpecs = {},
  savedAnswers = {},
  busy = false,
  onValidateAndLaunch,
}: Props) {
  const payload = useMemo((): ChoiceQuestionnairePayload => {
    const qKeys = questions.map((q) => q.trim()).filter(Boolean);
    return {
      title: qKeys.some((q) => (questionSpecs[q]?.options || []).length)
        ? "À cocher / préciser"
        : "Précisions demandées",
      submitLabel: "Valider les réponses et lancer",
      commentLabel: "Commentaire ou autre consigne (optionnel)",
      questions: qKeys.map((prompt, i) => {
        const spec = questionSpecs[prompt];
        const options = spec?.options || [];
        if (options.length) {
          return {
            id: `cio-${i}`,
            prompt,
            selection: spec?.selection === "single" ? "single" : "multi",
            options,
            required: true,
          };
        }
        return {
          id: `cio-${i}`,
          prompt,
          selection: "text" as const,
          options: [],
          required: true,
        };
      }),
    };
  }, [questions, questionSpecs]);

  const answeredSummary = useMemo(() => {
    if (!payload.questions.length) return null;
    const lines = payload.questions
      .map((q) => {
        const a = savedAnswers[q.prompt]?.trim();
        return a ? `- ${q.prompt} → ${a}` : null;
      })
      .filter(Boolean);
    if (lines.length < payload.questions.length) return null;
    const free = savedAnswers[CIO_FREE_CONSIGNE_QUESTION]?.trim();
    if (free) lines.push(`Commentaire : ${free}`);
    return lines.join("\n");
  }, [payload.questions, savedAnswers]);

  if (!payload.questions.length) {
    return (
      <ChoiceQuestionnaire
        payload={{
          title: "Consigne",
          submitLabel: "Valider et lancer",
          commentLabel: "Votre consigne",
          commentRequired: true,
          questions: [],
        }}
        busy={busy}
        onSubmit={async (answers) => {
          const comment = answers.comment.trim();
          if (!comment) return;
          await onValidateAndLaunch([{ question: CIO_FREE_CONSIGNE_QUESTION, answer: comment }]);
        }}
      />
    );
  }

  return (
    <ChoiceQuestionnaire
      payload={payload}
      busy={busy}
      answeredSummary={answeredSummary}
      onSubmit={async (answers) => {
        const rows: Array<{ question: string; answer: string }> = answers.answers
          .map((a) => ({
            question: a.prompt,
            answer: a.selected.join(", ").trim(),
          }))
          .filter((r) => r.answer);
        if (answers.comment.trim()) {
          rows.push({ question: CIO_FREE_CONSIGNE_QUESTION, answer: answers.comment.trim() });
        }
        if (!rows.length) return;
        await onValidateAndLaunch(rows);
      }}
    />
  );
}
