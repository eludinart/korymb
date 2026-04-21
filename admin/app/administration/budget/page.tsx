"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { requestJson, agentHeaders } from "../../../lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

type TokensPayload = {
  today: string;
  tokens_in: number;
  tokens_out: number;
  total: number;
  cost_usd: number;
  alert: boolean;
  budget_exceeded: boolean;
  alert_threshold: number;
  cost_total_usd: number;
  cost_today_usd: number;
  cost_week_usd: number;
  cost_month_usd: number;
  cost_last_hour_usd: number;
  usage_tokens_today: number;
  usage_tokens_week: number;
  usage_tokens_month: number;
  usage_tokens_total: number;
};

type BudgetConfig = {
  token_alert_threshold: number;
  daily_budget_usd: number;
  llm_price_input_per_million_usd: number;
  llm_price_output_per_million_usd: number;
};

type DailyPoint = { date: string; cost_usd: number; tokens: number };

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtCost(v: number): string {
  if (v >= 1) return `$${v.toFixed(3)}`;
  if (v >= 0.001) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(6)}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
  } catch {
    return iso.slice(5);
  }
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "ok" | "warn" | "danger";
}) {
  const accentClass =
    accent === "danger"
      ? "border-red-200 bg-red-50"
      : accent === "warn"
      ? "border-amber-200 bg-amber-50"
      : "border-slate-200 bg-white";

  return (
    <div className={`rounded-2xl border p-5 ${accentClass}`}>
      <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</p>
      <p
        className={`mt-1 text-2xl font-bold ${
          accent === "danger" ? "text-red-700" : accent === "warn" ? "text-amber-700" : "text-slate-900"
        }`}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

// ── Bar chart ─────────────────────────────────────────────────────────────────

function BurnChart({ data }: { data: DailyPoint[] }) {
  const maxCost = Math.max(...data.map((d) => d.cost_usd), 0.000001);
  const maxTokens = Math.max(...data.map((d) => d.tokens), 1);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6">
      <p className="text-sm font-semibold text-slate-800 mb-4">Burn rate — 7 derniers jours</p>
      <div className="flex items-end gap-2 h-32">
        {data.map((d) => {
          const heightCost = Math.max(4, Math.round((d.cost_usd / maxCost) * 120));
          const heightTok = Math.max(4, Math.round((d.tokens / maxTokens) * 120));
          return (
            <div key={d.date} className="flex flex-1 flex-col items-center gap-1 group relative">
              {/* Tooltip */}
              <div className="absolute -top-14 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col items-center z-10 pointer-events-none">
                <div className="rounded-xl bg-slate-900 px-3 py-1.5 text-xs text-white whitespace-nowrap shadow-lg">
                  <p className="font-medium">{fmtDate(d.date)}</p>
                  <p>{fmtCost(d.cost_usd)} — {fmtTokens(d.tokens)} tokens</p>
                </div>
                <div className="border-4 border-transparent border-t-slate-900 w-0 h-0" />
              </div>

              {/* Bars side by side */}
              <div className="flex items-end gap-0.5 w-full">
                <div
                  className="flex-1 rounded-t-lg bg-violet-500 opacity-80 transition-all"
                  style={{ height: `${heightCost}px` }}
                />
                <div
                  className="flex-1 rounded-t-lg bg-slate-300 transition-all"
                  style={{ height: `${heightTok}px` }}
                />
              </div>

              {/* Label */}
              <p className="text-xs text-slate-400 leading-none">{fmtDate(d.date)}</p>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-violet-500" /> Coût USD
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-slate-300" /> Tokens
        </span>
      </div>
    </div>
  );
}

// ── Settings form ─────────────────────────────────────────────────────────────

function BudgetSettingsForm({ showToast }: { showToast: (m: string, ok?: boolean) => void }) {
  const budgetQ = useQuery({
    queryKey: ["budget-config"],
    queryFn: async () => {
      const { data } = await requestJson("/config/budget", { headers: agentHeaders() });
      return data as BudgetConfig;
    },
  });

  const [form, setForm] = useState<BudgetConfig | null>(null);

  useEffect(() => {
    if (budgetQ.data && !form) {
      setForm(budgetQ.data);
    }
  }, [budgetQ.data, form]);

  const saveMutation = useMutation({
    mutationFn: async (cfg: BudgetConfig) => {
      await requestJson("/config/budget", {
        method: "PUT",
        headers: agentHeaders(),
        body: JSON.stringify(cfg),
      });
    },
    onSuccess: () => {
      showToast("Paramètres budget sauvegardés.");
      setForm(null);
    },
    onError: (e: Error) => showToast(e.message || "Erreur sauvegarde", false),
  });

  const current = form ?? budgetQ.data;
  const isDirty = form !== null;

  if (budgetQ.isLoading) return <p className="text-sm text-slate-400">Chargement…</p>;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold text-slate-800">Paramètres Budget & Coût</h3>
        <div className="flex gap-2">
          {isDirty && (
            <button
              onClick={() => setForm(null)}
              className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50"
            >
              Annuler
            </button>
          )}
          <button
            onClick={() => current && saveMutation.mutate(current)}
            disabled={saveMutation.isPending || !isDirty}
            className="rounded-xl bg-violet-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-violet-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saveMutation.isPending ? "Sauvegarde…" : "Sauvegarder"}
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Seuil d'alerte tokens / jour
          </label>
          <input
            type="number"
            min={0}
            step={1000}
            value={current?.token_alert_threshold ?? 30000}
            onChange={(e) =>
              setForm((f) => ({ ...(f ?? (current as BudgetConfig)), token_alert_threshold: parseInt(e.target.value) || 0 }))
            }
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
          <p className="mt-1 text-xs text-slate-400">Déclenche le badge "Alerte" dans la barre d'état</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Budget quotidien USD <span className="text-slate-400">(0 = désactivé)</span>
          </label>
          <input
            type="number"
            min={0}
            step={0.1}
            value={current?.daily_budget_usd ?? 0}
            onChange={(e) =>
              setForm((f) => ({ ...(f ?? (current as BudgetConfig)), daily_budget_usd: parseFloat(e.target.value) || 0 }))
            }
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
          <p className="mt-1 text-xs text-slate-400">Limite budgétaire de référence (affichage uniquement)</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Prix input (USD / million de tokens)
          </label>
          <input
            type="number"
            min={0}
            step={0.1}
            value={current?.llm_price_input_per_million_usd ?? 3}
            onChange={(e) =>
              setForm((f) => ({ ...(f ?? (current as BudgetConfig)), llm_price_input_per_million_usd: parseFloat(e.target.value) || 0 }))
            }
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Prix output (USD / million de tokens)
          </label>
          <input
            type="number"
            min={0}
            step={0.5}
            value={current?.llm_price_output_per_million_usd ?? 15}
            onChange={(e) =>
              setForm((f) => ({ ...(f ?? (current as BudgetConfig)), llm_price_output_per_million_usd: parseFloat(e.target.value) || 0 }))
            }
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function BudgetPage() {
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  const tokens = useQuery({
    queryKey: ["tokens-live"],
    queryFn: async () => {
      const { data } = await requestJson("/tokens");
      return data as TokensPayload;
    },
    refetchInterval: 30_000,
  });

  const daily = useQuery({
    queryKey: ["tokens-daily"],
    queryFn: async () => {
      const { data } = await requestJson("/tokens/daily?days=7", { headers: agentHeaders() });
      return (data.daily ?? []) as DailyPoint[];
    },
    refetchInterval: 60_000,
  });

  const t = tokens.data;

  const alertLevel =
    t?.budget_exceeded ? "danger" : t?.alert ? "warn" : "ok";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Budget & Coûts</h1>
        <p className="mt-1 text-sm text-slate-500">
          Suivi du burn rate LLM en temps réel — rafraîchissement toutes les 30 secondes.
        </p>
      </div>

      {/* Status badges */}
      {t && (t.alert || t.budget_exceeded) && (
        <div
          className={`flex items-center gap-3 rounded-2xl border px-5 py-3 ${
            t.budget_exceeded
              ? "border-red-200 bg-red-50 text-red-800"
              : "border-amber-200 bg-amber-50 text-amber-800"
          }`}
        >
          <span className="text-lg">{t.budget_exceeded ? "🚨" : "⚠️"}</span>
          <span className="text-sm font-medium">
            {t.budget_exceeded
              ? "Budget dépassé — seuil d'utilisation critique atteint."
              : `Alerte seuil — ${fmtTokens(t.total)} tokens aujourd'hui (seuil : ${fmtTokens(t.alert_threshold)}).`}
          </span>
        </div>
      )}

      {/* Stat grid */}
      {tokens.isLoading && <p className="text-sm text-slate-400">Chargement…</p>}
      {t && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Coût aujourd'hui"
            value={fmtCost(t.cost_usd)}
            sub={`${fmtTokens(t.total)} tokens`}
            accent={alertLevel}
          />
          <StatCard
            label="Coût cette semaine"
            value={fmtCost(t.cost_week_usd)}
            sub={`${fmtTokens(t.usage_tokens_week)} tokens`}
          />
          <StatCard
            label="Coût ce mois"
            value={fmtCost(t.cost_month_usd)}
            sub={`${fmtTokens(t.usage_tokens_month)} tokens`}
          />
          <StatCard
            label="Total cumulé"
            value={fmtCost(t.cost_total_usd)}
            sub={`${fmtTokens(t.usage_tokens_total)} tokens`}
          />
        </div>
      )}

      {/* Burn rate chart */}
      {daily.data && daily.data.length > 0 && (
        <BurnChart data={daily.data} />
      )}

      {/* Detailed breakdown */}
      {t && (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Dernière heure</p>
            <p className="mt-1 text-xl font-bold text-slate-900">{fmtCost(t.cost_last_hour_usd)}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Tokens input</p>
            <p className="mt-1 text-xl font-bold text-slate-900">{fmtTokens(t.tokens_in)}</p>
            <p className="text-xs text-slate-400 mt-0.5">aujourd'hui</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Tokens output</p>
            <p className="mt-1 text-xl font-bold text-slate-900">{fmtTokens(t.tokens_out)}</p>
            <p className="text-xs text-slate-400 mt-0.5">aujourd'hui</p>
          </div>
        </div>
      )}

      {/* Settings */}
      <BudgetSettingsForm showToast={showToast} />

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 rounded-xl px-5 py-3 text-sm font-medium text-white shadow-lg ${
            toast.ok ? "bg-emerald-600" : "bg-red-600"
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
