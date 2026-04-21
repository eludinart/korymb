"use client";

import {
  formatEventTs,
  eventTypeLabelFr,
  normalizeMissionEvents,
  summarizeMissionEvent,
} from "../lib/missionEvents";

type Props = {
  events: unknown;
  title?: string;
  emptyText?: string;
  className?: string;
  maxHeightClass?: string;
  /** Masque la barre de titre interne (titre porté par un accordéon parent). */
  suppressTitle?: boolean;
};

export default function MissionEventTimeline({
  events,
  title = "Timeline multi-agents",
  emptyText = "Aucun événement structuré pour cette mission (en cours de démarrage ou mission très courte).",
  className = "",
  maxHeightClass = "max-h-80",
  suppressTitle = false,
}: Props) {
  const list = normalizeMissionEvents(events);
  const sorted = [...list].sort((a, b) => String(a.ts || "").localeCompare(String(b.ts || "")));

  if (sorted.length === 0) {
    return (
      <div className={`rounded-xl border border-slate-200 bg-slate-50 p-3 ${className}`}>
        {!suppressTitle ? (
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</p>
        ) : null}
        <p className={`text-sm text-slate-500 ${suppressTitle ? "" : "mt-2"}`}>{emptyText}</p>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border border-slate-200 bg-white ${className}`}>
      {!suppressTitle ? (
        <p className="border-b border-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          {title}
        </p>
      ) : null}
      <div className={`overflow-y-auto px-2 py-3 ${maxHeightClass}`}>
        <ol className="relative ms-2 border-l border-slate-200 ps-5 space-y-4">
          {sorted.map((ev, idx) => {
            const summary = summarizeMissionEvent(ev);
            return (
            <li key={`${ev.ts || ""}-${ev.type || ""}-${idx}`} className="relative">
              <span className="absolute -start-[21px] top-1.5 flex h-3 w-3 items-center justify-center rounded-full border border-white bg-violet-500 ring-2 ring-white" />
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <time className="text-[11px] font-mono text-slate-400 tabular-nums">{formatEventTs(ev.ts)}</time>
                {ev.agent ? (
                  <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">
                    {ev.agent}
                  </span>
                ) : (
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-600">système</span>
                )}
                <span className="text-xs font-semibold text-violet-900">{eventTypeLabelFr(ev.type)}</span>
              </div>
              {summary ? (
                <p className="mt-1 text-sm leading-snug text-slate-700 whitespace-pre-wrap">{summary}</p>
              ) : null}
            </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
