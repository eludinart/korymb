"use client";

import CioArbitrageQuestionRow from "./CioArbitrageQuestionRow";
import { countPendingArbitrageQuestions } from "../lib/cioArbitrageAnswers";

type CioQuestion = {
  eventId?: string;
  questions: string[];
  missionPreview?: string;
  answered?: boolean;
};

type Props = {
  questions: CioQuestion[];
  questionAnswers?: Record<string, string>;
  onAnswer: (question: string, answer: string) => Promise<void>;
  busy?: boolean;
};

export default function CioQuestionsPanel({
  questions,
  questionAnswers = {},
  onAnswer,
  busy = false,
}: Props) {
  const pending = questions.filter((q) => !q.answered);
  const allQuestions = pending.flatMap((q) => q.questions);

  if (allQuestions.length === 0) return null;

  const pendingCount = countPendingArbitrageQuestions(allQuestions, questionAnswers);

  return (
    <div className="overflow-hidden rounded-2xl border-2 border-amber-300 bg-white shadow-md">
      <div className="flex items-center gap-2 bg-amber-500 px-4 py-2.5">
        <span className="text-base">❓</span>
        <p className="text-sm font-bold text-white">Le CIO a besoin de précisions</p>
        <span className="ml-auto rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-semibold text-white">
          {pendingCount > 0
            ? `${pendingCount} en attente`
            : "Mission en cours en parallèle"}
        </span>
      </div>

      <div className="space-y-3 p-4">
        <ol className="space-y-2.5">
          {allQuestions.map((q, i) => (
            <CioArbitrageQuestionRow
              key={`${i}-${q.slice(0, 40)}`}
              index={i}
              question={q}
              savedAnswer={questionAnswers[q.trim()]}
              busy={busy}
              onSubmit={(answer) => onAnswer(q, answer)}
            />
          ))}
        </ol>

        <p className="text-[10px] text-slate-400">
          La mission s&apos;exécute en arrière-plan. Répondez question par question — chaque arbitrage enrichit la
          synthèse finale du CIO.
        </p>
      </div>
    </div>
  );
}
