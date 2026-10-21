"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { agentHeaders, requestJson } from "../../../lib/api";
import { businessApi, todayISO, type BizWorkTask } from "../../../lib/business";
import { QK } from "../../../lib/queryClient";
import { sortTasks } from "../../../lib/taskSort";
import type { Job } from "../../../lib/types";
import { AlertBox, LoadingLine, PageHeader, PageShell, SectionCard } from "../../../components/ui/PageChrome";
import WorkTaskList, { missionRefsFromJobs, TaskSortSelect } from "../../../components/director/WorkTaskList";
import { useTaskSort } from "../../../components/director/useTaskSort";
import { useWorkTaskActions, WorkTaskEditor } from "../../../components/director/workTaskActions";

export default function GestionTachesPage() {
  const today = todayISO();
  const [showDone, setShowDone] = useState(false);
  const { sort, choose } = useTaskSort();
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
  const rows = useMemo(() => {
    const visible = (tasks.data || []).filter((task: BizWorkTask) => showDone || task.status !== "done");
    return sortTasks(visible, sort, today, (id) => (id ? projectsById.get(id) || "" : ""));
  }, [tasks.data, showDone, sort, today, projectsById]);
  const capped = (tasks.data || []).length >= 200;

  return (
    <PageShell size="wide" className="space-y-6">
      <PageHeader
        accent="emerald"
        badge="Tâches"
        title="Tâches à faire"
        description="Celles d'un projet sont aussi sur sa fiche. Celles du jour sont sur Aujourd'hui. Une date les pose sur le calendrier."
        actions={
          <Link href="/briefing#board-tasks" className="btn-primary">
            Voir dans Aujourd&apos;hui
          </Link>
        }
      />

      <SectionCard
        title={`Tâches (${rows.length})`}
        action={
          <div className="flex flex-wrap items-center gap-3">
            <TaskSortSelect value={sort} onChange={choose} />
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
        {!tasks.isLoading && rows.length === 0 ? (
          <p className="text-sm text-slate-500">
            Aucune tâche.{" "}
            <Link href="/briefing#board-tasks" className="font-medium text-emerald-800 underline">
              En ajouter une dans Aujourd&apos;hui
            </Link>
          </p>
        ) : null}
        <WorkTaskList
          tasks={rows}
          today={today}
          actions={actions}
          mode="toggle"
          projectsById={projectsById}
          missionsByTaskId={missionsByTaskId}
        />
      </SectionCard>
      <WorkTaskEditor actions={actions} />
    </PageShell>
  );
}
