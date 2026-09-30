"use client";

import { useMemo, useState } from "react";
import type {
  ChoiceAnswerPayload,
  ChoiceQuestionnairePayload,
  ChoiceQuestion,
} from "../lib/choiceQuestionnaire";

type Props = {
  payload: ChoiceQuestionnairePayload;
  busy?: boolean;
  disabled?: boolean;
  onSubmit: (answers: ChoiceAnswerPayload) => void | Promise<void>;
  /** Affiché après validation réussie (chat / sticky). */
  answeredSummary?: string | null;
  className?: string;
};

function optionChecked(
  question: ChoiceQuestion,
  selected: Record<string, string[]>,
  optionId: string,
): boolean {
  return (selected[question.id] || []).includes(optionId);
}

function questionFilled(
  q: ChoiceQuestion,
  selected: Record<string, string[]>,
  textAnswers: Record<string, string>,
): boolean {
  if (q.selection === "text") return Boolean((textAnswers[q.id] || "").trim());
  return (selected[q.id] || []).length > 0;
}

/**
 * QCM dirigeant : cases / radios + commentaire libre + un bouton Valider.
 * Réutilisé dans le chat, les missions et Décisions.
 */
export default function ChoiceQuestionnaire({
  payload,
  busy = false,
  disabled = false,
  onSubmit,
  answeredSummary = null,
  className = "",
}: Props) {
  const [selected, setSelected] = useState<Record<string, string[]>>(() => {
    const init: Record<string, string[]> = {};
    for (const q of payload.questions) init[q.id] = [];
    return init;
  });
  const [textAnswers, setTextAnswers] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const q of payload.questions) if (q.selection === "text") init[q.id] = "";
    return init;
  });
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [triedSubmit, setTriedSubmit] = useState(false);

  const locked = busy || disabled || Boolean(answeredSummary);

  const missingLabels = useMemo(() => {
    const missing: string[] = [];
    for (const q of payload.questions) {
      if (q.required === false) continue;
      if (!questionFilled(q, selected, textAnswers)) {
        missing.push(q.prompt);
      }
    }
    if (payload.commentRequired && !comment.trim()) {
      missing.push(payload.commentLabel || "Commentaire");
    }
    return missing;
  }, [payload, selected, textAnswers, comment]);

  const canSubmit = !locked && missingLabels.length === 0;

  const toggle = (q: ChoiceQuestion, optionId: string) => {
    if (locked) return;
    setSelected((prev) => {
      const cur = prev[q.id] || [];
      if (q.selection === "single") {
        return { ...prev, [q.id]: [optionId] };
      }
      const next = cur.includes(optionId) ? cur.filter((x) => x !== optionId) : [...cur, optionId];
      return { ...prev, [q.id]: next };
    });
  };

  const handleSubmit = async () => {
    setTriedSubmit(true);
    if (!canSubmit) return;
    setError("");
    const answers: ChoiceAnswerPayload["answers"] = payload.questions.map((q) => {
      if (q.selection === "text") {
        const t = (textAnswers[q.id] || "").trim();
        return { questionId: q.id, prompt: q.prompt, selected: t ? [t] : [] };
      }
      const ids = selected[q.id] || [];
      const labels = q.options.filter((o) => ids.includes(o.id)).map((o) => o.label);
      return { questionId: q.id, prompt: q.prompt, selected: labels };
    });
    try {
      await onSubmit({ answers, comment: comment.trim() });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (answeredSummary) {
    return (
      <div
        className={`rounded-2xl border border-emerald-200 bg-emerald-50/90 px-3 py-3 dark:border-emerald-800 dark:bg-emerald-950/50 ${className}`}
      >
        <p className="text-xs font-bold uppercase tracking-wide text-emerald-900 dark:text-emerald-200">
          Réponses envoyées
        </p>
        <p className="mt-1 whitespace-pre-wrap text-sm text-emerald-950 dark:text-emerald-50">{answeredSummary}</p>
      </div>
    );
  }

  return (
    <div
      className={`rounded-2xl border border-violet-200 bg-violet-50/40 px-3 py-3 dark:border-violet-800 dark:bg-violet-950/30 sm:px-4 ${className}`}
    >
      {payload.title ? (
        <p className="mb-2 text-sm font-bold text-slate-950 dark:text-slate-50">{payload.title}</p>
      ) : (
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-violet-800 dark:text-violet-300">À cocher</p>
      )}

      <div className="space-y-3">
        {payload.questions.map((q, qi) => {
          const incomplete =
            triedSubmit && q.required !== false && !questionFilled(q, selected, textAnswers);
          return (
            <fieldset
              key={q.id}
              className={`rounded-xl border bg-white px-3 py-3 dark:bg-slate-950 ${
                incomplete
                  ? "border-amber-400 ring-2 ring-amber-200 dark:border-amber-500 dark:ring-amber-800"
                  : "border-slate-200 dark:border-slate-700"
              }`}
              disabled={locked}
            >
              <legend className="px-1 text-sm font-semibold text-slate-900 dark:text-slate-50">
                {payload.questions.length > 1 ? (
                  <span className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-violet-600 text-[10px] font-bold text-white">
                    {qi + 1}
                  </span>
                ) : null}
                {q.prompt}
                {q.required === false ? (
                  <span className="ml-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    (optionnel)
                  </span>
                ) : (
                  <span className="ml-0.5 text-violet-700 dark:text-violet-300" aria-hidden>
                    *
                  </span>
                )}
              </legend>

              {q.selection === "text" ? (
                <textarea
                  value={textAnswers[q.id] || ""}
                  onChange={(e) => setTextAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                  disabled={locked}
                  rows={2}
                  placeholder="Votre réponse…"
                  className="field-input mt-2 w-full resize-y text-sm"
                />
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {q.options.map((opt) => {
                    const checked = optionChecked(q, selected, opt.id);
                    const inputType = q.selection === "single" ? "radio" : "checkbox";
                    return (
                      <li key={opt.id}>
                        <label
                          className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 text-sm transition-colors ${
                            checked
                              ? "border-violet-400 bg-violet-50 ring-2 ring-violet-200 dark:border-violet-500 dark:bg-violet-950/60 dark:ring-violet-700"
                              : "border-slate-200 bg-slate-50/80 active:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:active:bg-slate-800"
                          } ${locked ? "cursor-not-allowed opacity-60" : ""}`}
                        >
                          <input
                            type={inputType}
                            name={q.selection === "single" ? `qcm-${q.id}` : undefined}
                            checked={checked}
                            disabled={locked}
                            onChange={() => toggle(q, opt.id)}
                            className="mt-1 h-4 w-4 shrink-0 accent-violet-700"
                          />
                          <span className="min-w-0 flex-1 font-medium leading-snug text-slate-900 dark:text-slate-100">
                            {opt.label}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </fieldset>
          );
        })}
      </div>

      <div className="mt-3">
        <label className="field-label" htmlFor={`qcm-comment-${payload.questions[0]?.id || "x"}`}>
          {payload.commentLabel || "Commentaire (optionnel)"}
          {payload.commentRequired ? (
            <span className="ml-0.5 text-violet-700 dark:text-violet-300" aria-hidden>
              *
            </span>
          ) : null}
        </label>
        <textarea
          id={`qcm-comment-${payload.questions[0]?.id || "x"}`}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          disabled={locked}
          rows={2}
          placeholder="Précision, contrainte, nuance…"
          className="field-input w-full resize-y text-sm"
        />
      </div>

      {!canSubmit && !locked && (triedSubmit || missingLabels.length > 0) ? (
        <p className="mt-2 text-xs font-medium text-amber-800 dark:text-amber-200" role="status">
          {triedSubmit
            ? `À compléter : ${missingLabels.slice(0, 3).join(" · ")}${missingLabels.length > 3 ? "…" : ""}`
            : "Répondez aux questions marquées * pour activer la validation."}
        </p>
      ) : null}

      <button
        type="button"
        disabled={locked}
        aria-disabled={!canSubmit}
        onClick={() => void handleSubmit()}
        className={`mt-3 min-h-11 w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-white sm:w-auto ${
          canSubmit
            ? "bg-violet-700 active:bg-violet-800"
            : "cursor-pointer bg-slate-500 text-white dark:bg-slate-600 dark:text-slate-100"
        } ${locked ? "cursor-not-allowed opacity-60" : ""}`}
      >
        {busy ? "Envoi…" : payload.submitLabel || "Valider et envoyer"}
      </button>
      {error ? (
        <p className="mt-2 text-xs font-medium text-red-700 dark:text-red-300" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
