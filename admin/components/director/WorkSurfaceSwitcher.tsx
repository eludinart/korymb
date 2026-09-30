"use client";

import Link from "next/link";
import {
  recommendWorkSurface,
  WORK_SURFACES,
  type WorkSurfaceId,
} from "../../lib/workSurface";
import { loadThinkingMode } from "../../lib/thinkingMode";
import { useEffect, useMemo, useState } from "react";

type Props = {
  runningCount?: number;
  inboxCritical?: number;
  className?: string;
};

export default function WorkSurfaceSwitcher({
  runningCount = 0,
  inboxCritical = 0,
  className = "",
}: Props) {
  const [mode, setMode] = useState("auto");
  useEffect(() => {
    setMode(loadThinkingMode());
  }, []);

  const suggested = useMemo(
    () =>
      recommendWorkSurface({
        runningCount,
        inboxCritical,
        thinkingMode: mode,
      }),
    [runningCount, inboxCritical, mode],
  );

  return (
    <section className={`rounded-2xl border border-slate-200 bg-white px-3 py-3 shadow-sm ${className}`}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Surface de travail</p>
        <p className="text-[11px] text-slate-500">
          Suggéré : <span className="font-bold text-violet-800">{WORK_SURFACES.find((s) => s.id === suggested)?.label}</span>
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {WORK_SURFACES.map((s) => {
          const active = s.id === suggested;
          return (
            <Link
              key={s.id}
              href={s.href}
              title={s.hint}
              className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${
                active
                  ? "bg-violet-700 text-white shadow-sm"
                  : "bg-slate-50 text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100"
              }`}
            >
              {s.label}
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export type { WorkSurfaceId };
