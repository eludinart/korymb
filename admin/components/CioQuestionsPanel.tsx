"use client";

import { FormEvent, useState } from "react";

type CioQuestion = {
  eventId?: string;
  questions: string[];
  missionPreview?: string;
  answered?: boolean;
};

type Props = {
  questions: CioQuestion[];
  onAnswer: (answer: string) => Promise<void>;
  busy?: boolean;
};

export default function CioQuestionsPanel({ questions, onAnswer, busy = false }: Props) {
  const [input, setInput] = useState("");
  const [sent, setSent] = useState(false);

  // Collect all unanswered questions across events
  const pending = questions.filter((q) => !q.answered);
  const allQuestions = pending.flatMap((q) => q.questions);

  if (allQuestions.length === 0) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || busy) return;
    await onAnswer(input.trim());
    setInput("");
    setSent(true);
  };

  return (
    <div className="overflow-hidden rounded-2xl border-2 border-amber-300 bg-white shadow-md">
      {/* Header */}
      <div className="flex items-center gap-2 bg-amber-500 px-4 py-2.5">
        <span className="text-base">❓</span>
        <p className="text-sm font-bold text-white">Le CIO a besoin de précisions</p>
        <span className="ml-auto rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-semibold text-white">
          Mission en cours en parallèle
        </span>
      </div>

      <div className="space-y-3 p-4">
        {/* Questions */}
        <ul className="space-y-2">
          {allQuestions.map((q, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-0.5 shrink-0 text-[11px] font-bold text-amber-600">{i + 1}.</span>
              <p className="text-[12px] leading-snug text-slate-700">{q}</p>
            </li>
          ))}
        </ul>

        {sent ? (
          <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-[11px] text-emerald-700">
            <span>✓</span>
            <span>Réponse transmise au CIO. Vous pouvez envoyer d&apos;autres précisions via le chat.</span>
          </div>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Votre réponse au CIO…"
              disabled={busy}
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-200 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="shrink-0 rounded-lg bg-amber-500 px-3 py-2 text-[11px] font-semibold text-white hover:bg-amber-600 disabled:opacity-40"
            >
              {busy ? "Envoi…" : "Répondre"}
            </button>
          </form>
        )}

        <p className="text-[10px] text-slate-400">
          La mission s&apos;exécute en arrière-plan. Vos réponses enrichissent la synthèse finale du CIO.
        </p>
      </div>
    </div>
  );
}
