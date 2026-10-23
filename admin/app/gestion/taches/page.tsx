"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { agentHeaders, requestJson } from "../../../lib/api";
import { businessApi, todayISO, type BizWorkTask } from "../../../lib/business";
import { QK } from "../../../lib/queryClient";
import { groupTasksByEisenhower, sortTasks } from "../../../lib/taskSort";
import type { Job } from "../../../lib/types";
import { AlertBox, LoadingLine, PageHeader, PageShell, SectionCard } from "../../../components/ui/PageChrome";
import WorkTaskList, { missionRefsFromJobs, TaskSortSelect } from "../../../components/director/WorkTaskList";
import { useTaskSort } from "../../../components/director/useTaskSort";
import { useWorkTaskActions, WorkTaskEditor } from "../../../components/director/workTaskActions";

export default function GestionTachesPage() {
  const today = todayISO();
  const [showDone, setShowDone] = useState(false);
  const [captureOnly, setCaptureOnly] = useState(false);
  const [triageOnly, setTriageOnly] = useState(false);
  const { sort, choose, criteria, setSortCriteria } = useTaskSort();
  const actions = useWorkTaskActions();
  const tasks = useQuery({
    queryKey: ["work-tasks", "all"],
    queryFn: () => businessApi.listTasks(),
  });
  const projects = useQuery({
    queryKey: ["business-projects"],
    queryFn: () => businessApi.listProjects(),
  });
  const jobs = useQuery({
    queryKey: QK.jobsCards,
    queryFn: async () => {
      const { data } = await requestJson("/jobs/cards", { headers: agentHeaders(), retries: 1, timeoutMs: 20_000 });
      return ((data as { jobs?: Job[] })?.jobs || []) as Job[];
    },
    staleTime: 20_000,
  });
  const projectsById = useMemo(() => {
    const map = new Map<string, string>();
    for (const project of projects.data || []) map.set(project.id, project.title);
    return map;
  }, [projects.data]);
  const missionsByTaskId = useMemo(() => missionRefsFromJobs(jobs.data || []), [jobs.data]);
  const sorted = useMemo(() => {
    const visible = (tasks.data || []).filter((task: BizWorkTask) => showDone || task.status !== "done");
    return sortTasks(visible, criteria, today, (id) => (id ? projectsById.get(id) || "" : ""));
  }, [tasks.data, showDone, criteria, today, projectsById]);
  const capture = useMemo(
    () => sorted.filter((task) => !task.project_id && task.status === "open"),
    [sorted],
  );
  const triage = useMemo(
    () => sorted.filter((task) => Boolean(task.project_id) && task.status === "open"),
    [sorted],
  );
  const triageGroups = useMemo(() => groupTasksByEisenhower(triage), [triage]);
  const doneRows = useMemo(
    () => sorted.filter((task) => task.status === "done"),
    [sorted],
  );
  const capped = (tasks.data || []).length >= 200;
  const splitView = !captureOnly && !triageOnly;
  const listTasks = captureOnly ? capture : triageOnly ? triage : sorted;

  return (
    <PageShell size="wide" className="space-y-6">
      <PageHeader
        accent="emerald"
        badge="Tâches"
        title="Tâches à faire"
        description="Ce qui traîne = sans projet. Quoi d’abord = avec projet, urgent / important. Les décisions agents sont dans Décisions, pas ici."
        actions={
          <Link href="/briefing#board-triage" className="btn-primary">
            Voir dans Aujourd&apos;hui
          </Link>
        }
      />

      <SectionCard
        title={
          captureOnly
            ? `Ce qui traîne (${capture.length})`
            : triageOnly
              ? `Quoi d’abord (${triage.length})`
              : `Tâches (${sorted.length})`
        }
        action={
          <div className="flex flex-wrap items-center gap-3">
            <TaskSortSelect value={sort} onChange={choose} criteria={criteria} onCriteriaChange={setSortCriteria} />
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
              <input
                type="checkbox"
                checked={captureOnly}
                onChange={(event) => {
                  setCaptureOnly(event.target.checked);
                  if (event.target.checked) setTriageOnly(false);
                }}
              />
              Ce qui traîne seulement
            </label>
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
              <input
                type="checkbox"
                checked={triageOnly}
                onChange={(event) => {
                  setTriageOnly(event.target.checked);
                  if (event.target.checked) setCaptureOnly(false);
                }}
              />
              Quoi d’abord seulement
            </label>
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
              <input type="checkbox" checked={showDone} onChange={(event) => setShowDone(event.target.checked)} />
              Afficher les faites
            </label>
          </div>
        }
      >
        {tasks.isLoading ? <LoadingLine /> : null}
        {tasks.isError ? <AlertBox tone="error" title="Erreur">Chargement impossible.</AlertBox> : null}
        {capped ? (
          <p className="mb-2 text-sm text-amber-800">La liste chargée s&apos;arrête à 200 tâches.</p>
        ) : null}
        {actions.error ? <p className="mb-2 text-sm text-red-700">{actions.error}</p> : null}

        {splitView ? (
          <div className="space-y-4">
            {capture.length > 0 ? (
              <div>
                <h3 className="text-xs font-extrabold uppercase tracking-wide text-violet-900 dark:text-violet-200">
                  Ce qui traîne ({capture.length})
                </h3>
                <p className="mt-0.5 text-xs text-slate-500" title="Méthode GTD — capture sans trier">
                  Ouvertes, sans projet — à clarifier ou rattacher.{" "}
                  <span className="font-semibold">En savoir plus</span> (GTD).
                </p>
                <div className="mt-2">
                  <WorkTaskList
                    tasks={capture}
                    today={today}
                    actions={actions}
                    mode="toggle"
                    projectsById={projectsById}
                    missionsByTaskId={missionsByTaskId}
                  />
                </div>
              </div>
            ) : null}
            {triage.length > 0 ? (
              <div>
                <h3
                  className="text-xs font-extrabold uppercase tracking-wide text-amber-900 dark:text-amber-200"
                  title="Matrice d’Eisenhower — urgent × important"
                >
                  Quoi d’abord ({triage.length})
                </h3>
                <p className="mt-0.5 text-xs text-slate-500" title="Matrice d’Eisenhower — urgent × important">
                  Ouvertes, rattachées à un projet.{" "}
                  <span className="font-semibold">En savoir plus</span> (Eisenhower).
                </p>
                <div className="mt-2 space-y-3">
                  {triageGroups.map((group) => (
                    <div key={group.id}>
                      <h4 className="text-[11px] font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                        {group.label} ({group.tasks.length})
                      </h4>
                      <WorkTaskList
                        tasks={group.tasks}
                        today={today}
                        actions={actions}
                        mode="toggle"
                        projectsById={projectsById}
                        missionsByTaskId={missionsByTaskId}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {showDone && doneRows.length > 0 ? (
              <div>
                <h3 className="text-xs font-extrabold uppercase tracking-wide text-slate-700 dark:text-slate-300">
                  Faites ({doneRows.length})
                </h3>
                <div className="mt-2">
                  <WorkTaskList
                    tasks={doneRows}
                    today={today}
                    actions={actions}
                    mode="toggle"
                    projectsById={projectsById}
                    missionsByTaskId={missionsByTaskId}
                  />
                </div>
              </div>
            ) : null}
            {!tasks.isLoading && capture.length === 0 && triage.length === 0 && (!showDone || doneRows.length === 0) ? (
              <p className="text-sm text-slate-500">
                Aucune tâche.{" "}
                <Link href="/briefing#board-tasks" className="font-medium text-emerald-800 underline">
                  En ajouter une dans Aujourd&apos;hui
                </Link>
              </p>
            ) : null}
          </div>
        ) : null}

        {!tasks.isLoading && !splitView ? (
          triageOnly && triage.length > 0 ? (
            <div className="space-y-3">
              {triageGroups.map((group) => (
                <div key={group.id}>
                  <h4 className="text-[11px] font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                    {group.label} ({group.tasks.length})
                  </h4>
                  <WorkTaskList
                    tasks={group.tasks}
                    today={today}
                    actions={actions}
                    mode="toggle"
                    projectsById={projectsById}
                    missionsByTaskId={missionsByTaskId}
                  />
                </div>
              ))}
            </div>
          ) : listTasks.length === 0 ? (
            <p className="text-sm text-slate-500">
              {captureOnly ? (
                "Rien qui traîne."
              ) : triageOnly ? (
                "Rien à prioriser — rattachez d’abord une tâche à un projet."
              ) : (
                <>
                  Aucune tâche.{" "}
                  <Link href="/briefing#board-tasks" className="font-medium text-emerald-800 underline">
                    En ajouter une dans Aujourd&apos;hui
                  </Link>
                </>
              )}
            </p>
          ) : (
            <WorkTaskList
              tasks={listTasks}
              today={today}
              actions={actions}
              mode="toggle"
              projectsById={projectsById}
              missionsByTaskId={missionsByTaskId}
            />
          )
        ) : null}
      </SectionCard>
      <WorkTaskEditor actions={actions} />
    </PageShell>
  );
}
