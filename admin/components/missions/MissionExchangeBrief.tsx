"use client";

import { useMemo, useState, type ReactNode } from "react";
import AgentMessageMarkdown from "../AgentMessageMarkdown";
import SimpleAccordion from "../SimpleAccordion";
import SessionCadrageTimeline from "../SessionCadrageTimeline";
import DeliverableAccessHub from "../deliverables/DeliverableAccessHub";
import type { DriveArtifact } from "../../lib/types";
import { formatEventTs } from "../../lib/missionEvents";
import { buildMissionExchangeBrief } from "../../lib/missionExchangeBrief";
import { agentRoleSoftClass } from "../../lib/agentRoleUi";

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

function ExpandableExchangeCard({
  ts,
  excerpt,
  full,
}: {
  ts?: string;
  excerpt: string;
  full: string;
}) {
  const [open, setOpen] = useState(false);
  const canExpand = full.trim().length > excerpt.trim().length || full.includes("\n");
  const body = open ? full : excerpt;

  return (
    <li className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-snug text-slate-800">
      <div className="flex items-start justify-between gap-2">
        {ts ? (
          <p className="mb-1 font-mono text-[10px] text-slate-400">{formatEventTs(ts)}</p>
        ) : (
          <span />
        )}
        {canExpand ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-violet-800 hover:underline"
            aria-expanded={open}
          >
            {open ? "Réduire" : "Détail"}
          </button>
        ) : null}
      </div>
      <button
        type="button"
        disabled={!canExpand}
        onClick={() => canExpand && setOpen((v) => !v)}
        className={`w-full text-left whitespace-pre-wrap ${canExpand ? "cursor-pointer" : "cursor-default"}`}
      >
        {body}
      </button>
    </li>
  );
}

function SuggestionList({
  items,
  preview = 4,
}: {
  items: { excerpt: string; full: string }[];
  preview?: number;
}) {
  const [openList, setOpenList] = useState(false);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const shown = openList ? items : items.slice(0, preview);
  const rest = items.length - preview;

  return (
    <ul className="space-y-1.5">
      {shown.map((item, i) => {
        const isOpen = Boolean(expanded[i]);
        const canExpand = item.full.trim().length > item.excerpt.trim().length;
        const text = isOpen ? item.full : item.excerpt;
        return (
          <li key={i} className="flex gap-2 text-sm leading-snug text-slate-800">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="whitespace-pre-wrap">{text}</p>
              {canExpand ? (
                <button
                  type="button"
                  onClick={() => setExpanded((prev) => ({ ...prev, [i]: !prev[i] }))}
                  className="mt-0.5 text-[11px] font-semibold text-violet-800 hover:underline"
                >
                  {isOpen ? "Réduire" : "Voir le détail"}
                </button>
              ) : null}
            </div>
          </li>
        );
      })}
      {rest > 0 && !openList ? (
        <li>
          <button
            type="button"
            onClick={() => setOpenList(true)}
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
        <p className="mt-0.5 text-xs text-slate-600">
          Substance opérationnelle — cliquez <span className="font-semibold">Détail</span> pour lire un échange en entier.
        </p>
      </header>

      <div className={`min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 ${fillColumn ? "" : "max-h-[min(32rem,60vh)]"}`}>
        {jobId && (deliverablesMarkdown || (driveArtifacts && driveArtifacts.length > 0) || result) ? (
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
          <SimpleAccordion
            title="Synthèse opérationnelle"
            hint="Déplier pour lire la synthèse complète"
            defaultOpen
            className="rounded-xl border border-violet-100 bg-violet-50/40"
            triggerClassName="px-3 py-2.5"
            panelClassName="border-t border-violet-100 px-3 py-3 text-sm leading-relaxed text-slate-800 [&_li]:my-1 [&_p]:my-1.5"
          >
            <AgentMessageMarkdown source={brief.operationalSummary} />
          </SimpleAccordion>
        ) : null}

        {brief.userConsignes.length > 0 ? (
          <section aria-label="Vos consignes">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-600">
              Vos échanges ({brief.userConsignes.length}) — plus récents d&apos;abord
            </p>
            <ul className="space-y-2">
              {brief.userConsignes.map((c, i) => (
                <ExpandableExchangeCard
                  key={`${c.ts || ""}-${i}`}
                  ts={c.ts}
                  excerpt={c.excerpt}
                  full={c.full}
                />
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
                <SimpleAccordion
                  key={group.agentKey}
                  title={group.agentLabel}
                  hint={`${group.items.length} suggestion${group.items.length > 1 ? "s" : ""} — déplier`}
                  defaultOpen={brief.agentSuggestions.length <= 2}
                  className="rounded-xl border border-slate-200 bg-white shadow-sm"
                  triggerClassName="px-3 py-2.5"
                  panelClassName="border-t border-slate-100 px-3 py-3"
                >
                  <span
                    className={`mb-2 inline-block rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${agentRoleSoftClass(group.agentKey)}`}
                  >
                    {group.agentLabel}
                  </span>
                  <SuggestionList items={group.items} />
                </SimpleAccordion>
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
          panelClassName="border-t border-slate-200 p-2"
        >
          <SessionCadrageTimeline
            messages={thread}
            missionPlan={missionPlan}
            missionBrief={missionBrief}
            title="Fil verbatim"
            hideStrategicFollowup
            embedInParentScroll
          />
        </SimpleAccordion>
      </div>

      {footer ? <div className="shrink-0 border-t border-slate-100">{footer}</div> : null}
    </div>
  );
}
