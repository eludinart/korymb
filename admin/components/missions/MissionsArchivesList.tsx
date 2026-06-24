"use client";

import { buildHistoryEntries, historyTypeLabel, type HistoryEntry } from "../../lib/historyEntries";

import type { Job } from "../../lib/types";

type Props = {
  jobs: Job[];
  selectedId: string | null;
  busy?: boolean;
  onSelect: (jobId: string) => void;
  onDelete: (entry: HistoryEntry) => void;
};

export default function MissionsArchivesList({ jobs, selectedId, busy = false, onSelect, onDelete }: Props) {
  const entries = buildHistoryEntries(jobs);

  if (!entries.length) {
    return <p className="text-sm text-slate-500">Aucune entrée dans les archives.</p>;
  }

  return (
    <ul className="space-y-2">
      {entries.map((entry) => {
        const active = selectedId === entry.displayJobId;
        return (
          <li
            key={entry.id}
            className={`rounded-xl border p-3 transition-colors ${
              active ? "border-violet-400 bg-violet-50/80 ring-1 ring-violet-200" : "border-slate-200 bg-white hover:border-slate-300"
            }`}
          >
            <div className="flex flex-wrap items-start gap-2">
              <button
                type="button"
                onClick={() => onSelect(entry.displayJobId)}
                className="min-w-0 flex-1 text-left"
              >
                <span className="inline-block rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                  {historyTypeLabel(entry.type)}
                </span>
                <p className="mt-1 text-sm font-semibold leading-snug text-slate-900">{entry.title}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">{entry.quickInfo}</p>
              </button>
              <div className="flex shrink-0 gap-1.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onDelete(entry)}
                  className="rounded-lg border border-red-200 px-2 py-1 text-[10px] font-semibold text-red-800 hover:bg-red-50 disabled:opacity-40"
                >
                  Supprimer
                </button>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
