"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { requestJson } from "../../../lib/api";

type Identity = {
  id: string;
  name: string;
  role: string;
  configured: boolean;
  webhook_signing: boolean;
  task_counts: Record<string, number>;
  calendar_sync: { enabled: boolean; interval_min: number };
};

type Task = {
  id: string;
  category: string;
  target: string;
  intent: string;
  status: string;
  created_at: string;
  routing?: { reason?: string };
};

type SyncStatus = {
  enabled: boolean;
  interval_min: number;
  calendar_id: string;
  open_conflicts: number;
  last_run?: { created_at: string; summary: Record<string, number> } | null;
};

const TARGET_LABEL: Record<string, string> = {
  korymb: "Korymb (métier)",
  classique: "Classique (perso / technique)",
  concertation: "Concertation Korymb + Classique",
  eric: "Eric (indéterminé)",
};

const AGENTS = [
  { name: "Fleur d'Amours", scope: "Espace métier Korymb", handles: "métier" },
  { name: "Mandala", scope: "Espace métier Korymb", handles: "métier" },
  { name: "Classique", scope: "Agent externe (voix, chat, code)", handles: "perso & technique" },
  { name: "Hermès", scope: "Agent Docker sur le VPS", handles: "briefing, veille logs, smoke, Telegram" },
];

export default function ClassiquePage() {
  const qc = useQueryClient();
  const identity = useQuery({
    queryKey: ["classique-identity"],
    queryFn: async () => (await requestJson("/classique/identity")).data as Identity,
  });
  const tasks = useQuery({
    queryKey: ["classique-tasks"],
    queryFn: async () => ((await requestJson("/classique/admin/tasks")).data.tasks ?? []) as Task[],
  });
  const sync = useQuery({
    queryKey: ["calendar-sync"],
    queryFn: async () => (await requestJson("/calendar-sync/status")).data as SyncStatus,
  });
  const runSync = useMutation({
    mutationFn: async () => (await requestJson("/calendar-sync/run", { method: "POST" })).data,
    onSettled: () => qc.invalidateQueries({ queryKey: ["calendar-sync"] }),
  });

  const id = identity.data;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">Agents connectés</h1>
        <p className="mt-1 text-sm text-slate-500">
          Qui traite quoi : métier → Korymb, perso et technique → Classique, mixte → concertation, indéterminé → Eric.
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-2">
        {AGENTS.map((a) => (
          <article
            key={a.name}
            className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"
          >
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-50">{a.name}</h2>
            <p className="text-xs text-slate-500">{a.scope}</p>
            <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">Prend en charge : {a.handles}</p>
            {a.name === "Classique" && id ? (
              <p className="mt-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                {id.configured ? "Clé API configurée" : "Clé API absente (CLASSIQUE_API_KEY)"} ·{" "}
                {id.webhook_signing ? "webhooks signés" : "webhooks désactivés"}
              </p>
            ) : null}
          </article>
        ))}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <h2 className="text-base font-bold text-slate-900 dark:text-slate-50">Tâches échangées avec Classique</h2>
        {tasks.isLoading ? <p className="text-sm text-slate-500">Chargement…</p> : null}
        {tasks.isError ? <p className="text-sm text-red-700">{(tasks.error as Error).message}</p> : null}
        <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
          {(tasks.data ?? []).map((t) => (
            <li key={t.id} className="py-2 text-sm">
              <span className="font-semibold">{t.intent}</span>
              <span className="text-slate-500">
                {" "}
                · {TARGET_LABEL[t.target] ?? t.target} · {t.status} · {t.created_at?.slice(0, 16).replace("T", " ")}
              </span>
            </li>
          ))}
          {tasks.data && tasks.data.length === 0 ? <li className="py-2 text-sm text-slate-500">Aucune tâche.</li> : null}
        </ul>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <h2 className="text-base font-bold text-slate-900 dark:text-slate-50">Pont Google Agenda</h2>
        {sync.data ? (
          <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">
            {sync.data.enabled
              ? `Actif · toutes les ${sync.data.interval_min} min · agenda ${sync.data.calendar_id}`
              : "Désactivé (KORYMB_GCAL_SYNC_ENABLED)"}{" "}
            · {sync.data.open_conflicts} conflit(s) ouvert(s)
            {sync.data.last_run ? ` · dernier passage ${sync.data.last_run.created_at.slice(0, 16).replace("T", " ")}` : ""}
          </p>
        ) : null}
        <button
          type="button"
          disabled={!sync.data?.enabled || runSync.isPending}
          onClick={() => runSync.mutate()}
          className="mt-3 rounded-xl bg-violet-700 px-4 py-2 text-sm font-bold text-white hover:bg-violet-800 disabled:opacity-50"
        >
          {runSync.isPending ? "Synchronisation…" : "Synchroniser maintenant"}
        </button>
        {runSync.isError ? <p className="mt-2 text-sm text-red-700">{(runSync.error as Error).message}</p> : null}
      </section>
    </div>
  );
}
