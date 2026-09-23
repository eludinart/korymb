"use client";

import { useEffect, useState } from "react";
import {
  fleetIdFromInterlocutor,
  loadRecentInterlocutors,
  type RecentInterlocutor,
} from "../lib/recentInterlocutors";

type Props = {
  /** Valeur interlocuteur courante (`assistant`, `coordinateur`, `group:id`). */
  current: string;
  onPick: (value: string) => void;
  /** Missions : uniquement les flottes, pas l'assistant. */
  fleetsOnly?: boolean;
  disabled?: boolean;
  className?: string;
};

export default function RecentInterlocutorPicks({
  current,
  onPick,
  fleetsOnly = false,
  disabled,
  className = "",
}: Props) {
  const [rows, setRows] = useState<RecentInterlocutor[]>([]);

  useEffect(() => {
    setRows(loadRecentInterlocutors());
  }, [current]);

  const picks = rows.filter((row) => {
    if (row.value === current) return false;
    if (fleetsOnly && !fleetIdFromInterlocutor(row.value)) return false;
    return true;
  });

  if (!picks.length) return null;

  return (
    <div className={`flex min-w-0 flex-wrap items-center gap-1 ${className}`}>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Reprendre</span>
      {picks.slice(0, 4).map((row) => (
        <button
          key={row.value}
          type="button"
          disabled={disabled}
          onClick={() => onPick(row.value)}
          className="max-w-[10rem] truncate rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-700 hover:border-violet-300 hover:text-violet-900 disabled:opacity-40"
          title={`Reprendre ${row.label}`}
        >
          {row.label}
        </button>
      ))}
    </div>
  );
}
