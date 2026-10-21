"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { agentHeaders, requestJson } from "../../lib/api";
import { businessApi, todayISO, type BizWorkTask } from "../../lib/business";
import { QK } from "../../lib/queryClient";
import { sortTasks } from "../../lib/taskSort";
import type { Job } from "../../lib/types";
import { SectionCard } from "../ui/PageChrome";
import TaskComposer from "./TaskComposer";
import { useTaskSort } from "./useTaskSort";
import WorkTaskList, { missionRefsFromJobs, TaskSortSelect } from "./WorkTaskList";
import { useWorkTaskActions, WorkTaskEditor } from "./workTaskActions";

export default function ProjectTasksPanel({ projectId }: { projectId: string }) {
  const today = todayISO();
  const { sort, choose } = useTaskSort();
  const actions = useWorkTaskActions();
  const tasks = useQuery({
    queryKey: ["work-tasks", "all"],
    queryFn: () => businessApi.listTasks(),
  });
  const jobs = useQuery({
    queryKey: QK.jobsCards,
    queryFn: async () => {
      const { data } = await requestJson("/jobs/cards", { headers: agentHeaders(), retries: 1, timeoutMs: 20_000 });
      return ((data as { jobs?: Job[] })?.jobs || []) as Job[];
    },
    staleTime: 20_000,
  });
  const missionsByTaskId = useMemo(() => missionRefsFromJobs(jobs.data || []), [jobs.data]);
  const mine = useMemo(
    () => (tasks.data || []).filter((task: BizWorkTask) => task.project_id === projectId),
    [tasks.data, projectId],
  );
  const open = sortTasks(mine.filter((task) => task.status !== "done"), sort, today);
  const done = sortTasks(mine.filter((task) => task.status === "done"), sort, today);
  const capped = (tasks.data || []).length >= 200;

  return (
    <SectionCard
      title={`Tâches du projet (${open.length})`}
      description="Ouvertes d'abord. Les terminées restent repliées."
      action={<TaskSortSelect value={sort} onChange={choose} />}
    >
      {capped ? (
        <p className="mb-2 text-sm text-amber-800">
          La liste chargée s&apos;arrête à 200 tâches. Une tâche plus ancienne de ce projet peut manquer.
        </p>
      ) : null}
      {tasks.isError ? <p className="mb-2 text-sm text-red-700">Impossible de charger les tâches.</p> : null}
      {actions.error ? <p className="mb-2 text-sm text-red-700">{actions.error}</p> : null}
      <TaskComposer projectId={projectId} />
      {tasks.isLoading ? <p className="mt-3 text-sm text-slate-500">Chargement des tâches…</p> : null}
      {!tasks.isLoading && open.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">Aucune tâche ouverte pour ce projet.</p>
      ) : null}
      <div className="mt-2">
        <WorkTaskList
          tasks={open}
          today={today}
          actions={actions}
          mode="toggle"
          missionsByTaskId={missionsByTaskId}
          showProject={false}
        />
      </div>
      {done.length > 0 ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-bold text-slate-500">
            {done.length === 1 ? "1 tâche terminée" : `${done.length} tâches terminées`}
          </summary>
          <WorkTaskList
            tasks={done}
            today={today}
            actions={actions}
            mode="toggle"
            missionsByTaskId={missionsByTaskId}
            showProject={false}
          />
        </details>
      ) : null}
      <WorkTaskEditor actions={actions} />
    </SectionCard>
  );
}
