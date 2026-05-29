"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import HealthDot from "./HealthDot";
import type { HealthTone } from "../lib/healthTone";
import { agentHeaders, requestJson } from "../lib/api";
import { QK } from "../lib/queryClient";

const COLLAPSED_LS = "korymb_global_status_bar_collapsed";

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

function readCollapsedPreference(): boolean | null {
  try {
    const raw = localStorage.getItem(COLLAPSED_LS);
    if (raw === "true") return true;
    if (raw === "false") return false;
  } catch {
    /* ignore */
  }
  return null;
}

export default function GlobalStatusBar() {
  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    const stored = readCollapsedPreference();
    if (stored !== null) {
      setCollapsed(stored);
      return;
    }
    const mq = window.matchMedia("(max-width: 1023px)");
    const apply = () => setCollapsed(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_LS, collapsed ? "true" : "false");
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  const llm = useQuery({
    queryKey: QK.llm,
    queryFn: async () => (await requestJson("/llm", { retries: 1 })).data,
    refetchInterval: () => visibleInterval(8000),
  });
  const tokens = useQuery({
    queryKey: QK.tokens,
    queryFn: async () => (await requestJson("/tokens", { retries: 2 })).data as TokenData,
    refetchInterval: () => visibleInterval(15000),
  });
  const jobs = useQuery({
    queryKey: QK.jobs,
    queryFn: async () => (await requestJson("/jobs", { headers: agentHeaders(), retries: 2 })).data.jobs || [],
    refetchInterval: () => visibleInterval(8000),
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

  const modelShort =
    llm.isSuccess && llm.data?.model
      ? String(llm.data.model).split("/").pop() || String(llm.data.model)
      : llm.isLoading
        ? "…"
        : "—";

  if (collapsed) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="flex min-h-[48px] min-w-0 flex-1 items-center gap-2 rounded-2xl border-2 border-violet-200 bg-white px-4 py-3 text-left text-sm shadow-md hover:bg-violet-50 active:bg-violet-100"
          aria-expanded={false}
        >
          <span className="shrink-0 text-base font-bold text-violet-700" aria-hidden>
            ▶
          </span>
          <span className="min-w-0 truncate">
            <span className="font-extrabold text-slate-950">Tableau de bord</span>
            <span className="font-bold text-slate-500"> · </span>
            <span className="font-mono text-xs font-bold text-violet-800">{modelShort}</span>
            {tokensTotal !== null && td ? (
              <>
                <span className="text-slate-500"> · </span>
                <span className="tabular-nums text-slate-600">{fmt(tokensTotal)} tok/j</span>
                <span className="text-slate-500"> · </span>
                <span className="tabular-nums text-slate-600">{fmtUsd(costToday)}</span>
              </>
            ) : null}
            {jobs.isSuccess ? (
              <>
                <span className="text-slate-500"> · </span>
                <span className="tabular-nums text-slate-600">
                  {running > 0 ? `${running} en cours / ` : ""}
                  {totalJobs} mission{totalJobs > 1 ? "s" : ""}
                </span>
              </>
            ) : null}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="min-h-[44px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50 active:bg-slate-100"
        >
          Réduire le bandeau
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_2fr_1fr]">

      <div className="stat-card">
        <div className="flex items-center gap-2">
          <HealthDot tone={llmTone} label="État endpoint LLM" />
          <p className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Modèle actif</p>
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
      <div className={`stat-card ${isBudgetExceeded ? "stat-card--urgent" : isAlert ? "stat-card--warn" : ""}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <HealthDot tone={tokensTone} label="Métriques tokens" />
            <p className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Usage IA</p>
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
                  <span className="ml-1 text-[11px] font-normal text-slate-400">aujourd&apos;hui</span>
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
      <div className="stat-card stat-card--info">
        <div className="flex items-center gap-2">
          <HealthDot
            tone={jobsTone}
            label={jobs.isSuccess && running > 0 ? "Missions en cours" : "État liste missions"}
          />
          <p className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Missions</p>
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
    </div>
  );
}
