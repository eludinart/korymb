"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { agentHeaders, requestJson } from "../lib/api";

type Props = { jobId: string };

export default function JobAuditPanel({ jobId }: Props) {
  const audit = useQuery({
    queryKey: ["job-audit", jobId],
    enabled: Boolean(jobId),
    queryFn: async () => (await requestJson(`/jobs/${encodeURIComponent(jobId)}/audit-bundle`, { headers: agentHeaders() })).data,
  });

  const clone = useMutation({
    mutationFn: async () =>
      (await requestJson(`/jobs/${encodeURIComponent(jobId)}/clone`, { method: "POST", headers: agentHeaders() })).data,
    onSuccess: (data) => {
      if (data?.job_id) window.location.href = `/missions?job=${encodeURIComponent(String(data.job_id))}`;
    },
  });

  const traces = audit.data?.traces || [];
  const verdicts = audit.data?.quality_verdicts || [];

  return (
    <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">Audit mission</h3>
        <button
          type="button"
          disabled={clone.isPending}
          onClick={() => clone.mutate()}
          className="rounded-lg border border-violet-300 px-3 py-1 text-xs font-semibold text-violet-800 disabled:opacity-50"
        >
          {clone.isPending ? "Clone…" : "Rejouer mission"}
        </button>
      </div>
      {audit.isLoading ? <p className="mt-2 text-xs text-slate-500">Chargement audit…</p> : null}
      {verdicts.length > 0 ? (
        <div className="mt-3">
          <p className="text-xs font-semibold text-slate-600">Verdicts qualité</p>
          <ul className="mt-1 space-y-1">
            {verdicts.map((v: { id?: string; phase?: string; score?: number; rejected?: number }) => (
              <li key={v.id} className="text-xs text-slate-700">
                {v.phase} — score {v.score} {v.rejected ? "(rejeté)" : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {traces.length > 0 ? (
        <div className="mt-3 max-h-48 overflow-auto">
          <p className="text-xs font-semibold text-slate-600">Traces LLM ({traces.length})</p>
          <table className="mt-1 w-full text-[11px]">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-1">Nœud</th>
                <th>Coût $</th>
                <th>Latence ms</th>
              </tr>
            </thead>
            <tbody>
              {traces.slice(-20).map((t: { id?: number; graph_node?: string; cost_usd?: number; latency_ms?: number }, i: number) => (
                <tr key={t.id ?? i} className="border-t border-slate-100">
                  <td className="py-1 font-mono">{t.graph_node || "—"}</td>
                  <td>{Number(t.cost_usd || 0).toFixed(4)}</td>
                  <td>{t.latency_ms ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
