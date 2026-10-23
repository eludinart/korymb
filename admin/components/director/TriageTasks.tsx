"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { agentHeaders, requestJson } from "../../lib/api";
import { businessApi, todayISO } from "../../lib/business";
import { QK } from "../../lib/queryClient";
import { groupTasksByEisenhower, sortTasks, type TaskSortId } from "../../lib/taskSort";
import type { Job } from "../../lib/types";
import WorkTaskList, { missionRefsFromJobs } from "./WorkTaskList";
import { useWorkTaskActions, WorkTaskEditor } from "./workTaskActions";

export default function TriageTasks({
  onCount,
  sort,
  criteria,
}: {
  onCount?: (count: number) => void;
  sort: TaskSortId;
  criteria?: TaskSortId[];
}) {
  const today = todayISO();
  const actions = useWorkTaskActions();
  const tasks = useQuery({
    queryKey: ["work-tasks", "open", "triage"],
    queryFn: () => businessApi.listTasks("open", { triage: true }),
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
  const sorted = useMemo(
    () =>
      sortTasks(
        tasks.data || [],
        criteria?.length ? criteria : [sort],
        today,
        (id) => (id ? projectsById.get(id) || "" : ""),
      ),
    [tasks.data, criteria, sort, today, projectsById],
  );
  const groups = useMemo(() => groupTasksByEisenhower(sorted), [sorted]);

  useEffect(() => {
    onCount?.(tasks.isSuccess ? sorted.length : 0);
  }, [onCount, sorted.length, tasks.isSuccess]);

  return (
    <section
      id="board-triage"
      className="scroll-mt-28 rounded-2xl border-2 border-amber-300 bg-amber-50/90 p-3 dark:border-amber-800 dark:bg-amber-950/40 sm:p-4"
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2
            className="text-sm font-extrabold text-slate-950 dark:text-slate-50"
            title="Matrice d’Eisenhower — urgent × important"
          >
            Quoi d&apos;abord{tasks.isSuccess ? ` (${sorted.length})` : ""}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500" title="Matrice d’Eisenhower — urgent × important">
            Tâches rattachées à un projet, classées urgent / important.
            {" "}
            <span className="font-semibold text-slate-600 dark:text-slate-300">En savoir plus</span>
            {" "}
            (Eisenhower).
          </p>
        </div>
        <Link href="/gestion/taches" className="text-xs font-bold text-amber-900 hover:underline dark:text-amber-200">
          Toutes les tâches
        </Link>
      </div>

      {actions.error ? <p className="mt-2 text-sm text-red-700">{actions.error}</p> : null}
      {tasks.isLoading ? <p className="mt-3 text-sm text-slate-500">Chargement…</p> : null}
      {tasks.isError ? <p className="mt-3 text-sm text-red-700">Impossible de charger le triage.</p> : null}
      {tasks.isSuccess && sorted.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">
          Rien à trier ici — les notes sans projet sont dans « Ce qui traîne ».
        </p>
      ) : null}

      <div className="mt-3 space-y-4">
        {groups.map((group) => (
          <div key={group.id}>
            <h3 className="text-xs font-extrabold uppercase tracking-wide text-amber-950 dark:text-amber-100">
              {group.label} ({group.tasks.length})
            </h3>
            <div className="mt-1">
              <WorkTaskList
                tasks={group.tasks}
                today={today}
                actions={actions}
                mode="complete-only"
                projectsById={projectsById}
                missionsByTaskId={missionsByTaskId}
              />
            </div>
          </div>
        ))}
      </div>
      <WorkTaskEditor actions={actions} />
    </section>
  );
}
