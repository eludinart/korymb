"use client";

import { useQuery } from "@tanstack/react-query";
import HealthDot from "./HealthDot";
import type { HealthTone } from "../lib/healthTone";
import { agentHeaders, requestJson } from "../lib/api";
import { QK } from "../lib/queryClient";

const visibleInterval = (ms: number) =>
  typeof document !== "undefined" && document.visibilityState === "visible" ? ms : false;

export default function GlobalStatusBar() {
  const llm = useQuery({
    queryKey: QK.llm,
    queryFn: async () => (await requestJson("/llm", { retries: 1 })).data,
    refetchInterval: () => visibleInterval(5000),
  });
  const tokens = useQuery({
    queryKey: QK.tokens,
    queryFn: async () => (await requestJson("/tokens", { retries: 1 })).data,
    refetchInterval: () => visibleInterval(10000),
  });
  const jobs = useQuery({
    queryKey: QK.jobs,
    queryFn: async () => (await requestJson("/jobs", { headers: agentHeaders(), retries: 1 })).data.jobs || [],
    refetchInterval: () => visibleInterval(3000),
  });

  const running = (jobs.data || []).filter((j: { status?: string }) => j.status === "running").length;
  const totalTokens = tokens.isSuccess ? Number(tokens.data?.total || 0) : null;
  const totalJobs = jobs.isSuccess ? Number(jobs.data?.length || 0) : null;

  const llmTone: HealthTone = llm.isError ? "bad" : llm.isSuccess ? "ok" : "neutral";
  const tokensTone: HealthTone = tokens.isError ? "bad" : tokens.isSuccess ? "ok" : "neutral";
  const jobsTone: HealthTone = jobs.isError ? "bad" : jobs.isSuccess ? (running > 0 ? "warn" : "ok") : "neutral";

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex items-center gap-2">
          <HealthDot tone={llmTone} label="État endpoint LLM" />
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Modèle actif</p>
        </div>
        {llm.isLoading ? <p className="mt-2 text-sm text-slate-400">Chargement…</p> : null}
        {llm.isError ? <p className="mt-2 text-sm text-red-700">LLM indisponible</p> : null}
        {llm.isSuccess ? (
          <p className="mt-2 font-mono text-sm font-medium leading-snug text-slate-800">
            {llm.data?.provider || "—"} · {llm.data?.model || "—"}
          </p>
        ) : null}
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex items-center gap-2">
          <HealthDot tone={tokensTone} label="État métriques tokens" />
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Tokens (jour)</p>
        </div>
        {tokens.isLoading ? <p className="mt-2 text-sm text-slate-400">Chargement…</p> : null}
        {tokens.isError ? <p className="mt-2 text-sm text-red-700">Métriques indisponibles</p> : null}
        {tokens.isSuccess ? (
          <p className="mt-2 text-xl font-semibold tabular-nums text-slate-900">{totalTokens?.toLocaleString?.() || "0"}</p>
        ) : null}
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex items-center gap-2">
          <HealthDot
            tone={jobsTone}
            label={jobs.isSuccess && running > 0 ? "Missions en cours" : "État liste missions"}
          />
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Missions</p>
        </div>
        {jobs.isLoading ? <p className="mt-2 text-sm text-slate-400">Chargement…</p> : null}
        {jobs.isError ? <p className="mt-2 text-sm text-red-700">Liste indisponible</p> : null}
        {jobs.isSuccess ? (
          <>
            <p className="mt-2 text-xl font-semibold tabular-nums text-slate-900">{totalJobs ?? 0}</p>
            <p className="text-xs text-slate-500">{running} en cours</p>
          </>
        ) : null}
      </div>
    </div>
  );
}
