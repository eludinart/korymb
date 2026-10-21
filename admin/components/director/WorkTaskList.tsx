"use client";

import Link from "next/link";
import { useState } from "react";
import { dueDay, dueLabel, formatTaskCreated, type BizWorkTask } from "../../lib/business";
import { missionTitleLabel } from "../../lib/missionLabel";
import { TASK_SORTS, type TaskSortId } from "../../lib/taskSort";
import ReplyComposer from "./ReplyComposer";
import TaskActionMenu from "./TaskActionMenu";
import TaskNotes from "./TaskNotes";
import type { WorkTaskActions } from "./workTaskActions";

export type TaskMissionRef = {
  job_id: string;
  title: string;
  status?: string;
};

export function missionStatusLabel(status?: string): string {
  if (status === "planned") return "À lancer";
  if (status === "running" || status === "queued") return "En cours";
  if (status === "completed" || status === "done" || status === "succeeded") return "Terminée";
  if (status === "failed" || status === "error" || status === "cancelled") return "Arrêtée";
  return status ? status : "Mission";
}

export function TaskSortSelect({
  value,
  onChange,
}: {
  value: TaskSortId;
  onChange: (id: TaskSortId) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
      Trier
      <select
        className="input-field py-1 text-xs"
        value={value}
        aria-label="Trier les tâches"
        onChange={(event) => {
          const next = TASK_SORTS.find((item) => item.id === event.target.value);
          if (next) onChange(next.id);
        }}
      >
        {TASK_SORTS.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function TaskMissions({ missions }: { missions: TaskMissionRef[] }) {
  if (missions.length === 0) return null;
  const buckets = new Map<string, TaskMissionRef[]>();
  for (const item of missions) {
    const key = missionStatusLabel(item.status);
    const list = buckets.get(key) || [];
    list.push(item);
    buckets.set(key, list);
  }
  return (
    <div className="mt-2">
      <p className="text-xs font-bold text-slate-700 dark:text-slate-200">Missions</p>
      {[...buckets.entries()].map(([label, items]) => (
        <div key={label} className="mt-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
          <ul className="mt-0.5 space-y-0.5">
            {items.map((item) => (
              <li key={item.job_id}>
                <Link
                  href={`/missions?job=${encodeURIComponent(item.job_id)}`}
                  className="text-sm font-semibold text-violet-800 hover:underline dark:text-violet-200"
                >
                  {item.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function DueDateControl({
  task,
  today,
  disabled,
  onChange,
}: {
  task: BizWorkTask;
  today: string;
  disabled: boolean;
  onChange: (value: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const day = dueDay(task.due_at);
  const tone = !day
    ? "text-slate-500"
    : day < today
      ? "text-rose-700 dark:text-rose-300"
      : day === today
        ? "text-amber-800 dark:text-amber-200"
        : "text-slate-600 dark:text-slate-300";
  if (!open) {
    return (
      <button type="button" className={`text-xs font-semibold hover:underline ${tone}`} onClick={() => setOpen(true)}>
        {dueLabel(task.due_at, today)}
      </button>
    );
  }
  return (
    <label className="flex w-full max-w-56 flex-col gap-1">
      <span className={`text-xs font-semibold ${tone}`}>{dueLabel(task.due_at, today)}</span>
      <input
        type="date"
        className="input-field min-w-0 max-w-full"
        value={day}
        aria-label={`Date de « ${task.title} »`}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.value || null);
          setOpen(false);
        }}
      />
      <button type="button" className="self-start text-xs font-bold text-slate-500 hover:underline" onClick={() => setOpen(false)}>
        Fermer
      </button>
    </label>
  );
}

function TaskRow({
  task,
  today,
  actions,
  mode,
  projectsById,
  missionsByTaskId,
  showProject,
}: {
  task: BizWorkTask;
  today: string;
  actions: WorkTaskActions;
  mode: "complete-only" | "toggle";
  projectsById?: Map<string, string>;
  missionsByTaskId?: Map<string, TaskMissionRef[]>;
  showProject: boolean;
}) {
  const [details, setDetails] = useState(false);
  const created = formatTaskCreated(task.created_at);
  const done = task.status === "done";
  const busy = actions.save.isPending && actions.save.variables?.id === task.id;
  const removing = actions.remove.isPending && actions.remove.variables === task.id;
  const projectTitle = task.project_id ? projectsById?.get(task.project_id) : "";
  const missions = missionsByTaskId?.get(task.id) || [];
  const due = dueLabel(task.due_at, today);
  const hasExtras = Boolean(task.notes?.trim() || missions.length || task.reply?.trim());

  return (
    <li className={`py-2.5 ${task.urgent ? "rounded-lg bg-rose-50/80 px-2 dark:bg-rose-950/40" : ""}`}>
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-1 size-5 shrink-0"
          checked={mode === "toggle" ? done : false}
          disabled={actions.save.isPending}
          aria-label={
            done
              ? `Rouvrir « ${task.title} »`
              : `Marquer « ${task.title} » comme faite`
          }
          onChange={(event) => {
            const next = mode === "toggle"
              ? (event.target.checked ? "done" : "open")
              : "done";
            actions.save.mutate({ id: task.id, patch: { status: next } });
          }}
        />
        <div className="min-w-0 flex-1">
          <p className={`break-words text-sm font-semibold leading-snug text-slate-900 dark:text-slate-50 ${done ? "line-through opacity-60" : ""}`}>
            {task.priority ? (
              <span className="mr-1.5 text-xs font-bold text-violet-700 dark:text-violet-300">{task.priority}</span>
            ) : null}
            {task.title}
          </p>
          <p className="text-xs text-slate-500">
            {due}
            {created ? ` · Créée le ${created}` : ""}
            {task.assignee ? ` · ${task.assignee}` : ""}
            {showProject && task.project_id ? (
              <>
                {" · "}
                <Link href={`/gestion/projets/${task.project_id}`} className="font-semibold text-violet-800 hover:underline dark:text-violet-200">
                  {projectTitle || "Projet"}
                </Link>
              </>
            ) : null}
            {missions.length > 0 ? ` · ${missions.length === 1 ? "1 mission" : `${missions.length} missions`}` : ""}
          </p>
          {!details && task.notes?.trim() ? (
            <p className="mt-1 line-clamp-2 text-xs leading-snug text-slate-600 dark:text-slate-300">
              {task.notes.trim()}
            </p>
          ) : null}
          <button
            type="button"
            className="mt-1 text-xs font-bold text-violet-800 hover:underline dark:text-violet-200"
            aria-expanded={details}
            onClick={() => setDetails((value) => !value)}
          >
            {details ? "Réduire" : hasExtras ? "Voir le détail" : "Date, réponse & commentaire"}
          </button>
        </div>
        <div className="flex shrink-0 items-start gap-0.5">
          <button
            type="button"
            aria-pressed={Boolean(task.urgent)}
            aria-label={
              task.urgent
                ? `Retirer l'urgence de « ${task.title} »`
                : `Marquer « ${task.title} » comme urgente`
            }
            disabled={actions.save.isPending}
            className={
              task.urgent
                ? "inline-flex min-h-11 items-center rounded-lg border border-rose-300 bg-rose-100 px-2.5 text-xs font-extrabold text-rose-900 dark:border-rose-700 dark:bg-rose-900 dark:text-rose-50"
                : "inline-flex min-h-11 items-center rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-rose-700 dark:hover:bg-rose-950 dark:hover:text-rose-100"
            }
            onClick={() => actions.save.mutate({ id: task.id, patch: { urgent: !task.urgent } })}
          >
            Urgent
          </button>
          <TaskActionMenu
            title={task.title}
            pending={Boolean(busy || removing || actions.save.isPending)}
            onEdit={() => {
              actions.setError("");
              actions.setEditing(task);
            }}
            onDelete={() => {
              if (!window.confirm(`Supprimer « ${task.title} » ?\n\nLa tâche disparaît définitivement.`)) return;
              actions.remove.mutate(task.id);
            }}
          />
        </div>
      </div>
      {details ? (
        <div className="mt-2 grid gap-1 pl-7">
          {task.notes ? <TaskNotes source={task.notes} label="Commentaire" /> : null}
          <TaskMissions missions={missions} />
          <DueDateControl
            task={task}
            today={today}
            disabled={actions.save.isPending}
            onChange={(value) => actions.save.mutate({ id: task.id, patch: { due_at: value } })}
          />
          <ReplyComposer
            kind="Tâche"
            title={task.title}
            notes={task.notes || ""}
            reply={task.reply || ""}
            replyAt={task.reply_at || ""}
            conversationId={task.chat_conversation_id || ""}
            saving={Boolean(busy)}
            savedLabel={task.reply_at ? `Enregistrée le ${formatTaskCreated(task.reply_at) || "—"}` : ""}
            onSave={(next) => actions.save.mutate({ id: task.id, patch: { reply: next } })}
            onConversationId={async (id) => {
              await actions.save.mutateAsync({ id: task.id, patch: { chat_conversation_id: id } });
            }}
          />
        </div>
      ) : null}
      {removing ? <p className="mt-1 pl-7 text-xs text-slate-500">Suppression…</p> : null}
    </li>
  );
}

export default function WorkTaskList({
  tasks,
  today,
  actions,
  mode,
  projectsById,
  missionsByTaskId,
  showProject = true,
}: {
  tasks: BizWorkTask[];
  today: string;
  actions: WorkTaskActions;
  mode: "complete-only" | "toggle";
  projectsById?: Map<string, string>;
  missionsByTaskId?: Map<string, TaskMissionRef[]>;
  showProject?: boolean;
}) {
  if (tasks.length === 0) return null;
  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
      {tasks.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          today={today}
          actions={actions}
          mode={mode}
          projectsById={projectsById}
          missionsByTaskId={missionsByTaskId}
          showProject={showProject}
        />
      ))}
    </ul>
  );
}

export function missionRefsFromJobs(
  jobs: { job_id: string; mission?: string | null; status?: string; mission_config?: { task_id?: string | null } | null }[],
): Map<string, TaskMissionRef[]> {
  const map = new Map<string, TaskMissionRef[]>();
  for (const job of jobs) {
    const taskId = String(job.mission_config?.task_id || "").trim();
    if (!taskId) continue;
    const list = map.get(taskId) || [];
    list.push({
      job_id: job.job_id,
      title: missionTitleLabel(job.mission, 80) || job.job_id,
      status: job.status,
    });
    map.set(taskId, list);
  }
  return map;
}
