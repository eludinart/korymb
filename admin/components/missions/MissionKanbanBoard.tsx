"use client";

import Link from "next/link";
import { missionTitleLabel } from "../../lib/missionLabel";
import {
  groupMissionsByProject,
  missionTaskTitle,
  type MissionListEntry,
  type ProjectMissionLink,
} from "../../lib/missionProjectGroups";
import type { Job } from "../../lib/types";

export type KanbanColumnId = "todo" | "running" | "validate" | "done" | "blocked";

const COLUMNS: { id: KanbanColumnId; label: string; tone: string }[] = [
  { id: "todo", label: "À faire", tone: "border-violet-200 bg-violet-50/70" },
  { id: "running", label: "En cours", tone: "border-sky-200 bg-sky-50/60" },
  { id: "validate", label: "À valider", tone: "border-amber-200 bg-amber-50/70" },
  { id: "done", label: "Livré", tone: "border-emerald-200 bg-emerald-50/60" },
  { id: "blocked", label: "Bloqué", tone: "border-rose-200 bg-rose-50/70" },
];

export function kanbanColumnForJob(job: Job): KanbanColumnId {
  const st = String(job.status || "").toLowerCase();
  if (st === "planned") return "todo";
  if (st.startsWith("error") || st === "quality_blocked" || st.includes("cancelled")) {
    return "blocked";
  }
  if (st === "awaiting_validation" || job.hitl || job.hitl_gate) {
    return "validate";
  }
  if (st === "completed" || st === "done" || job.user_validated_at || job.mission_closed_by_user) {
    return "done";
  }
  return "running";
}

type Props = {
  jobs: Job[];
  onSelect?: (jobId: string) => void;
  className?: string;
  groupByProject?: boolean;
  projects?: ProjectMissionLink[];
};

function columnEntries(jobs: Job[], groupByProject: boolean, projects: ProjectMissionLink[]): MissionListEntry[] {
  const grouped = groupByProject ? groupMissionsByProject(jobs, projects) : jobs.map((job) => ({ kind: "job" as const, job }));
  const limited: MissionListEntry[] = [];
  let shown = 0;
  for (const entry of grouped) {
    if (shown >= 24) break;
    if (entry.kind === "job") {
      limited.push(entry);
      shown += 1;
      continue;
    }
    const jobsLeft = entry.jobs.slice(0, 24 - shown);
    shown += jobsLeft.length;
    if (jobsLeft.length) limited.push({ ...entry, jobs: jobsLeft });
  }
  return limited;
}

function KanbanCard({
  job,
  title,
  onSelect,
}: {
  job: Job;
  title: string;
  onSelect?: (jobId: string) => void;
}) {
  const id = job.job_id;
  const href = `/missions?job=${encodeURIComponent(id)}`;
  const body = (
    <>
      <span className="block text-sm font-bold text-slate-900 dark:text-slate-50">{title}</span>
      <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {job.agent || "équipe"} · {String(job.status || "").slice(0, 28)}
      </span>
    </>
  );
  const className =
    "block w-full rounded-xl border border-white/80 bg-white px-2.5 py-2 text-left shadow-sm hover:border-violet-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-violet-500";
  if (onSelect) {
    return (
      <button type="button" onClick={() => onSelect(id)} className={className}>
        {body}
      </button>
    );
  }
  return (
    <Link href={href} className={className}>
      {body}
    </Link>
  );
}

export default function MissionKanbanBoard({
  jobs,
  onSelect,
  className = "",
  groupByProject = false,
  projects = [],
}: Props) {
  const byCol: Record<KanbanColumnId, Job[]> = {
    todo: [],
    running: [],
    validate: [],
    done: [],
    blocked: [],
  };
  for (const j of jobs) {
    byCol[kanbanColumnForJob(j)].push(j);
  }

  return (
    <div className={`grid gap-3 md:grid-cols-2 xl:grid-cols-5 ${className}`}>
      {COLUMNS.map((col) => (
        <section key={col.id} className={`rounded-2xl border p-3 ${col.tone}`}>
          <header className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-xs font-extrabold uppercase tracking-wide text-slate-800">{col.label}</h3>
            <span className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-bold text-slate-600">
              {byCol[col.id].length}
            </span>
          </header>
          <ul className="space-y-2">
            {byCol[col.id].length === 0 ? (
              <li className="rounded-xl border border-dashed border-slate-300/80 bg-white/50 px-2 py-4 text-center text-xs text-slate-500 dark:border-slate-600 dark:bg-slate-900/40 dark:text-slate-400">
                Vide
              </li>
            ) : (
              columnEntries(byCol[col.id], groupByProject, projects).map((entry) => {
                if (entry.kind === "job") {
                  const title = missionTitleLabel(entry.job.mission, 90) || entry.job.job_id;
                  return (
                    <li key={entry.job.job_id}>
                      <KanbanCard job={entry.job} title={title} onSelect={onSelect} />
                    </li>
                  );
                }
                return (
                  <li key={entry.key} className="space-y-1.5 rounded-xl bg-emerald-100/60 p-1.5 dark:bg-emerald-950/40">
                    <p className="truncate px-1 text-[11px] font-bold text-emerald-950 dark:text-emerald-100" title={entry.title}>
                      {entry.title}
                      <span className="ml-1 font-semibold text-emerald-800 dark:text-emerald-300">{entry.jobs.length}</span>
                    </p>
                    <ul className="space-y-1.5">
                      {entry.jobs.map((job) => {
                        const task = missionTaskTitle(job.mission, entry.title);
                        const title = task || missionTitleLabel(job.mission, 90) || job.job_id;
                        return (
                          <li key={job.job_id}>
                            <KanbanCard job={job} title={title} onSelect={onSelect} />
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                );
              })
            )}
          </ul>
        </section>
      ))}
    </div>
  );
}
