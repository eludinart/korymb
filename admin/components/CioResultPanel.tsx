"use client";

import { useMemo, useState } from "react";
import AgentMessageMarkdown from "./AgentMessageMarkdown";
import SimpleAccordion from "./SimpleAccordion";
import { splitCioSynthesisAndRoles } from "../lib/splitCioResultSections";

type Props = {
  result: string | null | undefined;
  missionTitle?: string | null;
  jobLine?: string | null;
  className?: string;
};

/**
 * Panneau principal « réponse finale » (pattern outcome-first / progressive disclosure).
 */
export default function CioResultPanel({ result, missionTitle, jobLine, className = "" }: Props) {
  const [expanded, setExpanded] = useState(false);
  const has = Boolean(result?.trim());
  const split = useMemo(() => splitCioSynthesisAndRoles(String(result || "")), [result]);

  if (!has) {
    return (
      <section
        className={`rounded-2xl border border-dashed border-violet-200/70 bg-gradient-to-b from-violet-50/50 to-slate-50/80 px-4 py-8 shadow-sm ${className}`}
        aria-label="Réponse finale du CIO"
      >
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-semibold text-slate-800">Synthèse CIO en attente</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-600">
            Dès que la mission est terminée, la <span className="font-medium text-violet-900">réponse finale</span> s&apos;affiche ici
            en premier. Utilise le fil ci-dessous pour suivre l&apos;avancement.
          </p>
        </div>
        {missionTitle ? (
          <div className="mx-auto mt-4 max-w-3xl text-left text-sm text-slate-800">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Consigne / mission</p>
            <AgentMessageMarkdown source={missionTitle} />
          </div>
        ) : null}
        {jobLine ? <p className="mt-3 text-center font-mono text-xs text-slate-500">{jobLine}</p> : null}
      </section>
    );
  }

  const maxH = expanded ? "max-h-[min(78vh,920px)]" : "max-h-[min(38vh,420px)]";

  return (
    <section
      className={`rounded-2xl border border-violet-200/90 bg-gradient-to-b from-violet-50/95 via-white to-white shadow-md ${className}`}
      aria-label="Réponse finale du CIO"
    >
      <header className="border-b border-violet-100 px-4 py-3 sm:px-5">
        <p className="text-[11px] font-bold uppercase tracking-wide text-violet-900">Réponse finale · CIO</p>
        {missionTitle ? (
          <p className="mt-2 text-xs font-medium uppercase tracking-wide text-slate-400">Demande initiale</p>
        ) : null}
        {missionTitle ? (
          <div className="mt-1 text-sm leading-snug text-slate-700">
            <AgentMessageMarkdown source={missionTitle} />
          </div>
        ) : null}
        {jobLine ? <p className="mt-2 font-mono text-[11px] text-slate-500">{jobLine}</p> : null}
      </header>
      <div className={`overflow-y-auto px-4 py-4 sm:px-5 ${maxH}`}>
        <div className="text-left text-sm leading-relaxed text-slate-800 [&_a]:text-violet-800 [&_a]:underline [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:ps-5 [&_pre]:overflow-x-auto [&_ul]:my-2 [&_ul]:list-disc [&_ul]:ps-5">
          {split.primary ? (
            <>
              {split.rolesDetail ? (
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-emerald-900/90">Synthèse & livrable</p>
              ) : null}
              <AgentMessageMarkdown source={split.primary} />
            </>
          ) : null}
          {split.rolesDetail ? (
            <SimpleAccordion
              className="mt-6 rounded-xl border border-slate-200 bg-slate-50/90 shadow-sm"
              triggerClassName="cursor-pointer rounded-t-xl px-3 py-2.5 hover:bg-slate-100/80"
              panelClassName="border-t border-slate-200 px-3 py-3"
              title="Détail par rôle (conversations dans la synthèse CIO)"
              defaultOpen={false}
            >
              <AgentMessageMarkdown source={split.rolesDetail} />
            </SimpleAccordion>
          ) : null}
        </div>
      </div>
      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-violet-100 px-3 py-2">
        <button
          type="button"
          className="rounded-lg px-2.5 py-1 text-xs font-medium text-violet-900 hover:bg-violet-50"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Réduire la hauteur" : "Agrandir la lecture"}
        </button>
      </footer>
    </section>
  );
}
