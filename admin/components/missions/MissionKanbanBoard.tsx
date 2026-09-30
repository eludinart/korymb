"use client";

import Link from "next/link";
import { missionTitleLabel } from "../../lib/missionLabel";
import type { Job } from "../../lib/types";

export type KanbanColumnId = "running" | "validate" | "done" | "blocked";

const COLUMNS: { id: KanbanColumnId; label: string; tone: string }[] = [
  { id: "running", label: "En cours", tone: "border-sky-200 bg-sky-50/60" },
  { id: "validate", label: "À valider", tone: "border-amber-200 bg-amber-50/70" },
  { id: "done", label: "Livré", tone: "border-emerald-200 bg-emerald-50/60" },
  { id: "blocked", label: "Bloqué", tone: "border-rose-200 bg-rose-50/70" },
];

export function kanbanColumnForJob(job: Job): KanbanColumnId {
  const st = String(job.status || "").toLowerCase();
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
};

export default function MissionKanbanBoard({ jobs, onSelect, className = "" }: Props) {
  const byCol: Record<KanbanColumnId, Job[]> = {
    running: [],
    validate: [],
    done: [],
    blocked: [],
  };
  for (const j of jobs) {
    byCol[kanbanColumnForJob(j)].push(j);
  }

  return (
    <div className={`grid gap-3 md:grid-cols-2 xl:grid-cols-4 ${className}`}>
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
              <li className="rounded-xl border border-dashed border-slate-300/80 bg-white/50 px-2 py-4 text-center text-xs text-slate-500">
                Vide
              </li>
            ) : (
              byCol[col.id].slice(0, 24).map((job) => {
                const id = job.job_id;
                const title = missionTitleLabel(job.mission, 90) || id;
                const href = `/missions?job=${encodeURIComponent(id)}`;
                return (
                  <li key={id}>
                    {onSelect ? (
                      <button
                        type="button"
                        onClick={() => onSelect(id)}
                        className="w-full rounded-xl border border-white/80 bg-white px-2.5 py-2 text-left shadow-sm hover:border-violet-300"
                      >
                        <span className="block text-sm font-bold text-slate-900">{title}</span>
                        <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                          {job.agent || "équipe"} · {String(job.status || "").slice(0, 28)}
                        </span>
                      </button>
                    ) : (
                      <Link
                        href={href}
                        className="block rounded-xl border border-white/80 bg-white px-2.5 py-2 shadow-sm hover:border-violet-300"
                      >
                        <span className="block text-sm font-bold text-slate-900">{title}</span>
                        <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                          {job.agent || "équipe"} · {String(job.status || "").slice(0, 28)}
                        </span>
                      </Link>
                    )}
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
