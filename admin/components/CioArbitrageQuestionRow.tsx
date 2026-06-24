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

  const answered = Boolean(savedAnswer?.trim());

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    await onSubmit(text);
    setEditing(false);
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
                placeholder="Votre arbitrage pour cette question…"
                className="field-input w-full resize-y text-sm"
              />
              <div className="flex flex-wrap gap-2">
                <button type="submit" disabled={busy || !draft.trim()} className="btn-amber px-3 py-1.5 text-xs">
                  {busy ? "Envoi…" : answered ? "Mettre à jour" : "Répondre"}
                </button>
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
