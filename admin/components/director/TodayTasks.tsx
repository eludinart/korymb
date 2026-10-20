"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { businessApi, formatTaskCreated, type BizWorkTask } from "../../lib/business";
import TaskEditDialog from "./TaskEditDialog";

function todayISO() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function dueDay(value: string | null | undefined) {
  return (value || "").slice(0, 10);
}

function dueLabel(value: string | null | undefined, today: string) {
  const day = dueDay(value);
  if (!day) return "Sans date";
  if (day < today) return "En retard";
  if (day === today) return "Aujourd'hui";
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return day;
  return new Date(year, month - 1, date).toLocaleDateString("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function sortOpen(tasks: BizWorkTask[], today: string) {
  const rank = (task: BizWorkTask) => {
    const day = dueDay(task.due_at);
    if (!day) return 2;
    if (day < today) return 0;
    if (day === today) return 1;
    return 3;
  };
  return [...tasks].sort((a, b) => {
    const urgentGap = Number(Boolean(b.urgent)) - Number(Boolean(a.urgent));
    if (urgentGap !== 0) return urgentGap;
    const gap = rank(a) - rank(b);
    if (gap !== 0) return gap;
    return dueDay(a.due_at).localeCompare(dueDay(b.due_at)) || a.title.localeCompare(b.title, "fr");
  });
}

export default function TodayTasks({ onOpenCount }: { onOpenCount?: (count: number) => void }) {
  const qc = useQueryClient();
  const today = todayISO();
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<BizWorkTask | null>(null);

  const tasks = useQuery({
    queryKey: ["work-tasks", "open"],
    queryFn: () => businessApi.listTasks("open"),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["work-tasks"] });
    void qc.invalidateQueries({ queryKey: ["business-events"] });
    void qc.invalidateQueries({ queryKey: ["admin-briefing"] });
  };

  const add = useMutation({
    mutationFn: () => businessApi.createTask({ title: title.trim(), due_at: due || null }),
    onSuccess: () => {
      setTitle("");
      setDue("");
      setError("");
      refresh();
    },
    onError: (err: Error) => setError(err.message),
  });

  const save = useMutation({
    mutationFn: (body: {
      id: string;
      patch: { status?: "open" | "done"; due_at?: string | null; urgent?: boolean; title?: string; notes?: string };
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
      setEditing(null);
      refresh();
    },
    onError: (err: Error) => setError(err.message),
  });

  const open = useMemo(() => sortOpen(tasks.data || [], today), [tasks.data, today]);
  useEffect(() => {
    onOpenCount?.(tasks.isSuccess ? open.length : 0);
  }, [onOpenCount, open.length, tasks.isSuccess]);

  return (
    <section
      id="board-tasks"
      className="scroll-mt-28 rounded-2xl border border-violet-200 bg-white p-3 dark:border-violet-800 dark:bg-slate-950 sm:p-4"
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-extrabold text-slate-950 dark:text-slate-50">
            Tâches{tasks.isSuccess ? ` (${open.length})` : ""}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Hors projet. Une date les ajoute au calendrier.
          </p>
        </div>
        <Link href="/gestion/taches" className="text-xs font-bold text-violet-800 hover:underline dark:text-violet-200">
          Toutes les tâches
        </Link>
      </div>

      <form
        className="mt-3 flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          if (!title.trim()) {
            setError("Le titre est obligatoire.");
            return;
          }
          add.mutate();
        }}
      >
        <input
          className="input-field min-w-0 flex-1"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Nouvelle tâche"
          aria-label="Nouvelle tâche"
          maxLength={800}
        />
        <input
          type="date"
          className="input-field sm:w-40"
          value={due}
          onChange={(event) => setDue(event.target.value)}
          aria-label="Date d'exécution"
        />
        <button type="submit" className="btn-primary" disabled={add.isPending}>
          {add.isPending ? "Ajout…" : "Ajouter"}
        </button>
      </form>
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
      {tasks.isLoading ? <p className="mt-3 text-sm text-slate-500">Chargement des tâches…</p> : null}
      {tasks.isError ? <p className="mt-3 text-sm text-red-700">Impossible de charger les tâches.</p> : null}

      {tasks.isSuccess && open.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">Aucune tâche ouverte.</p>
      ) : null}

      {open.length > 0 ? (
        <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
          {open.map((task) => {
            const day = dueDay(task.due_at);
            const created = formatTaskCreated(task.created_at);
            const tone = !day
              ? "text-slate-500"
              : day < today
                ? "text-rose-700 dark:text-rose-300"
                : day === today
                  ? "text-amber-800 dark:text-amber-200"
                  : "text-slate-600 dark:text-slate-300";
            return (
              <li
                key={task.id}
                className={`flex flex-wrap items-start gap-2 py-2.5 ${task.urgent ? "rounded-lg bg-rose-50/80 px-2 dark:bg-rose-950/40" : ""}`}
              >
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={false}
                  disabled={save.isPending}
                  aria-label={`Marquer « ${task.title} » comme faite`}
                  onChange={() => save.mutate({ id: task.id, patch: { status: "done" } })}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold leading-snug text-slate-900 dark:text-slate-50">
                    {task.priority ? <span className="mr-1.5 text-xs font-bold text-violet-700 dark:text-violet-300">{task.priority}</span> : null}
                    {task.title}
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    {created ? `Créée le ${created}` : "Date de création inconnue"}
                  </span>
                  {task.notes ? (
                    <span className="mt-1 block text-xs leading-snug text-slate-600 dark:text-slate-300">
                      <span className="font-semibold">Commentaire · </span>
                      {task.notes}
                    </span>
                  ) : null}
                </span>
                <button
                  type="button"
                  aria-pressed={Boolean(task.urgent)}
                  aria-label={task.urgent ? `Retirer l'urgence de « ${task.title} »` : `Marquer « ${task.title} » comme urgent`}
                  disabled={save.isPending}
                  className={
                    task.urgent
                      ? "inline-flex items-center rounded-lg border border-rose-300 bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-800 dark:border-rose-700 dark:bg-rose-900 dark:text-rose-100"
                      : "inline-flex items-center rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                  }
                  onClick={() => save.mutate({ id: task.id, patch: { urgent: !task.urgent } })}
                >
                  Urgent
                </button>
                <button
                  type="button"
                  className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
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
                  className="inline-flex items-center rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
                  disabled={remove.isPending}
                  onClick={() => {
                    if (!window.confirm(`Supprimer « ${task.title} » ?\n\nLa tâche disparaît définitivement.`)) return;
                    remove.mutate(task.id);
                  }}
                >
                  {remove.isPending && remove.variables === task.id ? "Suppression…" : "Supprimer"}
                </button>
                <label className="flex items-center gap-2 text-xs font-semibold">
                  <span className={tone}>{dueLabel(task.due_at, today)}</span>
                  <input
                    type="date"
                    className="input-field w-36 py-1 text-xs"
                    value={day}
                    aria-label={`Date de « ${task.title} »`}
                    onChange={(event) => save.mutate({ id: task.id, patch: { due_at: event.target.value || null } })}
                  />
                </label>
              </li>
            );
          })}
        </ul>
      ) : null}
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
    </section>
  );
}
