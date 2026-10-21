"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertBox, LoadingLine, PageHeader, PageShell, SectionCard } from "../../../components/ui/PageChrome";
import TaskEditDialog from "../../../components/director/TaskEditDialog";
import ReplyComposer from "../../../components/director/ReplyComposer";
import { businessApi, dueDay, dueLabel, formatTaskCreated, todayISO, type BizWorkTask } from "../../../lib/business";

export default function GestionTachesPage() {
  const qc = useQueryClient();
  const [showDone, setShowDone] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<BizWorkTask | null>(null);

  const tasks = useQuery({
    queryKey: ["work-tasks", "all"],
    queryFn: () => businessApi.listTasks(),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["work-tasks"] });
    void qc.invalidateQueries({ queryKey: ["business-events"] });
    void qc.invalidateQueries({ queryKey: ["admin-briefing"] });
    void qc.invalidateQueries({ queryKey: ["director-notifications"] });
  };

  const save = useMutation({
    mutationFn: (body: {
      id: string;
      patch: { status?: "open" | "done"; due_at?: string | null; urgent?: boolean; title?: string; notes?: string; assignee?: string; reply?: string; chat_conversation_id?: string };
    }) => businessApi.updateTask(body.id, body.patch),
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
  const today = todayISO();

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
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((task) => {
            const created = formatTaskCreated(task.created_at);
            const day = dueDay(task.due_at);
            const tone = !day
              ? "text-slate-500"
              : day < today
                ? "text-rose-700 dark:text-rose-300"
                : day === today
                  ? "text-amber-800 dark:text-amber-200"
                  : "text-slate-600 dark:text-slate-300";
            const done = task.status === "done";
            return (
            <li
              key={task.id}
              className={`py-3 ${task.urgent ? "rounded-lg bg-rose-50 px-2 dark:bg-rose-950/40" : ""}`}
            >
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1 size-5 shrink-0"
                  checked={done}
                  disabled={save.isPending}
                  aria-label={done ? `Rouvrir « ${task.title} »` : `Marquer « ${task.title} » comme faite`}
                  onChange={(event) => save.mutate({
                    id: task.id,
                    patch: { status: event.target.checked ? "done" : "open" },
                  })}
                />
                <div className="min-w-0 flex-1">
                  <p className={`break-words text-sm font-semibold text-slate-900 dark:text-slate-50 ${done ? "line-through opacity-60" : ""}`}>
                    {task.priority ? <span className="mr-1.5 text-xs font-bold text-violet-800 dark:text-violet-300">{task.priority}</span> : null}
                    {task.title}
                  </p>
                  <p className="text-xs text-slate-500">
                    {created ? `Créée le ${created}` : "Date de création inconnue"}
                    {task.assignee ? ` · Assignée à ${task.assignee}` : ""}
                  </p>
                  {task.notes ? (
                    <p className="mt-1 break-words text-xs leading-snug text-slate-600 dark:text-slate-300">
                      <span className="font-semibold">Commentaire · </span>
                      {task.notes}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 pl-7">
                <button
                  type="button"
                  aria-pressed={Boolean(task.urgent)}
                  aria-label={task.urgent ? `Retirer l'urgence de « ${task.title} »` : `Marquer « ${task.title} » comme urgent`}
                  disabled={save.isPending}
                  className={
                    task.urgent
                      ? "touch-target inline-flex items-center rounded-lg border border-rose-300 bg-rose-100 px-3 text-xs font-bold text-rose-800 dark:border-rose-700 dark:bg-rose-900 dark:text-rose-100"
                      : "touch-target inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                  }
                  onClick={() => save.mutate({ id: task.id, patch: { urgent: !task.urgent } })}
                >
                  Urgent
                </button>
                <button
                  type="button"
                  className="touch-target inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  disabled={save.isPending || remove.isPending}
                  onClick={() => {
                    setError("");
                    setEditing(task);
                  }}
                >
                  Modifier
                </button>
                <button
                  type="button"
                  className="touch-target inline-flex items-center rounded-lg border border-red-200 bg-red-50 px-3 text-xs font-semibold text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
                  disabled={remove.isPending}
                  onClick={() => {
                    if (!window.confirm(`Supprimer « ${task.title} » ?\n\nLa tâche disparaît définitivement.`)) return;
                    remove.mutate(task.id);
                  }}
                >
                  {remove.isPending && remove.variables === task.id ? "Suppression…" : "Supprimer"}
                </button>
              </div>
              <label className="mt-2 flex w-full min-w-0 max-w-full flex-col gap-1 pl-7 sm:max-w-56">
                <span className={`text-xs font-semibold ${tone}`}>{dueLabel(task.due_at, today)}</span>
                <input
                  type="date"
                  className="input-field min-w-0 max-w-full"
                  value={day}
                  aria-label={`Date de « ${task.title} »`}
                  onChange={(event) => save.mutate({ id: task.id, patch: { due_at: event.target.value || null } })}
                />
              </label>
              <ReplyComposer
                kind="Tâche"
                title={task.title}
                notes={task.notes || ""}
                reply={task.reply || ""}
                replyAt={task.reply_at || ""}
                conversationId={task.chat_conversation_id || ""}
                saving={save.isPending && save.variables?.id === task.id}
                savedLabel={task.reply_at ? `Enregistrée le ${formatTaskCreated(task.reply_at) || "—"}` : ""}
                onSave={(next) => save.mutate({ id: task.id, patch: { reply: next } })}
                onConversationId={async (id) => {
                  await businessApi.updateTask(task.id, { chat_conversation_id: id });
                  refresh();
                }}
              />
            </li>
            );
          })}
        </ul>
      </SectionCard>
      <TaskEditDialog
        task={editing}
        saving={save.isPending}
        error={editing ? error : ""}
        onClose={() => setEditing(null)}
        onSave={(patch) => {
          if (!editing) return;
          save.mutate(
            { id: editing.id, patch },
            { onSuccess: () => setEditing(null) },
          );
        }}
      />
    </PageShell>
  );
}
