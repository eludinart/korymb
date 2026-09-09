"use client";

import CioArbitrageQuestionnaire from "./CioArbitrageQuestionnaire";
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
  onValidateAndLaunch: (answers: Array<{ question: string; answer: string }>) => Promise<void>;
  busy?: boolean;
};

export default function CioQuestionsPanel({
  questions,
  questionAnswers = {},
  onValidateAndLaunch,
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
          {pendingCount > 0 ? `${pendingCount} en attente` : "Réponses enregistrées"}
        </span>
      </div>

      <div className="space-y-3 p-4">
        <CioArbitrageQuestionnaire
          questions={allQuestions}
          savedAnswers={questionAnswers}
          busy={busy}
          onValidateAndLaunch={onValidateAndLaunch}
        />
      </div>
    </div>
  );
}
