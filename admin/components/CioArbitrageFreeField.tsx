"use client";

import { FormEvent, useState } from "react";
import CioAnswerResult from "./missions/CioAnswerResult";
import { CIO_FREE_CONSIGNE_QUESTION } from "../lib/cioArbitrageAnswers";

type Props = {
  savedAnswer?: string;
  busy?: boolean;
  onSubmit: (answer: string) => Promise<void>;
};

export default function CioArbitrageFreeField({ savedAnswer, busy = false, onSubmit }: Props) {
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
    <div className="rounded-xl border border-dashed border-violet-300 bg-violet-50/50 px-3 py-3 sm:px-4">
      <p className="text-sm font-semibold text-violet-950">Autre consigne</p>
      <p className="mt-0.5 text-[11px] leading-relaxed text-violet-900/80">
        Les propositions ci-dessus ne vous conviennent pas ? Indiquez ici ce que vous voulez vraiment — le CIO
        suivra cette direction.
      </p>

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
            Modifier la consigne
          </button>
        </div>
      ) : (
        <form onSubmit={(e) => void handleSubmit(e)} className="mt-2 space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={busy}
            rows={3}
            aria-label={CIO_FREE_CONSIGNE_QUESTION}
            placeholder="Ex. : ne pas relancer ces contacts — plutôt préparer un atelier à Marseille la semaine prochaine…"
            className="field-input w-full resize-y text-sm"
          />
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy || !draft.trim()} className="btn-amber px-3 py-1.5 text-xs">
              {busy ? "Lancement…" : answered ? "Mettre à jour et relancer" : "Envoyer la consigne et lancer"}
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
  );
}
