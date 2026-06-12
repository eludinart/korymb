"use client";

import MissionMetricsRow from "../MissionMetricsRow";

import type { Job } from "../../lib/types";

type Props = {
  live: (Job & { events?: unknown[]; logs?: string[]; log_total?: number }) | null | undefined;
  isError: boolean;
};

/** Panneau temps réel affiché pendant une continuation CIO (tour en cours). */
export default function CioResumeLivePanel({ live, isError }: Props) {
  return (
    <div className="overflow-hidden rounded-2xl border-2 border-violet-400 bg-white shadow-lg">
      <div className="flex flex-wrap items-center gap-2 bg-violet-600 px-4 py-2.5">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-white" />
        <p className="text-sm font-bold text-white">Agents au travail — Tour en cours</p>
        <span className="ml-auto rounded-full bg-violet-500 px-2 py-0.5 text-[10px] font-semibold text-violet-100">
          ↻ live
        </span>
      </div>
      {live ? (
        <div className="space-y-3 p-4">
          <MissionMetricsRow
            status={String(live.status || "")}
            tokensTotal={Number(live.tokens_total || 0)}
            costUsd={Number(live.cost_usd || 0)}
            eventsTotal={Number(live.events_total || 0)}
            logTotal={Number(live.log_total || 0)}
          />
          {((live.events || []) as Array<Record<string, unknown>>).length > 0 ? (
            <div className="rounded-xl border border-violet-100 bg-violet-50/50 px-3 py-2">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-violet-500">
                Derniers événements agents
              </p>
              <ul className="space-y-1">
                {((live.events || []) as Array<Record<string, unknown>>).slice(-6).map((ev, i) => (
                  <li key={i} className="flex min-w-0 gap-1.5 text-[11px]">
                    <span className="shrink-0 font-semibold text-violet-700">
                      {String(ev.actor || ev.agent || "—")}
                    </span>
                    <span className="text-slate-400">·</span>
                    <span className="text-slate-600">{String(ev.type || ev.event || "")}</span>
                    {ev.summary || ev.message ? (
                      <span className="truncate text-slate-400">
                        {String(ev.summary || ev.message || "").slice(0, 80)}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {((live.logs || []) as string[]).length > 0 ? (
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Journal en direct
              </p>
              <pre className="max-h-28 overflow-auto whitespace-pre-wrap text-[10px] leading-relaxed text-slate-600">
                {((live.logs || []) as string[]).slice(-8).join("\n")}
              </pre>
            </div>
          ) : (
            <p className="text-center text-xs text-slate-400">En attente de la première réponse agents…</p>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-center gap-2 p-6">
          <span className="h-2 w-2 animate-pulse rounded-full bg-violet-400" />
          <p className="text-sm text-slate-500">Initialisation du tour…</p>
        </div>
      )}
      {isError ? (
        <p className="px-4 pb-3 text-xs text-red-700">Impossible de suivre l&apos;état du tour en direct.</p>
      ) : null}
    </div>
  );
}
