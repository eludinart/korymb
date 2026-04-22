"use client";

import { useQuery } from "@tanstack/react-query";
import HealthDot from "./HealthDot";
import type { HealthTone } from "../lib/healthTone";
import { agentHeaders, requestJson } from "../lib/api";
import { QK } from "../lib/queryClient";

const visibleInterval = (ms: number) =>
  typeof document !== "undefined" && document.visibilityState === "visible" ? ms : false;

function fmt(n: number) {
  return n.toLocaleString("fr-FR");
}
function fmtUsd(n: number) {
  if (n === 0) return "$0,00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}
function pct(val: number, max: number) {
  if (!max) return 0;
  return Math.min(100, Math.round((val / max) * 100));
}

type TokenData = {
  today?: string;
  tokens_in?: number;
  tokens_out?: number;
  total?: number;
  cost_usd?: number;
  alert?: boolean;
  budget_exceeded?: boolean;
  alert_threshold?: number;
  max_per_job?: number;
  lifetime_tokens_total?: number;
  tokens_inflight?: number;
  cost_today_usd?: number;
  cost_week_usd?: number;
  cost_month_usd?: number;
  cost_total_usd?: number;
  usage_tokens_today?: number;
  usage_tokens_week?: number;
  usage_tokens_month?: number;
  usage_tokens_last_hour?: number;
  usage_tokens_last_minute?: number;
  expensive_research_tier?: boolean;
};

export default function GlobalStatusBar() {
  const llm = useQuery({
    queryKey: QK.llm,
    queryFn: async () => (await requestJson("/llm", { retries: 1 })).data,
    refetchInterval: () => visibleInterval(5000),
  });
  const tokens = useQuery({
    queryKey: QK.tokens,
    queryFn: async () => (await requestJson("/tokens", { retries: 1 })).data as TokenData,
    refetchInterval: () => visibleInterval(8000),
  });
  const jobs = useQuery({
    queryKey: QK.jobs,
    queryFn: async () => (await requestJson("/jobs", { headers: agentHeaders(), retries: 1 })).data.jobs || [],
    refetchInterval: () => visibleInterval(3000),
  });

  const jobList = (jobs.data || []) as Array<{ status?: string; cost_usd?: number }>;
  const running = jobList.filter((j) => j.status === "running").length;
  const completed = jobList.filter((j) => j.status === "completed").length;
  const failed = jobList.filter((j) => String(j.status || "").startsWith("error")).length;
  const totalJobs = jobList.length;

  const td = tokens.data;
  const tokensTotal = td ? (td.usage_tokens_today ?? td.total ?? 0) : null;
  const tokensIn = td?.tokens_in ?? 0;
  const tokensOut = td?.tokens_out ?? 0;
  const costToday = td?.cost_today_usd ?? td?.cost_usd ?? 0;
  const costWeek = td?.cost_week_usd ?? 0;
  const costMonth = td?.cost_month_usd ?? 0;
  const inflight = td?.tokens_inflight ?? 0;
  const alertThreshold = td?.alert_threshold ?? 0;
  const maxPerJob = td?.max_per_job ?? 0;
  const isAlert = td?.alert ?? false;
  const isBudgetExceeded = td?.budget_exceeded ?? false;
  const lastMinute = td?.usage_tokens_last_minute ?? 0;
  const lastHour = td?.usage_tokens_last_hour ?? 0;
  const expensiveTier = td?.expensive_research_tier ?? false;

  const thresholdPct = tokensTotal !== null && alertThreshold ? pct(tokensTotal, alertThreshold) : 0;

  const llmTone: HealthTone = llm.isError ? "bad" : llm.isSuccess ? "ok" : "neutral";
  const tokensTone: HealthTone = isBudgetExceeded ? "bad" : isAlert ? "warn" : tokens.isError ? "bad" : tokens.isSuccess ? "ok" : "neutral";
  const jobsTone: HealthTone = jobs.isError ? "bad" : jobs.isSuccess ? (running > 0 ? "warn" : "ok") : "neutral";

  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_2fr_1fr]">

      {/* ── Modèle actif ── */}
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex items-center gap-2">
          <HealthDot tone={llmTone} label="État endpoint LLM" />
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Modèle actif</p>
        </div>
        {llm.isLoading ? <p className="mt-2 text-sm text-slate-400">Chargement…</p> : null}
        {llm.isError ? <p className="mt-2 text-sm text-red-700">LLM indisponible</p> : null}
        {llm.isSuccess ? (
          <div className="mt-2 space-y-1">
            <p className="font-mono text-sm font-semibold leading-snug text-slate-800">
              {llm.data?.provider || "—"}
            </p>
            <p className="truncate font-mono text-[11px] text-slate-500" title={llm.data?.model || ""}>
              {llm.data?.model || "—"}
            </p>
            {expensiveTier && (
              <span className="inline-block rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700">
                Tier recherche
              </span>
            )}
          </div>
        ) : null}
      </div>

      {/* ── Usage tokens & coûts ── */}
      <div className={`rounded-2xl border bg-white px-4 py-3 shadow-sm ${isBudgetExceeded ? "border-red-300" : isAlert ? "border-amber-300" : "border-slate-200"}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <HealthDot tone={tokensTone} label="Métriques tokens" />
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Usage IA</p>
          </div>
          {isBudgetExceeded && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-red-700">
              Budget dépassé
            </span>
          )}
          {isAlert && !isBudgetExceeded && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-700">
              Seuil alerte
            </span>
          )}
          {inflight > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[9px] font-semibold text-violet-700">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-500" />
              {fmt(inflight)} en vol
            </span>
          )}
        </div>

        {tokens.isLoading ? <p className="mt-2 text-sm text-slate-400">Chargement…</p> : null}
        {tokens.isError ? <p className="mt-2 text-sm text-red-700">Métriques indisponibles</p> : null}
        {tokens.isSuccess && td ? (
          <div className="mt-2 space-y-2.5">
            {/* Ligne principale : total jour + coût */}
            <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
              <div>
                <p className="text-xl font-bold tabular-nums text-slate-900">
                  {fmt(tokensTotal ?? 0)}
                  <span className="ml-1 text-xs font-normal text-slate-400">tok/jour</span>
                </p>
                <p className="text-[11px] text-slate-400 tabular-nums">
                  ↑ {fmt(tokensIn)} entrée · ↓ {fmt(tokensOut)} sortie
                </p>
              </div>
              <div className="text-right">
                <p className="text-base font-semibold tabular-nums text-slate-800">
                  {fmtUsd(costToday)}
                  <span className="ml-1 text-[11px] font-normal text-slate-400">aujourd'hui</span>
                </p>
                {costWeek > 0 && (
                  <p className="text-[11px] text-slate-400 tabular-nums">
                    {fmtUsd(costWeek)} cette semaine · {fmtUsd(costMonth)} ce mois
                  </p>
                )}
              </div>
            </div>

            {/* Cadence temps réel */}
            {(lastMinute > 0 || lastHour > 0) && (
              <div className="flex gap-3 text-[11px] text-slate-500">
                {lastMinute > 0 && (
                  <span className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    {fmt(lastMinute)} tok/min
                  </span>
                )}
                {lastHour > 0 && (
                  <span>{fmt(lastHour)} tok/h</span>
                )}
              </div>
            )}

            {/* Barre de progression vers le seuil d'alerte */}
            {alertThreshold > 0 && (
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-slate-400">
                  <span>Seuil alerte : {fmt(alertThreshold)} tok</span>
                  <span>{thresholdPct}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full transition-all ${
                      isBudgetExceeded ? "bg-red-500" : thresholdPct >= 80 ? "bg-amber-400" : "bg-emerald-400"
                    }`}
                    style={{ width: `${thresholdPct}%` }}
                  />
                </div>
                {maxPerJob > 0 && (
                  <p className="text-[10px] text-slate-400">Limite par mission : {fmt(maxPerJob)} tok</p>
                )}
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* ── Missions ── */}
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
          <div className="mt-2 space-y-1.5">
            <p className="text-xl font-bold tabular-nums text-slate-900">
              {totalJobs}
              <span className="ml-1 text-xs font-normal text-slate-400">total</span>
            </p>
            <div className="space-y-0.5 text-[11px]">
              {running > 0 && (
                <p className="flex items-center gap-1.5 font-semibold text-violet-700">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-500" />
                  {running} en cours
                </p>
              )}
              {completed > 0 && (
                <p className="text-slate-500">{completed} terminées</p>
              )}
              {failed > 0 && (
                <p className="text-red-600">{failed} en erreur</p>
              )}
              {running === 0 && completed === 0 && failed === 0 && (
                <p className="text-slate-400">Aucune mission active</p>
              )}
            </div>
          </div>
        ) : null}
      </div>

    </div>
  );
}
