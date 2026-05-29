"use client";

import { useQuery } from "@tanstack/react-query";
import { agentHeaders, requestJson } from "../lib/api";

type Props = {
  jobId: string;
  compact?: boolean;
};

export default function PlanDiffPanel({ jobId, compact = false }: Props) {
  const diffQuery = useQuery({
    queryKey: ["plan-diff", jobId],
    enabled: Boolean(jobId),
    queryFn: async () =>
      (await requestJson(`/jobs/${encodeURIComponent(jobId)}/hitl/plan-diff?from_version=1`, { headers: agentHeaders() }))
        .data,
  });

  const diff = diffQuery.data?.diff;
  if (diffQuery.isLoading) return <p className="text-xs text-slate-500">Diff plan…</p>;
  if (diffQuery.isError || !diff) return null;

  return (
    <div className={`rounded-xl border border-slate-200 bg-slate-50 ${compact ? "p-3" : "p-4"}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Comparateur plan CIO</p>
      <div className="mt-2 grid gap-3 md:grid-cols-2">
        <div>
          <p className="text-[11px] font-semibold text-slate-600">Avant</p>
          <p className="mt-1 text-xs text-slate-700 whitespace-pre-wrap">{String(diff.synthese_before || "—").slice(0, 600)}</p>
        </div>
        <div>
          <p className="text-[11px] font-semibold text-slate-600">Après</p>
          <p className="mt-1 text-xs text-slate-700 whitespace-pre-wrap">{String(diff.synthese_after || "—").slice(0, 600)}</p>
        </div>
      </div>
      {(diff.agents_added?.length || diff.agents_removed?.length) ? (
        <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
          {(diff.agents_added || []).map((a: string) => (
            <span key={`+${a}`} className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-800">
              + {a}
            </span>
          ))}
          {(diff.agents_removed || []).map((a: string) => (
            <span key={`-${a}`} className="rounded bg-red-100 px-2 py-0.5 text-red-800">
              − {a}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
