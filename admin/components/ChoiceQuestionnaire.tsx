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

  const locked = busy || disabled || Boolean(answeredSummary);

  const canSubmit = useMemo(() => {
    if (locked) return false;
    for (const q of payload.questions) {
      if (q.required === false) continue;
      if (q.selection === "text") {
        if (!(textAnswers[q.id] || "").trim()) return false;
      } else if (!(selected[q.id] || []).length) {
        return false;
      }
    }
    if (payload.commentRequired && !comment.trim()) return false;
    return true;
  }, [locked, payload, selected, textAnswers, comment]);

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
      <div className={`rounded-2xl border border-emerald-200 bg-emerald-50/90 px-3 py-3 ${className}`}>
        <p className="text-xs font-bold uppercase tracking-wide text-emerald-900">Réponses envoyées</p>
        <p className="mt-1 whitespace-pre-wrap text-sm text-emerald-950">{answeredSummary}</p>
      </div>
    );
  }

  return (
    <div className={`rounded-2xl border border-violet-200 bg-violet-50/40 px-3 py-3 sm:px-4 ${className}`}>
      {payload.title ? (
        <p className="mb-2 text-sm font-bold text-slate-950">{payload.title}</p>
      ) : (
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-violet-800">À cocher</p>
      )}

      <div className="space-y-3">
        {payload.questions.map((q, qi) => (
          <fieldset key={q.id} className="rounded-xl border border-slate-200 bg-white px-3 py-3" disabled={locked}>
            <legend className="px-1 text-sm font-semibold text-slate-900">
              {payload.questions.length > 1 ? (
                <span className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-violet-600 text-[10px] font-bold text-white">
                  {qi + 1}
                </span>
              ) : null}
              {q.prompt}
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
                            ? "border-violet-400 bg-violet-50 ring-2 ring-violet-200"
                            : "border-slate-200 bg-slate-50/80 active:bg-slate-100"
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
                        <span className="min-w-0 flex-1 font-medium leading-snug text-slate-900">{opt.label}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </fieldset>
        ))}
      </div>

      <div className="mt-3">
        <label className="field-label" htmlFor={`qcm-comment-${payload.questions[0]?.id || "x"}`}>
          {payload.commentLabel || "Commentaire (optionnel)"}
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

      <button
        type="button"
        disabled={!canSubmit}
        onClick={() => void handleSubmit()}
        className="mt-3 min-h-11 w-full rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white active:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto"
      >
        {busy ? "Envoi…" : payload.submitLabel || "Valider et envoyer"}
      </button>
      {error ? (
        <p className="mt-2 text-xs font-medium text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
