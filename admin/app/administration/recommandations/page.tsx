"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { agentHeaders, requestJson } from "../../../lib/api";

type ConfigSuggestion = {
  id: string;
  kind: string;
  target_key: string;
  title: string;
  body: string;
  status: string;
  created_at: string;
  payload?: Record<string, unknown>;
};

const KIND_LABELS: Record<string, string> = {
  integration: "Intégration",
  orchestration: "Orchestration",
  budget: "Budget",
  llm: "LLM",
  misc: "Divers",
};

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function RecommandationsPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"pending" | "">("pending");
  const [toast, setToast] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ["config-suggestions", filter],
    queryFn: async () => {
      const qs = filter ? `?status=${filter}` : "";
      const { data } = await requestJson(`/admin/config-suggestions${qs}`, { headers: agentHeaders() });
      return (data.suggestions ?? []) as ConfigSuggestion[];
    },
  });

  const scanMutation = useMutation({
    mutationFn: async () => {
      const { data } = await requestJson("/admin/config-suggestions/scan", {
        method: "POST",
        headers: agentHeaders(),
      });
      return data as { count?: number };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["config-suggestions"] });
      setToast(`${data.count ?? 0} nouvelle(s) recommandation(s).`);
      setTimeout(() => setToast(null), 3500);
    },
  });

  const resolveMutation = useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: "dismiss" | "acknowledge" }) => {
      await requestJson(`/admin/config-suggestions/${id}/resolve`, {
        method: "POST",
        headers: agentHeaders(),
        body: JSON.stringify({ decision }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["config-suggestions"] });
    },
  });

  const items = listQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Recommandations système</h1>
        <p className="mt-1 text-sm text-slate-500">
          Observations issues des missions et de la santé outils. Aucune modification automatique de la configuration
          — appliquez les changements manuellement dans{" "}
          <Link href="/administration/integrations" className="text-violet-700 underline">
            Intégrations
          </Link>
          ,{" "}
          <Link href="/administration/comportements" className="text-violet-700 underline">
            Comportements
          </Link>{" "}
          ou{" "}
          <Link href="/administration/orchestration" className="text-violet-700 underline">
            Orchestration
          </Link>
          .
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as "pending" | "")}
          className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="pending">En attente</option>
          <option value="">Toutes</option>
        </select>
        <button
          type="button"
          onClick={() => scanMutation.mutate()}
          disabled={scanMutation.isPending}
          className="rounded-xl bg-violet-700 px-4 py-2 text-sm font-medium text-white hover:bg-violet-800 disabled:opacity-50"
        >
          {scanMutation.isPending ? "Analyse…" : "Analyser maintenant"}
        </button>
      </div>

      {listQuery.isLoading ? <p className="text-sm text-slate-400">Chargement…</p> : null}
      {!listQuery.isLoading && items.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-600">
          Aucune recommandation {filter === "pending" ? "en attente" : ""}.
        </p>
      ) : null}

      <div className="space-y-3">
        {items.map((s) => (
          <article key={s.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                    {KIND_LABELS[s.kind] ?? s.kind}
                  </span>
                  {s.target_key ? (
                    <span className="text-xs text-slate-400">{s.target_key}</span>
                  ) : null}
                  <span className="text-xs text-slate-400">{fmtDate(s.created_at)}</span>
                </div>
                <h2 className="mt-2 font-semibold text-slate-900">{s.title}</h2>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{s.body}</p>
              </div>
              {s.status === "pending" ? (
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => resolveMutation.mutate({ id: s.id, decision: "acknowledge" })}
                    disabled={resolveMutation.isPending}
                    className="rounded-xl border border-emerald-200 px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-50"
                  >
                    Pris en compte
                  </button>
                  <button
                    type="button"
                    onClick={() => resolveMutation.mutate({ id: s.id, decision: "dismiss" })}
                    disabled={resolveMutation.isPending}
                    className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    Ignorer
                  </button>
                </div>
              ) : (
                <span className="text-xs font-medium text-slate-500">{s.status}</span>
              )}
            </div>
          </article>
        ))}
      </div>

      {toast ? (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl bg-slate-900 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
