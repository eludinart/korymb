"use client";

import { FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { agentHeaders, requestJson } from "../lib/api";

type MemoryPayload = {
  contexts?: Record<string, string>;
  recent_missions?: unknown[];
  updated_at?: string | null;
};

type Props = {
  contextKey: string;
  /** Titre du volet (ex. libellé de l’agent). */
  memoryTitle: string;
  /** Texte d’aide sous le titre */
  description?: string;
  /** Affiche le fil des missions récentes (lecture seule), utile pour le contexte global. */
  showRecentMissions?: boolean;
};

export default function EnterpriseMemoryContextPanel({
  contextKey,
  memoryTitle,
  description,
  showRecentMissions,
}: Props) {
  const qc = useQueryClient();
  const title = memoryTitle;
  const [draft, setDraft] = useState("");
  const [savedMsg, setSavedMsg] = useState("");

  const q = useQuery({
    queryKey: ["enterprise-memory"],
    queryFn: async () => (await requestJson("/memory", { headers: agentHeaders(), retries: 1 })).data as MemoryPayload,
  });

  useEffect(() => {
    const ctx = q.data?.contexts;
    if (ctx && typeof ctx === "object") {
      setDraft(String((ctx as Record<string, unknown>)[contextKey] ?? ""));
    }
  }, [q.data, contextKey]);

  const save = useMutation({
    mutationFn: async () => {
      const { data } = await requestJson("/memory", {
        method: "PUT",
        headers: agentHeaders(),
        body: JSON.stringify({ contexts: { [contextKey]: draft } }),
      });
      return data as MemoryPayload;
    },
    onSuccess: () => {
      setSavedMsg("Volet enregistré (les autres contextes sont inchangés).");
      void qc.invalidateQueries({ queryKey: ["enterprise-memory"] });
    },
    onError: () => setSavedMsg(""),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSavedMsg("");
    save.mutate();
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold tracking-tight text-slate-900">Mémoire entreprise — {title}</h2>
      {description ? <p className="mt-2 text-sm leading-relaxed text-slate-500">{description}</p> : null}
      {q.isLoading ? <p className="mt-4 text-sm text-slate-400">Chargement…</p> : null}
      {q.isError ? (
        <p className="mt-4 text-sm text-red-700">Impossible de charger la mémoire (secret agent requis).</p>
      ) : null}
      {save.isError ? (
        <p className="mt-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
          {save.error instanceof Error ? save.error.message : String(save.error)}
        </p>
      ) : null}
      {savedMsg ? (
        <p className="mt-2 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{savedMsg}</p>
      ) : null}
      {q.isSuccess ? (
        <form onSubmit={onSubmit} className="mt-5 space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-sky-700">
              Notes pour ce volet
            </label>
            <textarea
              rows={10}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400"
              placeholder="Notes stables pour ce volet…"
            />
          </div>
          <div className="flex flex-wrap gap-3 pt-1">
            <button
              type="submit"
              disabled={save.isPending}
              className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40"
            >
              {save.isPending ? "Enregistrement…" : "Enregistrer"}
            </button>
            <button
              type="button"
              onClick={() => void q.refetch()}
              className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
            >
              Recharger
            </button>
          </div>
          {q.data?.updated_at ? (
            <p className="text-[11px] text-slate-400">Dernière mise à jour en base : {String(q.data.updated_at)}</p>
          ) : null}
          {showRecentMissions && Array.isArray(q.data?.recent_missions) && q.data.recent_missions.length > 0 ? (
            <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Missions récentes (fil court)</p>
              <ul className="mt-2 space-y-2 text-xs text-slate-600">
                {(q.data.recent_missions as Record<string, unknown>[]).slice(0, 8).map((row, i) => (
                  <li key={String(row.job_id ?? i)} className="font-mono">
                    #{String(row.job_id ?? "—")}{" "}
                    <span className="font-sans text-slate-500">{String(row.mission || "").slice(0, 120)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
