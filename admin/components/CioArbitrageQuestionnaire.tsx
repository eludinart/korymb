"use client";

import { useEffect, useMemo, useState } from "react";
import CioAnswerResult from "./missions/CioAnswerResult";
import { CIO_FREE_CONSIGNE_QUESTION } from "../lib/cioArbitrageAnswers";

type Props = {
  questions: string[];
  savedAnswers?: Record<string, string>;
  busy?: boolean;
  onValidateAndLaunch: (answers: Array<{ question: string; answer: string }>) => Promise<void>;
};

/**
 * Questionnaire CIO : une réponse par question, un seul bouton de validation en bas
 * (évite de relancer la mission à chaque ligne).
 */
export default function CioArbitrageQuestionnaire({
  questions,
  savedAnswers = {},
  busy = false,
  onValidateAndLaunch,
}: Props) {
  const qKeys = useMemo(() => questions.map((q) => q.trim()).filter(Boolean), [questions]);

  const [drafts, setDrafts] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const q of qKeys) init[q] = savedAnswers[q] || "";
    init[CIO_FREE_CONSIGNE_QUESTION] = savedAnswers[CIO_FREE_CONSIGNE_QUESTION] || "";
    return init;
  });
  const [submitError, setSubmitError] = useState("");

  useEffect(() => {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const q of qKeys) {
        if (savedAnswers[q] && !next[q]?.trim()) next[q] = savedAnswers[q];
      }
      if (savedAnswers[CIO_FREE_CONSIGNE_QUESTION] && !next[CIO_FREE_CONSIGNE_QUESTION]?.trim()) {
        next[CIO_FREE_CONSIGNE_QUESTION] = savedAnswers[CIO_FREE_CONSIGNE_QUESTION];
      }
      return next;
    });
  }, [qKeys, savedAnswers]);

  const freeDraft = (drafts[CIO_FREE_CONSIGNE_QUESTION] || "").trim();
  const questionDrafts = qKeys.map((q) => ({ question: q, answer: (drafts[q] || "").trim() }));
  const allQuestionsFilled = qKeys.length > 0 && questionDrafts.every((r) => r.answer);
  const canLaunch = Boolean(freeDraft) || allQuestionsFilled || (qKeys.length === 0 && freeDraft);

  const filledCount = questionDrafts.filter((r) => r.answer).length;

  const setDraft = (key: string, value: string) => {
    setDrafts((prev) => ({ ...prev, [key]: value }));
  };

  const handleValidate = async () => {
    if (busy || !canLaunch) return;
    setSubmitError("");
    const payload: Array<{ question: string; answer: string }> = [];
    if (freeDraft) {
      payload.push({ question: CIO_FREE_CONSIGNE_QUESTION, answer: freeDraft });
    }
    for (const row of questionDrafts) {
      if (row.answer) payload.push(row);
    }
    // Si consigne libre seule : une seule entrée. Sinon questions (+ free si remplie).
    const toSend = freeDraft && !allQuestionsFilled && filledCount === 0
      ? [{ question: CIO_FREE_CONSIGNE_QUESTION, answer: freeDraft }]
      : freeDraft && allQuestionsFilled
        ? [...questionDrafts, { question: CIO_FREE_CONSIGNE_QUESTION, answer: freeDraft }]
        : questionDrafts.filter((r) => r.answer);

    try {
      await onValidateAndLaunch(toSend);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="space-y-3">
      {qKeys.length > 0 ? (
        <ol className="space-y-2.5">
          {qKeys.map((q, i) => {
            const saved = savedAnswers[q]?.trim();
            const value = drafts[q] ?? "";
            const answered = Boolean(saved);
            return (
              <li
                key={`${i}-${q.slice(0, 40)}`}
                className={`rounded-xl border px-3 py-3 sm:px-4 ${
                  answered || value.trim() ? "border-emerald-200 bg-emerald-50/40" : "border-amber-200 bg-white"
                }`}
              >
                <div className="flex gap-2.5">
                  <span
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold tabular-nums ${
                      answered || value.trim() ? "bg-emerald-600 text-white" : "bg-amber-500 text-white"
                    }`}
                    aria-hidden
                  >
                    {answered || value.trim() ? "✓" : i + 1}
                  </span>
                  <div className="min-w-0 flex-1 space-y-2">
                    <p className="text-sm font-semibold leading-snug text-slate-900">{q}</p>
                    {saved && !value.trim() ? <CioAnswerResult answer={saved} compact /> : null}
                    <textarea
                      value={value}
                      onChange={(e) => setDraft(q, e.target.value)}
                      disabled={busy}
                      rows={2}
                      placeholder="Oui, non, ou une autre direction…"
                      className="field-input w-full resize-y text-sm"
                    />
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}

      <div className="rounded-xl border border-dashed border-violet-300 bg-violet-50/50 px-3 py-3 sm:px-4">
        <p className="text-sm font-semibold text-violet-950">Autre consigne</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-violet-900/80">
          Les propositions ne vous conviennent pas ? Indiquez ici la direction à suivre (peut remplacer les réponses
          ci-dessus).
        </p>
        {savedAnswers[CIO_FREE_CONSIGNE_QUESTION]?.trim() && !(drafts[CIO_FREE_CONSIGNE_QUESTION] || "").trim() ? (
          <div className="mt-2">
            <CioAnswerResult answer={savedAnswers[CIO_FREE_CONSIGNE_QUESTION]} compact />
          </div>
        ) : null}
        <textarea
          value={drafts[CIO_FREE_CONSIGNE_QUESTION] || ""}
          onChange={(e) => setDraft(CIO_FREE_CONSIGNE_QUESTION, e.target.value)}
          disabled={busy}
          rows={3}
          aria-label={CIO_FREE_CONSIGNE_QUESTION}
          placeholder="Ex. : plutôt préparer un atelier à Marseille la semaine prochaine…"
          className="field-input mt-2 w-full resize-y text-sm"
        />
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-3">
        <p className="text-[11px] leading-relaxed text-amber-950">
          {qKeys.length > 0
            ? `Remplissez les ${qKeys.length} question${qKeys.length > 1 ? "s" : ""} (${filledCount}/${qKeys.length}), ou une consigne libre — puis validez une seule fois.`
            : "Indiquez votre consigne, puis validez une seule fois."}
        </p>
        <button
          type="button"
          disabled={busy || !canLaunch}
          onClick={() => void handleValidate()}
          className="btn-amber mt-2 w-full px-4 py-2.5 text-sm sm:w-auto"
        >
          {busy ? "Lancement…" : "Valider les réponses et lancer"}
        </button>
        {submitError ? (
          <p className="mt-2 text-xs font-medium text-red-700" role="alert">
            {submitError}
          </p>
        ) : null}
      </div>
    </div>
  );
}
