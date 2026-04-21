"use client";

import { FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MEMORY_CONTEXT_KEYS, MEMORY_CONTEXT_TITLES } from "../lib/agentMemory";
import { agentHeaders, requestJson } from "../lib/api";

const CONTEXT_FIELDS = MEMORY_CONTEXT_KEYS.map((key) => ({ key, title: MEMORY_CONTEXT_TITLES[key] }));

type MemoryPayload = {
  contexts?: Record<string, string>;
  recent_missions?: unknown[];
  updated_at?: string | null;
};

export default function EnterpriseMemoryPanel() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [savedMsg, setSavedMsg] = useState("");

  const q = useQuery({
    queryKey: ["enterprise-memory"],
    queryFn: async () => (await requestJson("/memory", { headers: agentHeaders(), retries: 1 })).data as MemoryPayload,
  });

  useEffect(() => {
    const ctx = q.data?.contexts;
    if (ctx && typeof ctx === "object") {
      const next: Record<string, string> = {};
      for (const { key } of CONTEXT_FIELDS) {
        next[key] = String((ctx as Record<string, unknown>)[key] ?? "");
      }
      setDraft(next);
    }
  }, [q.data]);

  const save = useMutation({
    mutationFn: async () => {
      const { data } = await requestJson("/memory", {
        method: "PUT",
        headers: agentHeaders(),
        body: JSON.stringify({ contexts: draft }),
      });
      return data as MemoryPayload;
    },
    onSuccess: () => {
      setSavedMsg("Mémoire enregistrée.");
      void qc.invalidateQueries({ queryKey: ["enterprise-memory"] });
    },
    onError: () => {
      setSavedMsg("");
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSavedMsg("");
    save.mutate();
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900 tracking-tight">Mémoire entreprise</h2>
      <p className="text-sm text-slate-500 mt-2 leading-relaxed">
        Texte persisté en base, injecté dans les invites du CIO (vue globale + périmètres par rôle) et des sous-agents
        (extrait global + leur volet). Les missions terminées alimentent aussi un fil court de missions récentes.
      </p>
      {q.isLoading ? <p className="mt-4 text-sm text-slate-400">Chargement…</p> : null}
      {q.isError ? <p className="mt-4 text-sm text-red-700">Impossible de charger la mémoire (secret agent requis).</p> : null}
      {save.isError ? (
        <p className="mt-2 text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {save.error instanceof Error ? save.error.message : String(save.error)}
        </p>
      ) : null}
      {savedMsg ? (
        <p className="mt-2 text-sm text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">{savedMsg}</p>
      ) : null}
      {q.isSuccess ? (
        <form onSubmit={onSubmit} className="mt-5 space-y-5">
          {CONTEXT_FIELDS.map(({ key, title }) => (
            <div key={key}>
              <label className="block text-xs font-semibold uppercase tracking-wider text-sky-700 mb-1.5">{title}</label>
              <textarea
                rows={5}
                value={draft[key] ?? ""}
                onChange={(e) => setDraft((p) => ({ ...p, [key]: e.target.value }))}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400"
                placeholder="Notes stables pour ce volet…"
              />
            </div>
          ))}
          <div className="flex flex-wrap gap-3 pt-2">
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
            <p className="text-[11px] text-slate-400">Dernière mise à jour : {String(q.data.updated_at)}</p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
