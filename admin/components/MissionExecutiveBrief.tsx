"use client";

import { useMemo } from "react";
import AgentMessageMarkdown from "./AgentMessageMarkdown";
import CioArbitrageQuestionRow from "./CioArbitrageQuestionRow";
import { countPendingArbitrageQuestions } from "../lib/cioArbitrageAnswers";
import { buildMissionExecutiveBrief } from "../lib/missionExecutiveBrief";

type Props = {
  result: string | null | undefined;
  status?: string;
  deliveryWarnings?: string[];
  deliveryBlocked?: boolean;
  className?: string;
  jobId?: string;
  questionAnswers?: Record<string, string>;
  onAnswerQuestion?: (question: string, answer: string) => Promise<void>;
  answerBusy?: boolean;
};

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  completed: { label: "Terminée", className: "bg-emerald-100 text-emerald-900" },
  running: { label: "En cours", className: "bg-violet-100 text-violet-900" },
  awaiting_validation: { label: "À valider", className: "bg-amber-100 text-amber-900" },
  error: { label: "Erreur", className: "bg-red-100 text-red-900" },
  cancelled: { label: "Annulée", className: "bg-slate-100 text-slate-600" },
};

function statusChip(status?: string) {
  const key = String(status || "").toLowerCase();
  const hit = STATUS_LABELS[key] || (key.startsWith("error") ? STATUS_LABELS.error : undefined);
  if (!hit) return null;
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${hit.className}`}>
      {hit.label}
    </span>
  );
}

/**
 * Vue dirigeant : synthèse, arbitrages et suites — sans le détail agent par agent.
 */
export default function MissionExecutiveBrief({
  result,
  status,
  deliveryWarnings,
  deliveryBlocked,
  className = "",
  jobId,
  questionAnswers = {},
  onAnswerQuestion,
  answerBusy = false,
}: Props) {
  const brief = useMemo(
    () => buildMissionExecutiveBrief(result, { deliveryWarnings, deliveryBlocked }),
    [result, deliveryWarnings, deliveryBlocked],
  );

  const pendingCount = useMemo(
    () => (brief ? countPendingArbitrageQuestions(brief.questions, questionAnswers) : 0),
    [brief, questionAnswers],
  );

  if (!brief) {
    return (
      <div
        className={`rounded-2xl border border-dashed border-violet-200 bg-violet-50/40 px-5 py-8 text-center ${className}`}
        aria-label="Synthèse mission"
      >
        <p className="text-sm font-semibold text-slate-800">Synthèse en attente</p>
        <p className="mt-1 text-xs leading-relaxed text-slate-600">
          Dès la fin de la mission, l&apos;essentiel décisionnel apparaît ici.
        </p>
      </div>
    );
  }

  const chip = statusChip(status);
  const canAnswer = Boolean(jobId && onAnswerQuestion);

  return (
    <article
      className={`overflow-hidden rounded-2xl border-2 border-violet-200 bg-white shadow-md ${className}`}
      aria-label="Essentiel de la mission"
    >
      {brief.alerts.length > 0 ? (
        <div className="border-b border-amber-200 bg-amber-50 px-5 py-3">
          {brief.alerts.map((a, i) => (
            <p key={i} className="text-sm font-medium text-amber-950">
              ⚠ {a}
            </p>
          ))}
        </div>
      ) : null}

      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-violet-100 bg-gradient-to-br from-violet-50/80 to-white px-5 py-4">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-violet-800">À retenir pour décider</p>
          {brief.missionName ? (
            <h2 className="mt-1 text-lg font-bold leading-snug text-slate-900">{brief.missionName}</h2>
          ) : null}
        </div>
        {chip}
      </header>

      {brief.synthesis ? (
        <div className="border-b border-slate-100 px-5 py-5">
          <div className="text-[15px] leading-relaxed text-slate-800 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-bold [&_h2]:mb-1.5 [&_h2]:mt-3 [&_h2]:text-[15px] [&_h2]:font-semibold [&_li]:my-1.5 [&_p]:my-2 [&_strong]:text-slate-900">
            <AgentMessageMarkdown source={brief.synthesis} />
          </div>
        </div>
      ) : null}

      {brief.recommendations.length > 0 ? (
        <section className="border-b border-emerald-100 bg-emerald-50/50 px-5 py-4" aria-label="Prochaines actions">
          <p className="mb-2.5 text-[10px] font-bold uppercase tracking-wider text-emerald-900">Prochaines actions</p>
          <ul className="space-y-2">
            {brief.recommendations.map((r, i) => (
              <li key={i} className="flex gap-2.5 text-sm leading-snug text-slate-800">
                <span
                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-bold text-white"
                  aria-hidden
                >
                  →
                </span>
                <span className="min-w-0 flex-1 pt-0.5">{r}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {brief.questions.length > 0 ? (
        <section className="bg-amber-50/40 px-5 py-4" aria-label="Arbitrages attendus">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-amber-900">
              Arbitrages attendus
            </p>
            {canAnswer ? (
              <span className="rounded-full bg-amber-200/80 px-2 py-0.5 text-[10px] font-bold text-amber-950">
                {pendingCount > 0
                  ? `${pendingCount} réponse${pendingCount > 1 ? "s" : ""} en attente`
                  : "Toutes les réponses sont enregistrées"}
              </span>
            ) : (
              <span className="text-[10px] font-medium text-amber-800/80">
                Répondez question par question ci-dessous
              </span>
            )}
          </div>
          {canAnswer ? (
            <ol className="space-y-2.5">
              {brief.questions.map((q, i) => (
                <CioArbitrageQuestionRow
                  key={`${i}-${q.slice(0, 40)}`}
                  index={i}
                  question={q}
                  savedAnswer={questionAnswers[q.trim()]}
                  busy={answerBusy}
                  onSubmit={(answer) => onAnswerQuestion!(q, answer)}
                />
              ))}
            </ol>
          ) : (
            <ol className="space-y-2.5">
              {brief.questions.map((q, i) => (
                <li key={i} className="flex gap-2.5 text-sm leading-snug text-slate-800">
                  <span
                    className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white tabular-nums"
                    aria-hidden
                  >
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 pt-0.5">{q}</span>
                </li>
              ))}
            </ol>
          )}
          {canAnswer ? (
            <p className="mt-3 text-[11px] leading-relaxed text-amber-900/80">
              Chaque réponse est enregistrée sur le fil CIO de la mission — vous pouvez traiter les arbitrages dans
              l&apos;ordre qui vous convient.
            </p>
          ) : null}
        </section>
      ) : null}
    </article>
  );
}
