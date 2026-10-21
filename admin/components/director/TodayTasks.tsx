"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { agentHeaders, requestJson } from "../../lib/api";
import { businessApi, todayISO } from "../../lib/business";
import { QK } from "../../lib/queryClient";
import { sortTasks, type TaskSortId } from "../../lib/taskSort";
import type { Job } from "../../lib/types";
import TaskComposer from "./TaskComposer";
import WorkTaskList, { missionRefsFromJobs } from "./WorkTaskList";
import { useWorkTaskActions, WorkTaskEditor } from "./workTaskActions";

export default function TodayTasks({
  onOpenCount,
  sort,
  activeProjectIds,
}: {
  onOpenCount?: (count: number) => void;
  sort: TaskSortId;
  activeProjectIds?: Set<string>;
}) {
  const today = todayISO();
  const actions = useWorkTaskActions();
  const tasks = useQuery({
    queryKey: ["work-tasks", "open"],
    queryFn: () => businessApi.listTasks("open"),
  });
  const jobs = useQuery({
    queryKey: QK.jobsCards,
    queryFn: async () => {
      const { data } = await requestJson("/jobs/cards", { headers: agentHeaders(), retries: 1, timeoutMs: 20_000 });
      return ((data as { jobs?: Job[] })?.jobs || []) as Job[];
    },
    staleTime: 20_000,
  });
  const projects = useQuery({
    queryKey: ["business-projects"],
    queryFn: () => businessApi.listProjects(),
  });
  const projectsById = useMemo(() => {
    const map = new Map<string, string>();
    for (const project of projects.data || []) map.set(project.id, project.title);
    return map;
  }, [projects.data]);
  const missionsByTaskId = useMemo(() => missionRefsFromJobs(jobs.data || []), [jobs.data]);
  const open = useMemo(
    () => sortTasks(tasks.data || [], sort, today, (id) => (id ? projectsById.get(id) || "" : "")),
    [tasks.data, sort, today, projectsById],
  );
  const loose = open.filter((task) => {
    if (!task.project_id) return true;
    if (!activeProjectIds) return false;
    return !activeProjectIds.has(task.project_id);
  });

  useEffect(() => {
    onOpenCount?.(tasks.isSuccess ? open.length : 0);
  }, [onOpenCount, open.length, tasks.isSuccess]);

  return (
    <section
      id="board-tasks"
      className="scroll-mt-28 rounded-2xl border-2 border-violet-300 bg-violet-100 p-3 dark:border-violet-700 dark:bg-violet-950/70 sm:p-4"
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-extrabold text-slate-950 dark:text-slate-50">
            Tâches sans projet{tasks.isSuccess ? ` (${loose.length})` : ""}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Une date les ajoute au calendrier. Celles d&apos;un projet sont sous ce projet.
          </p>
        </div>
        <Link href="/gestion/taches" className="text-xs font-bold text-violet-800 hover:underline dark:text-violet-200">
          Toutes les tâches
        </Link>
      </div>

      <div className="mt-3">
        <TaskComposer />
      </div>
      {actions.error ? <p className="mt-2 text-sm text-red-700">{actions.error}</p> : null}
      {tasks.isLoading ? <p className="mt-3 text-sm text-slate-500">Chargement des tâches…</p> : null}
      {tasks.isError ? <p className="mt-3 text-sm text-red-700">Impossible de charger les tâches.</p> : null}
      {tasks.isSuccess && loose.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">Aucune tâche ouverte sans projet.</p>
      ) : null}
      <div className="mt-2">
        <WorkTaskList
          tasks={loose}
          today={today}
          actions={actions}
          mode="complete-only"
          projectsById={projectsById}
          missionsByTaskId={missionsByTaskId}
        />
      </div>
      <WorkTaskEditor actions={actions} />
    </section>
  );
}
