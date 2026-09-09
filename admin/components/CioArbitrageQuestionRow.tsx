"use client";

import { FormEvent, useState } from "react";
import CioAnswerResult from "./missions/CioAnswerResult";

type Props = {
  index: number;
  question: string;
  savedAnswer?: string;
  busy?: boolean;
  onSubmit: (answer: string) => Promise<void>;
};

export default function CioArbitrageQuestionRow({
  index,
  question,
  savedAnswer,
  busy = false,
  onSubmit,
}: Props) {
  const [draft, setDraft] = useState(savedAnswer || "");
  const [editing, setEditing] = useState(!savedAnswer);
  const [submitError, setSubmitError] = useState("");

  const answered = Boolean(savedAnswer?.trim());

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const text = draft.trim();
    if (!text || busy) return;
    setSubmitError("");
    try {
      await onSubmit(text);
      setEditing(false);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <li
      className={`rounded-xl border px-3 py-3 sm:px-4 ${
        answered ? "border-emerald-200 bg-emerald-50/50" : "border-amber-200 bg-white"
      }`}
    >
      <div className="flex gap-2.5">
        <span
          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold tabular-nums ${
            answered ? "bg-emerald-600 text-white" : "bg-amber-500 text-white"
          }`}
          aria-hidden
        >
          {answered ? "✓" : index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug text-slate-900">{question}</p>
          {!(answered && !editing) ? (
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              Acceptez, refusez, ou indiquez une autre direction.
            </p>
          ) : null}

          {answered && !editing ? (
            <div className="mt-2">
              <CioAnswerResult answer={savedAnswer!} compact />
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setDraft(savedAnswer || "");
                  setEditing(true);
                }}
                className="mt-2 text-xs font-semibold text-violet-800 underline hover:text-violet-950 disabled:opacity-50"
              >
                Modifier la réponse
              </button>
            </div>
          ) : (
            <form onSubmit={(e) => void handleSubmit(e)} className="mt-2 space-y-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={busy}
                rows={2}
                placeholder="Oui, non, ou une autre direction…"
                className="field-input w-full resize-y text-sm"
              />
              <div className="flex flex-wrap gap-2">
                <button type="submit" disabled={busy || !draft.trim()} className="btn-amber px-3 py-1.5 text-xs">
                  {busy ? "Lancement…" : answered ? "Mettre à jour et relancer" : "Répondre et lancer"}
                </button>
                {submitError ? (
                  <p className="w-full text-xs font-medium text-red-700" role="alert">
                    {submitError}
                  </p>
                ) : null}
                {answered ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setDraft(savedAnswer || "");
                      setEditing(false);
                    }}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Annuler
                  </button>
                ) : null}
              </div>
            </form>
          )}
        </div>
      </div>
    </li>
  );
}
