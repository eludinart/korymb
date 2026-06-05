"use client";

import type { CioJsonExecutive } from "../../lib/cioResultDisplay";
import AgentMessageMarkdown from "../AgentMessageMarkdown";

type Props = {
  executive: CioJsonExecutive;
};

function StepStatus({ completed }: { completed?: boolean }) {
  if (completed === true) {
    return (
      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800">
        Terminé
      </span>
    );
  }
  if (completed === false) {
    return (
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-900">
        En cours
      </span>
    );
  }
  return null;
}

export default function CioJsonExecutiveView({ executive }: Props) {
  const { missionName, synthesis, planSteps, delegations, recommendations, questions, operationalHighlights } =
    executive;

  return (
    <div className="space-y-4">
      {missionName ? (
        <div className="rounded-xl border border-violet-200 bg-violet-50/70 px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-violet-800">Objectif de la mission</p>
          <p className="mt-1.5 text-base font-semibold leading-snug text-slate-900">{missionName}</p>
        </div>
      ) : null}

      {synthesis ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-600">Synthèse décisionnelle</p>
          <div className="mt-2 text-[15px] leading-relaxed text-slate-800">
            <AgentMessageMarkdown source={synthesis} />
          </div>
        </div>
      ) : null}

      {operationalHighlights.length > 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50/90 px-4 py-3">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-600">Bilan opérationnel</p>
          <ul className="space-y-2">
            {operationalHighlights.map((h, i) => (
              <li key={i} className="flex gap-2 text-sm leading-snug text-slate-800">
                {h.agent ? (
                  <span className="shrink-0 rounded-md bg-slate-200/90 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-700">
                    {h.agent}
                  </span>
                ) : null}
                <span className="min-w-0 flex-1">{h.text}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {planSteps.length > 0 ? (
        <div>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-600">
            Plan d&apos;exécution — {planSteps.length} étape{planSteps.length > 1 ? "s" : ""}
          </p>
          <ol className="space-y-2.5">
            {planSteps.map((step, i) => (
              <li
                key={`${step.agent}-${i}`}
                className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-bold text-violet-800">
                    {i + 1}
                  </span>
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-700">
                    {step.agent}
                  </span>
                  <StepStatus completed={step.completed} />
                </div>
                <p className="mt-2 text-sm leading-relaxed text-slate-800">{step.task}</p>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {delegations.length > 0 && planSteps.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-600">Rôles mobilisés</p>
          <ul className="space-y-2">
            {delegations.map((d, i) => (
              <li key={`${d.agent}-${i}`} className="text-sm text-slate-800">
                <span className="font-bold text-slate-900">{d.agent}</span>
                <span className="text-slate-600"> — {d.text}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {recommendations.length > 0 ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 px-4 py-3">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-emerald-900">Suites recommandées</p>
          <ul className="list-disc space-y-1.5 ps-5 text-sm text-slate-800">
            {recommendations.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {questions.length > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50/50 px-4 py-3">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-amber-900">Questions pour la suite</p>
          <ol className="list-decimal space-y-1.5 ps-5 text-sm text-slate-800">
            {questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}
