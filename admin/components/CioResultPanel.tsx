"use client";

import { useMemo } from "react";
import AgentMessageMarkdown from "./AgentMessageMarkdown";
import SimpleAccordion from "./SimpleAccordion";
import CioJsonExecutiveView from "./missions/CioJsonExecutiveView";
import { buildCioDisplayModel } from "../lib/cioResultDisplay";

type Props = {
  result: string | null | undefined;
  missionTitle?: string | null;
  jobLine?: string | null;
  className?: string;
  /** Dans {@link ExpandableMissionReader} : pas de bordure externe ni d’en-tête de section. */
  embedded?: boolean;
};

const proseDecision =
  "text-[15px] leading-relaxed text-slate-800 [&_h1]:mb-2 [&_h1]:mt-0 [&_h1]:text-lg [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-sm [&_li]:my-1.5 [&_p]:my-2.5";

const proseDetail =
  "text-sm leading-relaxed text-slate-700 [&_a]:text-violet-800 [&_a]:underline [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:ps-5 [&_pre]:overflow-x-auto [&_ul]:my-2 [&_ul]:list-disc [&_ul]:ps-5";

function BilanAgentList({ items }: { items: { agent: string; text: string }[] }) {
  if (!items.length) return null;
  return (
    <ul className="space-y-2.5">
      {items.map((item, i) => (
        <li key={`${item.agent}-${i}`} className="flex gap-2 text-sm leading-snug text-slate-800">
          {item.agent ? (
            <span className="shrink-0 rounded-md bg-slate-200/80 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-700">
              {item.agent}
            </span>
          ) : null}
          <span className="min-w-0 flex-1 pt-0.5">{item.text}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Panneau « réponse finale » : décision CIO complète (résumé exécutif) → bilan agents → détail technique.
 */
export default function CioResultPanel({
  result,
  missionTitle,
  jobLine,
  className = "",
  embedded = false,
}: Props) {
  const has = Boolean(result?.trim());
  const model = useMemo(() => buildCioDisplayModel(String(result || "")), [result]);

  const hasJsonExecutive = Boolean(model.jsonExecutive);
  const looksLikeRawJson =
    Boolean(result?.trim().startsWith("{")) && Boolean(result?.includes('"mission_name"') || result?.includes('"plan"'));
  const hasCeoDecision =
    hasJsonExecutive ||
    looksLikeRawJson ||
    (Boolean(model.ceoDecisionReport.trim()) && model.ceoDecisionReport.length > 40);
  const hasBilan = model.operationalBilan.length > 0;
  const hasDetail = Boolean(model.rolesDetail.trim()) || Boolean(model.preamble.trim());

  if (!has) {
    return (
      <section
        className={`rounded-2xl border border-dashed border-violet-200/70 bg-gradient-to-b from-violet-50/50 to-slate-50/80 px-4 py-8 shadow-sm ${className}`}
        aria-label="Réponse finale du CIO"
      >
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-semibold text-slate-800">Synthèse CIO en attente</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-600">
            La réponse complète du CIO pour décision apparaîtra ici dès la fin de la mission.
          </p>
        </div>
        {missionTitle ? (
          <SimpleAccordion
            title="Demande initiale"
            hint="Consigne de départ"
            defaultOpen={false}
            className="mx-auto mt-4 max-w-3xl rounded-xl border border-slate-200 bg-white"
            triggerClassName="px-3 py-2.5"
            panelClassName="max-h-48 overflow-y-auto border-t border-slate-100 px-3 py-3 text-sm text-slate-700"
          >
            <AgentMessageMarkdown source={missionTitle} className="text-sm [&_p]:my-1.5" />
          </SimpleAccordion>
        ) : null}
        {jobLine ? <p className="mt-3 text-center font-mono text-xs text-slate-500">{jobLine}</p> : null}
      </section>
    );
  }

  const shellClass = embedded
    ? `overflow-hidden ${className}`
    : `rounded-2xl border border-violet-200/90 bg-gradient-to-b from-violet-50/30 via-white to-white shadow-md ${className}`;

  return (
    <section className={shellClass} aria-label="Réponse finale du CIO">
      {!embedded ? (
        <header className="border-b border-violet-100 px-4 py-3 sm:px-5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-violet-900">Réponse finale · CIO</p>
          {jobLine ? <p className="mt-1 font-mono text-[11px] text-slate-500">{jobLine}</p> : null}
        </header>
      ) : jobLine ? (
        <p className="px-4 pt-1 font-mono text-[10px] text-slate-500 sm:px-5">{jobLine}</p>
      ) : null}

      {missionTitle ? (
        <SimpleAccordion
          title="Demande initiale"
          hint="Réduire / agrandir la consigne"
          defaultOpen={false}
          className="border-b border-violet-100/80 bg-white/60"
          triggerClassName="px-4 py-2.5 sm:px-5"
          panelClassName="max-h-48 overflow-y-auto border-t border-violet-50 px-4 py-3 text-sm text-slate-700 sm:px-5"
        >
          <AgentMessageMarkdown source={missionTitle} className="text-sm [&_p]:my-1.5" />
        </SimpleAccordion>
      ) : null}

      {hasCeoDecision ? (
        <div className="border-b border-violet-100 bg-gradient-to-b from-violet-50/60 to-white px-4 py-4 sm:px-5">
          <p className="text-xs font-bold uppercase tracking-wide text-violet-900">Résumé exécutif</p>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
            Réponse complète du CIO — base pour vos décisions (synthèse, arbitrages, suites recommandées).
          </p>
          <div
            className={`mt-4 rounded-xl border border-violet-100/80 bg-white px-4 py-4 shadow-inner ${
              embedded ? "" : "max-h-[min(70vh,42rem)] overflow-y-auto"
            } ${model.jsonExecutive ? "" : proseDecision}`}
          >
            {model.jsonExecutive ? (
              <CioJsonExecutiveView executive={model.jsonExecutive} />
            ) : looksLikeRawJson ? (
              <p className="text-sm text-amber-900">
                Format de livrable non reconnu. Ouvrez le détail technique ci-dessous ou relancez une synthèse CIO.
              </p>
            ) : (
              <AgentMessageMarkdown source={model.ceoDecisionReport} />
            )}
          </div>
        </div>
      ) : (
        <div className="border-b border-amber-100 bg-amber-50/80 px-4 py-3 text-sm text-amber-950">
          Synthèse décisionnelle du CIO non détectée dans ce livrable. Consultez le bilan opérationnel et le détail
          ci-dessous.
        </div>
      )}

      {hasBilan ? (
        <SimpleAccordion
          title="Bilan opérationnel par agent"
          hint={`${model.operationalBilan.length} action(s) réalisée(s) — complément au résumé exécutif`}
          defaultOpen={false}
          className="border-b border-slate-200 bg-slate-50/50"
          triggerClassName="px-4 py-3 sm:px-5"
          panelClassName="max-h-[min(40vh,22rem)] overflow-y-auto border-t border-slate-200 px-4 py-4 sm:px-5"
        >
          <BilanAgentList items={model.operationalBilan} />
        </SimpleAccordion>
      ) : null}

      {hasDetail ? (
        <SimpleAccordion
          title="Détail technique (réponses par rôle, métadonnées)"
          hint="Verbatim et contexte — si besoin de vérification"
          defaultOpen={false}
          className="bg-slate-50/80"
          triggerClassName="px-4 py-3 sm:px-5"
          panelClassName={`max-h-[min(65vh,32rem)] overflow-y-auto border-t border-slate-200 px-4 py-4 sm:px-5 ${proseDetail}`}
        >
          {model.preamble ? (
            <div className="mb-4 rounded-lg border border-amber-100 bg-amber-50/80 px-3 py-2 text-xs text-amber-950">
              <p className="mb-1 font-semibold uppercase tracking-wide text-amber-800">Contexte technique</p>
              <AgentMessageMarkdown source={model.preamble} />
            </div>
          ) : null}
          {model.rolesDetail ? (
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Réponses des rôles (verbatim)
              </p>
              <AgentMessageMarkdown source={model.rolesDetail} />
            </div>
          ) : null}
        </SimpleAccordion>
      ) : null}
    </section>
  );
}
