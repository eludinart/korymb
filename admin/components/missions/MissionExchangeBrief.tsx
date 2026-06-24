"use client";

import { useMemo, useState, type ReactNode } from "react";
import AgentMessageMarkdown from "../AgentMessageMarkdown";
import SimpleAccordion from "../SimpleAccordion";
import SessionCadrageTimeline from "../SessionCadrageTimeline";
import DeliverableAccessHub from "../deliverables/DeliverableAccessHub";
import type { DriveArtifact } from "../../lib/types";
import { formatEventTs } from "../../lib/missionEvents";
import { buildMissionExchangeBrief } from "../../lib/missionExchangeBrief";

const AGENT_STYLES: Record<string, string> = {
  commercial: "bg-blue-100 text-blue-900",
  community_manager: "bg-pink-100 text-pink-900",
  developpeur: "bg-emerald-100 text-emerald-900",
  comptable: "bg-amber-100 text-amber-900",
  coordinateur: "bg-violet-100 text-violet-900",
};

function agentBadgeClass(key: string) {
  return AGENT_STYLES[key] || "bg-slate-100 text-slate-800";
}

type Props = {
  result?: string | null;
  thread?: unknown;
  team?: unknown;
  deliverablesMarkdown?: string;
  missionBrief?: string | null;
  missionPlan?: unknown;
  title?: string;
  fillColumn?: boolean;
  className?: string;
  footer?: ReactNode;
  jobId?: string;
  driveArtifacts?: DriveArtifact[] | null;
};

function SuggestionList({ items, preview = 4 }: { items: string[]; preview?: number }) {
  const [open, setOpen] = useState(false);
  const shown = open ? items : items.slice(0, preview);
  const rest = items.length - preview;

  return (
    <ul className="space-y-1.5">
      {shown.map((item, i) => (
        <li key={i} className="flex gap-2 text-sm leading-snug text-slate-800">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400" aria-hidden />
          <span className="min-w-0 flex-1">{item}</span>
        </li>
      ))}
      {rest > 0 && !open ? (
        <li>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-xs font-semibold text-violet-800 hover:underline"
          >
            + {rest} suggestion{rest > 1 ? "s" : ""}
          </button>
        </li>
      ) : null}
    </ul>
  );
}

/**
 * Colonne « échanges » condensée : synthèse opérationnelle + suggestions par agent.
 * Le fil verbatim reste accessible en accordéon.
 */
export default function MissionExchangeBrief({
  result,
  thread,
  team,
  deliverablesMarkdown,
  missionBrief,
  missionPlan,
  title = "Résumé des échanges",
  fillColumn = false,
  className = "",
  footer,
  jobId,
  driveArtifacts,
}: Props) {
  const brief = useMemo(
    () =>
      buildMissionExchangeBrief({
        result,
        thread,
        team,
        deliverablesMarkdown,
        missionBrief,
      }),
    [result, thread, team, deliverablesMarkdown, missionBrief],
  );

  const hasContent =
    Boolean(brief.operationalSummary) ||
    brief.userConsignes.length > 0 ||
    brief.agentSuggestions.length > 0;

  const shell = `flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm ${
    fillColumn ? "h-full min-h-0" : ""
  } ${className}`;

  return (
    <div className={shell}>
      <header className="shrink-0 border-b border-slate-100 px-4 py-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{title}</p>
        <p className="mt-0.5 text-xs text-slate-600">Substance opérationnelle — pas le verbatim des échanges.</p>
      </header>

      <div className={`min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 ${fillColumn ? "" : "max-h-[min(32rem,60vh)]"}`}>
        {jobId && deliverablesMarkdown ? (
          <DeliverableAccessHub
            jobId={jobId}
            deliverablesMarkdown={deliverablesMarkdown}
            driveArtifacts={driveArtifacts}
            result={result}
            compact
          />
        ) : null}
        {!hasContent ? (
          <p className="text-sm text-slate-500">Les suggestions des agents apparaîtront ici au fil de l&apos;exécution.</p>
        ) : null}

        {brief.operationalSummary ? (
          <section aria-label="Synthèse opérationnelle">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-violet-800">Synthèse opérationnelle</p>
            <div className="rounded-xl border border-violet-100 bg-violet-50/50 px-3 py-3 text-sm leading-relaxed text-slate-800 [&_li]:my-1 [&_p]:my-1.5">
              <AgentMessageMarkdown source={brief.operationalSummary} />
            </div>
          </section>
        ) : null}

        {brief.userConsignes.length > 0 ? (
          <section aria-label="Vos consignes">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-600">Vos consignes</p>
            <ul className="space-y-2">
              {brief.userConsignes.map((c, i) => (
                <li
                  key={`${c.ts || ""}-${i}`}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-snug text-slate-800"
                >
                  {c.ts ? (
                    <p className="mb-1 font-mono text-[10px] text-slate-400">{formatEventTs(c.ts)}</p>
                  ) : null}
                  {c.excerpt}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {brief.agentSuggestions.length > 0 ? (
          <section aria-label="Suggestions par agent">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-600">
              Suggestions des agents ({brief.agentSuggestions.length})
            </p>
            <div className="space-y-2.5">
              {brief.agentSuggestions.map((group) => (
                <div
                  key={group.agentKey}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm"
                >
                  <span
                    className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${agentBadgeClass(group.agentKey)}`}
                  >
                    {group.agentLabel}
                  </span>
                  <div className="mt-2">
                    <SuggestionList items={group.items} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <SimpleAccordion
          title="Fil complet des échanges"
          hint="Verbatim CIO et agents — ouvrir si besoin de relire"
          defaultOpen={false}
          className="rounded-xl border border-slate-200 bg-slate-50/80"
          triggerClassName="px-3 py-2.5"
          panelClassName="max-h-[min(40vh,22rem)] overflow-y-auto border-t border-slate-200 p-2"
        >
          <SessionCadrageTimeline
            messages={thread}
            missionPlan={missionPlan}
            missionBrief={missionBrief}
            title="Fil verbatim"
            hideStrategicFollowup
            maxHeightClass="max-h-[min(38vh,20rem)]"
          />
        </SimpleAccordion>
      </div>

      {footer ? <div className="shrink-0 border-t border-slate-100">{footer}</div> : null}
    </div>
  );
}
