"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { PageHeader, SectionCard } from "../../../components/ui/PageChrome";
import { agentHeaders, requestJson } from "../../../lib/api";

type ApifyRun = {
  id: string;
  actor_id?: string | null;
  status?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  dataset_id?: string | null;
  usage_usd?: number | null;
};

type ApifyStatus = { enabled: boolean; configured: boolean; default_actor: string | null };
type ApifyResults = { run: ApifyRun; items: Record<string, unknown>[]; ready: boolean };

const ACTIVE = new Set(["READY", "RUNNING"]);

const visibleInterval = (ms: number) =>
  typeof document !== "undefined" && document.visibilityState === "visible" ? ms : false;

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value).slice(0, 160);
  return String(value).slice(0, 160);
}

export default function AdministrationApifyPage() {
  const qc = useQueryClient();
  const [actorId, setActorId] = useState("");
  const [inputText, setInputText] = useState("{\n  \n}");
  const [formError, setFormError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<"table" | "json">("table");

  const status = useQuery({
    queryKey: ["apify-status"],
    queryFn: async () => (await requestJson("/admin/apify/status", { headers: agentHeaders() })).data as ApifyStatus,
  });
  const ready = Boolean(status.data?.enabled && status.data?.configured);

  const runs = useQuery({
    queryKey: ["apify-runs"],
    enabled: ready,
    queryFn: async () =>
      ((await requestJson("/admin/apify/runs?limit=20", { headers: agentHeaders() })).data as { items: ApifyRun[] }).items,
    refetchInterval: () => visibleInterval(20000),
  });

  const run = useQuery({
    queryKey: ["apify-run", selected],
    enabled: ready && Boolean(selected),
    queryFn: async () =>
      ((await requestJson(`/admin/apify/runs/${selected}`, { headers: agentHeaders() })).data as { run: ApifyRun }).run,
    refetchInterval: (q) => (ACTIVE.has(String(q.state.data?.status || "")) ? visibleInterval(5000) : false),
  });

  const results = useQuery({
    queryKey: ["apify-results", selected, run.data?.status],
    enabled: ready && Boolean(selected) && run.data?.status === "SUCCEEDED",
    queryFn: async () =>
      (await requestJson(`/admin/apify/runs/${selected}/results?limit=200`, { headers: agentHeaders(), timeoutMs: 90_000 }))
        .data as ApifyResults,
  });

  const start = useMutation({
    mutationFn: async (body: { actor_id: string; input: Record<string, unknown> }) =>
      ((await requestJson("/admin/apify/runs", {
        method: "POST",
        headers: { ...agentHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })).data as { run: ApifyRun }).run,
    onSuccess: (r) => {
      setSelected(r.id);
      qc.invalidateQueries({ queryKey: ["apify-runs"] });
    },
  });

  const submit = () => {
    setFormError(null);
    let parsed: unknown;
    try {
      parsed = inputText.trim() ? JSON.parse(inputText) : {};
    } catch {
      setFormError("Entrée JSON invalide.");
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      setFormError("L'entrée doit être un objet JSON.");
      return;
    }
    start.mutate({ actor_id: actorId.trim(), input: parsed as Record<string, unknown> });
  };

  const items = results.data?.items ?? [];
  const columns = Array.from(new Set(items.slice(0, 50).flatMap((i) => Object.keys(i)))).slice(0, 8);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Robots Apify"
        description="Lancer un robot (Actor) Apify, suivre son exécution et consulter ses résultats. Rien n'est enregistré dans la base."
      />

      {status.data && !ready ? (
        <SectionCard title="Apify non configuré" tone="default">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {status.data.enabled
              ? "Ajoutez APIFY_API_TOKEN dans les variables d'environnement Coolify puis redéployez (voir docs/APIFY-INTEGRATION.md)."
              : "L'intégration est désactivée (APIFY_ENABLED=0)."}
          </p>
        </SectionCard>
      ) : null}

      <SectionCard title="Nouveau lancement" description="Chaque lancement consomme des crédits Apify.">
        <div className="space-y-3">
          <label className="block text-sm font-semibold">
            Robot (Actor)
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-950"
              placeholder={status.data?.default_actor || "ex. compass/crawler-google-places"}
              value={actorId}
              onChange={(e) => setActorId(e.target.value)}
            />
          </label>
          <label className="block text-sm font-semibold">
            Entrée JSON
            <textarea
              className="mt-1 h-40 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
            />
          </label>
          {formError || start.error ? (
            <p className="text-sm text-red-600">{formError || (start.error as Error).message}</p>
          ) : null}
          <button
            type="button"
            disabled={!ready || start.isPending}
            onClick={submit}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {start.isPending ? "Lancement…" : "Lancer le robot"}
          </button>
        </div>
      </SectionCard>

      <SectionCard title="Lancements récents">
        {runs.error ? <p className="text-sm text-red-600">{(runs.error as Error).message}</p> : null}
        <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-800">
          {(runs.data ?? []).map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setSelected(r.id)}
                className={`flex w-full justify-between gap-3 px-2 py-2 text-left ${selected === r.id ? "bg-violet-50 dark:bg-violet-950/40" : ""}`}
              >
                <span className="font-mono">{r.id}</span>
                <span>{r.status}</span>
                <span className="text-slate-500">{r.started_at ? new Date(r.started_at).toLocaleString("fr-FR") : ""}</span>
              </button>
            </li>
          ))}
          {ready && runs.data && runs.data.length === 0 ? <li className="py-2 text-slate-500">Aucun lancement.</li> : null}
        </ul>
      </SectionCard>

      {selected ? (
        <SectionCard
          title={`Lancement ${selected}`}
          description={run.data ? `Statut : ${run.data.status}${run.data.usage_usd != null ? ` · coût ${run.data.usage_usd.toFixed(4)} $` : ""}` : "Chargement…"}
          action={
            <button type="button" className="text-xs font-bold text-violet-700" onClick={() => setView(view === "table" ? "json" : "table")}>
              {view === "table" ? "Voir le JSON" : "Voir le tableau"}
            </button>
          }
        >
          {run.error ? <p className="text-sm text-red-600">{(run.error as Error).message}</p> : null}
          {run.data && run.data.status !== "SUCCEEDED" ? (
            <p className="text-sm text-slate-500">Les résultats s’afficheront quand le robot aura terminé avec succès.</p>
          ) : null}
          {results.isFetching ? <p className="text-sm text-slate-500">Récupération des résultats…</p> : null}
          {results.data ? (
            view === "json" ? (
              <pre className="max-h-[32rem] overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">
                {JSON.stringify(items, null, 2)}
              </pre>
            ) : (
              <div className="max-h-[32rem] overflow-auto">
                <p className="mb-2 text-xs text-slate-500">{items.length} élément(s)</p>
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr>
                      {columns.map((c) => (
                        <th key={c} className="border-b px-2 py-1 font-bold">{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, idx) => (
                      <tr key={idx} className="border-b border-slate-100 dark:border-slate-800">
                        {columns.map((c) => (
                          <td key={c} className="px-2 py-1 align-top">{cell(it[c])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : null}
        </SectionCard>
      ) : null}
    </div>
  );
}
