"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertBox, LoadingLine, PageHeader, PageShell, SectionCard } from "../../../components/ui/PageChrome";
import { businessApi, formatTaskCreated, type BizWorkTask } from "../../../lib/business";

function dueDay(value: string | null | undefined) {
  return (value || "").slice(0, 10);
}

export default function GestionTachesPage() {
  const qc = useQueryClient();
  const [showDone, setShowDone] = useState(false);
  const [error, setError] = useState("");

  const tasks = useQuery({
    queryKey: ["work-tasks", "all"],
    queryFn: () => businessApi.listTasks(),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["work-tasks"] });
    void qc.invalidateQueries({ queryKey: ["business-events"] });
    void qc.invalidateQueries({ queryKey: ["admin-briefing"] });
  };

  const save = useMutation({
    mutationFn: (body: { id: string; patch: { status?: "open" | "done"; due_at?: string | null; urgent?: boolean } }) =>
      businessApi.updateTask(body.id, body.patch),
    onSuccess: () => {
      setError("");
      refresh();
    },
    onError: (err: Error) => setError(err.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => businessApi.deleteTask(id),
    onSuccess: () => {
      setError("");
      refresh();
    },
    onError: (err: Error) => setError(err.message),
  });

  const rows = (tasks.data || []).filter((task: BizWorkTask) => showDone || task.status !== "done");

  return (
    <PageShell size="wide" className="space-y-6">
      <PageHeader
        accent="emerald"
        badge="Tâches"
        title="Tâches à faire"
        description="Elles n'ont pas besoin d'un projet. Celles du jour sont aussi sur Aujourd'hui. Une date les pose sur le calendrier."
        actions={
          <Link href="/briefing#board-tasks" className="btn-primary">
            Voir dans Aujourd'hui
          </Link>
        }
      />

      <SectionCard
        title={`Tâches (${rows.length})`}
        action={
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
            <input type="checkbox" checked={showDone} onChange={(event) => setShowDone(event.target.checked)} />
            Afficher les faites
          </label>
        }
      >
        {tasks.isLoading ? <LoadingLine /> : null}
        {tasks.isError ? <AlertBox tone="error" title="Erreur">Chargement impossible.</AlertBox> : null}
        {error ? <p className="mb-2 text-sm text-red-700">{error}</p> : null}
        {!tasks.isLoading && rows.length === 0 ? (
          <p className="text-sm text-slate-500">
            Aucune tâche.{" "}
            <Link href="/briefing#board-tasks" className="font-medium text-emerald-800 underline">
              En ajouter une dans Aujourd&apos;hui
            </Link>
          </p>
        ) : null}
        <ul className="divide-y divide-slate-100">
          {rows.map((task) => {
            const created = formatTaskCreated(task.created_at);
            return (
            <li
              key={task.id}
              className={`flex flex-wrap items-start gap-2 py-3 ${task.urgent ? "rounded-lg bg-rose-50 px-2" : ""}`}
            >
              <input
                type="checkbox"
                className="mt-1"
                checked={task.status === "done"}
                disabled={save.isPending}
                aria-label={task.status === "done" ? `Rouvrir « ${task.title} »` : `Marquer « ${task.title} » comme faite`}
                onChange={(event) => save.mutate({
                  id: task.id,
                  patch: { status: event.target.checked ? "done" : "open" },
                })}
              />
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-semibold text-slate-900 ${task.status === "done" ? "line-through opacity-60" : ""}`}>
                  {task.priority ? <span className="mr-1.5 text-xs font-bold text-violet-800">{task.priority}</span> : null}
                  {task.title}
                </p>
                <p className="text-xs text-slate-500">
                  {created ? `Créée le ${created}` : "Date de création inconnue"}
                  {task.notes ? ` · ${task.notes}` : ""}
                </p>
              </div>
              <button
                type="button"
                aria-pressed={Boolean(task.urgent)}
                aria-label={task.urgent ? `Retirer l'urgence de « ${task.title} »` : `Marquer « ${task.title} » comme urgent`}
                disabled={save.isPending}
                className={
                  task.urgent
                    ? "touch-target inline-flex items-center rounded-lg border border-rose-300 bg-rose-100 px-3 text-xs font-bold text-rose-800"
                    : "touch-target inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600"
                }
                onClick={() => save.mutate({ id: task.id, patch: { urgent: !task.urgent } })}
              >
                Urgent
              </button>
              <input
                type="date"
                className="input-field w-40 text-sm"
                value={dueDay(task.due_at)}
                aria-label={`Date de « ${task.title} »`}
                onChange={(event) => save.mutate({ id: task.id, patch: { due_at: event.target.value || null } })}
              />
              <button
                type="button"
                className="touch-target inline-flex items-center rounded-lg border border-red-200 bg-red-50 px-3 text-xs font-semibold text-red-800"
                disabled={remove.isPending}
                onClick={() => remove.mutate(task.id)}
              >
                Retirer
              </button>
            </li>
            );
          })}
        </ul>
      </SectionCard>
    </PageShell>
  );
}
