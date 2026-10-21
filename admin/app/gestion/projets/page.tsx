"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import TaskNotes from "../../../components/director/TaskNotes";
import { AlertBox, LoadingLine, PageHeader, PageShell, SectionCard } from "../../../components/ui/PageChrome";
import { businessApi, formatTaskCreated, type BizProject } from "../../../lib/business";
import { projectPastel } from "../../../lib/projectPastel";
import { PROJECT_STATUS_LABELS, PROJECT_TYPE_LABELS, contactLabel } from "../_shared";
import { useUndoRibbon } from "../../../lib/undoRibbon";

function formatProjectDay(value: string | null | undefined): string {
  const day = (value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "";
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return "";
  return new Date(year, month - 1, date).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function GestionProjetsPage() {
  const qc = useQueryClient();
  const { pushUndo } = useUndoRibbon();

  const contacts = useQuery({ queryKey: ["business-contacts"], queryFn: () => businessApi.listContacts() });
  const projects = useQuery({ queryKey: ["business-projects"], queryFn: () => businessApi.listProjects() });
  const tasks = useQuery({ queryKey: ["work-tasks", "open"], queryFn: () => businessApi.listTasks("open") });
  const openTasksByProject = useMemo(() => {
    const map = new Map<string, number>();
    for (const task of tasks.data || []) {
      if (!task.project_id || task.status === "done") continue;
      map.set(task.project_id, (map.get(task.project_id) || 0) + 1);
    }
    return map;
  }, [tasks.data]);

  const setProjectStatus = useMutation({
    mutationFn: ({ id, st }: { id: string; st: string }) => businessApi.updateProject(id, { status: st }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["business-projects"] }),
  });

  return (
    <PageShell size="wide" className="space-y-6">
      <PageHeader
        accent="emerald"
        badge="Projets"
        title="Suivi de projets"
        description="Dossiers liés aux personnes que vous suivez."
        actions={
          <Link href="/gestion/projets/nouveau" className="btn-primary">
            + Nouveau projet
          </Link>
        }
      />

      <SectionCard title={`Projets (${projects.data?.length ?? 0})`}>
        {projects.isLoading ? <LoadingLine /> : null}
        {projects.isError ? <AlertBox tone="error" title="Erreur">Chargement impossible.</AlertBox> : null}
        {!projects.isLoading && (projects.data || []).length === 0 ? (
          <p className="text-sm text-slate-500">
            Aucun projet.{" "}
            <Link href="/gestion/projets/nouveau" className="font-medium text-emerald-800 underline">
              Créer un projet
            </Link>
          </p>
        ) : null}
        <ul className="grid gap-3">
          {(projects.data || []).map((p: BizProject) => {
            const steps = p.milestones || [];
            const openSteps = steps.filter((step) => !step.done).length;
            const openTasks = openTasksByProject.get(p.id) || 0;
            const missions = (p.linked_job_ids || []).length;
            const start = formatProjectDay(p.start_date);
            const end = formatProjectDay(p.end_date);
            const activity = formatTaskCreated(p.updated_at);
            const pastel = projectPastel(p.id);
            return (
            <li key={p.id} className={`rounded-xl border px-3 py-3 ${pastel.card}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/gestion/projets/${p.id}`} className="font-semibold text-slate-900 hover:underline dark:text-slate-50">
                      {p.title}
                    </Link>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${pastel.chip}`}>
                      Projet
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    {PROJECT_TYPE_LABELS[p.project_type] || p.project_type} ·{" "}
                    {PROJECT_STATUS_LABELS[p.status] || p.status}
                    {p.location ? ` · ${p.location}` : ""}
                  </p>
                  <p className="text-xs text-slate-500">
                    Contact : {contactLabel(undefined, p.contact_id, contacts.data || [])}
                  </p>
                  <p className="mt-1 text-xs font-semibold text-slate-700">
                    {openSteps === 1 ? "1 étape ouverte" : `${openSteps} étapes ouvertes`}
                    {" · "}
                    {openTasks === 1 ? "1 tâche ouverte" : `${openTasks} tâches ouvertes`}
                    {" · "}
                    {missions === 1 ? "1 mission" : `${missions} missions`}
                  </p>
                  {start || end ? (
                    <p className="text-xs text-slate-500">
                      {start ? `Début ${start}` : "Début non daté"}
                      {" · "}
                      {end ? `Fin ${end}` : "Fin non datée"}
                    </p>
                  ) : null}
                  {activity ? <p className="text-xs text-slate-500">Dernière activité {activity}</p> : null}
                  {p.description ? <TaskNotes source={p.description} /> : null}
                </div>
                <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                  <select
                    className="input-field min-w-[8rem] flex-1 text-sm sm:flex-none"
                    value={p.status}
                    onChange={(e) => {
                      const next = e.target.value;
                      const prev = p.status;
                      if (next === prev) return;
                      setProjectStatus.mutate({ id: p.id, st: next });
                      pushUndo(`${p.title} : ${PROJECT_STATUS_LABELS[next] || next}`, () => {
                        setProjectStatus.mutate({ id: p.id, st: prev });
                      });
                    }}
                  >
                    {Object.entries(PROJECT_STATUS_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                  <Link
                    href={`/gestion/projets/${p.id}`}
                    className="touch-target inline-flex items-center rounded-lg border border-violet-200 bg-violet-50 px-3 text-xs font-semibold text-violet-900"
                  >
                    Ouvrir
                  </Link>
                </div>
              </div>
            </li>
            );
          })}
        </ul>
      </SectionCard>
    </PageShell>
  );
}
