"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { requestJson } from "../../../lib/api";

type EnvelopeRow = {
  workspace_id: string;
  name?: string;
  slug?: string;
  owner_email?: string;
  owner_name?: string;
  billing?: string;
  exempt?: boolean;
  own_key?: boolean;
  paused?: boolean;
  monthly_token_cap?: number;
  tokens_used_month?: number;
  tokens_remaining?: number | null;
  percent?: number;
  last_call_at?: string;
  blocked?: boolean;
};

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M`;
  if (n >= 1000) return `${Math.round(n / 1000)} k`;
  return String(n);
}

function billingLabel(row: EnvelopeRow): string {
  if (row.exempt || row.billing === "exempt") return "Interne — hors enveloppe";
  if (row.own_key || row.billing === "own") return "Clé propre";
  return "Clé plateforme";
}

function RowEditor({ row }: { row: EnvelopeRow }) {
  const qc = useQueryClient();
  const locked = Boolean(row.exempt || row.billing === "exempt");
  const [cap, setCap] = useState(String(row.monthly_token_cap ?? 500000));
  const [paused, setPaused] = useState(Boolean(row.paused));
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      const capNum = Number(cap);
      if (!Number.isFinite(capNum) || capNum < 0) {
        throw new Error("Le plafond doit être un nombre de tokens.");
      }
      const { data } = await requestJson(`/platform/llm-envelopes/${encodeURIComponent(row.workspace_id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthly_token_cap: Math.round(capNum), paused }),
      });
      return data as EnvelopeRow;
    },
    onSuccess: async () => {
      setError("");
      setMessage("Enregistré.");
      await qc.invalidateQueries({ queryKey: ["platform-envelopes"] });
    },
    onError: (err: Error) => {
      setMessage("");
      setError(err.message || "Enregistrement impossible.");
    },
  });

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-50">{row.name || row.workspace_id}</h2>
          <p className="text-xs text-slate-500">
            {row.owner_name ? `${row.owner_name} · ` : ""}
            {row.owner_email || "sans propriétaire"} · {row.slug}
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
          {billingLabel(row)}
        </span>
      </div>
      <p className="mt-3 text-sm text-slate-700 dark:text-slate-200">
        {row.billing === "platform"
          ? `${fmtTokens(Number(row.tokens_used_month || 0))} utilisés ce mois · reste ${fmtTokens(Number(row.tokens_remaining || 0))} · ${row.percent ?? 0} %`
          : "Le plafond ne s'applique pas à cet espace."}
        {row.last_call_at ? ` · dernier appel ${row.last_call_at.slice(0, 16).replace("T", " ")}` : ""}
      </p>
      {locked ? null : (
        <form
          className="mt-4 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setMessage("");
            setError("");
            save.mutate();
          }}
        >
          <label className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            Plafond mensuel (tokens)
            <input
              type="number"
              min={0}
              step={10000}
              value={cap}
              onChange={(e) => setCap(e.target.value)}
              className="mt-1 block w-40 rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-950"
            />
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} />
            Pause IA
          </label>
          <button
            type="submit"
            disabled={save.isPending}
            className="rounded-xl bg-violet-700 px-4 py-2 text-sm font-bold text-white hover:bg-violet-800 disabled:opacity-50"
          >
            {save.isPending ? "Enregistrement…" : "Enregistrer"}
          </button>
          {message ? <p className="pb-2 text-sm font-semibold text-emerald-700">{message}</p> : null}
          {error ? <p className="pb-2 text-sm font-semibold text-red-700">{error}</p> : null}
        </form>
      )}
    </article>
  );
}

export default function EnveloppesPage() {
  const query = useQuery({
    queryKey: ["platform-envelopes"],
    queryFn: async () => {
      const { data } = await requestJson("/platform/llm-envelopes");
      return (data.envelopes ?? []) as EnvelopeRow[];
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">Enveloppes IA</h1>
        <p className="mt-1 text-sm text-slate-500">
          Consommation des espaces sur la clé du serveur. Un espace avec sa propre clé n&apos;est pas plafonné.
          Défaut : 500 000 tokens par mois.
        </p>
      </div>
      {query.isLoading ? <p className="text-sm text-slate-500">Chargement des espaces…</p> : null}
      {query.isError ? (
        <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {(query.error as Error)?.message || "Impossible de lire les enveloppes."}
        </p>
      ) : null}
      {query.data?.map((row) => (
        <RowEditor key={row.workspace_id} row={row} />
      ))}
      {query.data && query.data.length === 0 ? (
        <p className="text-sm text-slate-500">Aucun espace.</p>
      ) : null}
    </div>
  );
}
