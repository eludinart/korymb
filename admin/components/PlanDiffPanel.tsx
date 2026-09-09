"use client";

import { useQuery } from "@tanstack/react-query";
import { agentHeaders, requestJson } from "../lib/api";

type Props = {
  jobId: string;
  compact?: boolean;
};

type PlanDiffPayload = {
  identical?: boolean;
  snapshot_count?: number;
  from_version?: number;
  to_version?: number;
  diff?: {
    has_changes?: boolean;
    synthese_changed?: boolean;
    synthese_before?: string;
    synthese_after?: string;
    agents_added?: string[];
    agents_removed?: string[];
    sous_taches_changed?: Array<{ key?: string }>;
  };
};

/**
 * Affiche Avant / Après uniquement s'il existe au moins 2 versions de plan
 * et une différence réelle. Sinon : rien (évite le faux « plans identiques »).
 */
export default function PlanDiffPanel({ jobId, compact = false }: Props) {
  const diffQuery = useQuery({
    queryKey: ["plan-diff", jobId],
    enabled: Boolean(jobId),
    queryFn: async () => {
      const { res, data } = await requestJson(
        `/jobs/${encodeURIComponent(jobId)}/hitl/plan-diff?from_version=1`,
        { headers: agentHeaders(), expectOk: false },
      );
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return data as PlanDiffPayload;
    },
  });

  if (diffQuery.isLoading) return null;
  if (diffQuery.isError || !diffQuery.data) return null;

  const payload = diffQuery.data;
  const diff = payload.diff;
  const hasChanges = Boolean(diff?.has_changes) && !payload.identical;
  if (!hasChanges || !diff) return null;

  const syntheseChanged = Boolean(diff.synthese_changed);
  const before = String(diff.synthese_before || "").trim();
  const after = String(diff.synthese_after || "").trim();

  return (
    <div className={`rounded-xl border border-slate-200 bg-slate-50 ${compact ? "p-3" : "p-4"}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Comparateur plan CIO
        {payload.from_version != null && payload.to_version != null ? (
          <span className="ml-1 font-medium normal-case tracking-normal text-slate-400">
            (v{payload.from_version} → v{payload.to_version})
          </span>
        ) : null}
      </p>

      {syntheseChanged ? (
        <div className="mt-2 grid gap-3 md:grid-cols-2">
          <div>
            <p className="text-[11px] font-semibold text-slate-600">Avant</p>
            <p className="mt-1 text-xs text-slate-700 whitespace-pre-wrap">{(before || "—").slice(0, 600)}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold text-emerald-800">Après</p>
            <p className="mt-1 text-xs text-slate-700 whitespace-pre-wrap">{(after || "—").slice(0, 600)}</p>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-xs text-slate-600">Synthèse inchangée — évolutions sur agents / sous-tâches uniquement.</p>
      )}

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

      {(diff.sous_taches_changed?.length || 0) > 0 ? (
        <p className="mt-2 text-[11px] text-slate-500">
          {diff.sous_taches_changed!.length} sous-tâche
          {diff.sous_taches_changed!.length > 1 ? "s" : ""} modifiée
          {diff.sous_taches_changed!.length > 1 ? "s" : ""}
        </p>
      ) : null}
    </div>
  );
}
