"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildHistoryEntries, historyTypeLabel, type HistoryEntry } from "../../lib/historyEntries";
import { BTN_DELETE } from "../../lib/deleteMissionBundle";

import type { Job } from "../../lib/types";

type Props = {
  jobs: Job[];
  selectedId: string | null;
  busy?: boolean;
  onSelect: (jobId: string) => void;
  onDelete: (entry: HistoryEntry) => void;
  onDeleteMany: (entries: HistoryEntry[]) => Promise<boolean | void> | boolean | void;
};

export default function MissionsArchivesList({
  jobs,
  selectedId,
  busy = false,
  onSelect,
  onDelete,
  onDeleteMany,
}: Props) {
  const entries = buildHistoryEntries(jobs);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const allRef = useRef<HTMLInputElement>(null);
  const visibleIds = useMemo(() => entries.map((entry) => entry.id), [entries]);
  const pickedIds = visibleIds.filter((id) => picked[id]);
  const allChecked = visibleIds.length > 0 && pickedIds.length === visibleIds.length;

  useEffect(() => {
    const live = new Set(visibleIds);
    setPicked((prev) => {
      const next: Record<string, boolean> = {};
      let changed = false;
      for (const [id, on] of Object.entries(prev)) {
        if (on && live.has(id)) next[id] = true;
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [visibleIds]);

  useEffect(() => {
    if (allRef.current) {
      allRef.current.indeterminate = pickedIds.length > 0 && !allChecked;
    }
  }, [pickedIds.length, allChecked]);

  if (!entries.length) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">Aucune entrée dans les archives.</p>;
  }

  const toggleAll = () => {
    if (allChecked) {
      setPicked({});
      return;
    }
    const next: Record<string, boolean> = {};
    for (const id of visibleIds) next[id] = true;
    setPicked(next);
  };

  const removePicked = async () => {
    const batch = entries.filter((entry) => picked[entry.id]);
    if (!batch.length) return;
    const done = await onDeleteMany(batch);
    if (done !== false) setPicked({});
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
          <input
            ref={allRef}
            type="checkbox"
            checked={allChecked}
            disabled={busy}
            onChange={toggleAll}
            className="h-4 w-4 rounded border-slate-300 text-violet-700 focus:ring-violet-500"
          />
          Tout sélectionner
        </label>
        {pickedIds.length > 0 ? (
          <button type="button" disabled={busy} onClick={() => void removePicked()} className={BTN_DELETE}>
            {busy ? "Suppression…" : `Supprimer la sélection (${pickedIds.length})`}
          </button>
        ) : (
          <span className="text-[11px] text-slate-400">Cochez plusieurs entrées pour les supprimer ensemble.</span>
        )}
      </div>
      <ul className="space-y-2">
        {entries.map((entry) => {
          const active = selectedId === entry.displayJobId;
          const checked = Boolean(picked[entry.id]);
          return (
            <li
              key={entry.id}
              className={`rounded-xl border p-3 transition-colors ${
                checked
                  ? "border-violet-400 bg-violet-50/80 ring-1 ring-violet-200 dark:border-violet-500 dark:bg-violet-950/40 dark:ring-violet-800"
                  : active
                    ? "border-violet-400 bg-violet-50/80 ring-1 ring-violet-200 dark:border-violet-500 dark:bg-violet-950/30 dark:ring-violet-800"
                    : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600"
              }`}
            >
              <div className="flex flex-wrap items-start gap-2">
                <label className="flex min-h-11 shrink-0 cursor-pointer items-start pt-0.5">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={busy}
                    aria-label={`Sélectionner ${entry.title}`}
                    onChange={() => setPicked((prev) => ({ ...prev, [entry.id]: !prev[entry.id] }))}
                    className="h-4 w-4 rounded border-slate-300 text-violet-700 focus:ring-violet-500"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => onSelect(entry.displayJobId)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="inline-block rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {historyTypeLabel(entry.type)}
                  </span>
                  <p className="mt-1 text-sm font-semibold leading-snug text-slate-900 dark:text-slate-100">{entry.title}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{entry.quickInfo}</p>
                </button>
                <div className="flex shrink-0 gap-1.5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onDelete(entry)}
                    className={BTN_DELETE}
                  >
                    Supprimer
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
