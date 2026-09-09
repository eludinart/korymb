"use client";

import type { JobProgress } from "../../lib/jobProgress";

type Props = {
  percent: number;
  label?: string;
  className?: string;
  tone?: "violet" | "emerald" | "amber";
};

const TONE = {
  violet: {
    track: "bg-violet-100",
    fill: "bg-violet-600",
    text: "text-violet-900",
  },
  emerald: {
    track: "bg-emerald-100",
    fill: "bg-emerald-600",
    text: "text-emerald-900",
  },
  amber: {
    track: "bg-amber-100",
    fill: "bg-amber-500",
    text: "text-amber-950",
  },
} as const;

/** Barre basée sur un % réel (équipe / jalons), jamais une ETA. */
export default function RealJobProgressBar({ percent, label, className = "", tone = "violet" }: Props) {
  const pct = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  const colors = TONE[tone];
  return (
    <div className={`min-w-0 ${className}`} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label || "Progression"}>
      <div className="mb-1 flex items-center justify-between gap-2 text-[11px] font-semibold">
        <span className={`min-w-0 truncate ${colors.text}`}>{label || "Progression"}</span>
        <span className={`shrink-0 tabular-nums ${colors.text}`}>{pct} %</span>
      </div>
      <div className={`h-2 w-full overflow-hidden rounded-full ${colors.track}`}>
        <div
          className={`h-full rounded-full transition-[width] duration-500 ease-out ${colors.fill}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function progressToneForStatus(status?: string): Props["tone"] {
  const st = String(status || "").toLowerCase();
  if (st === "awaiting_validation" || st === "paused") return "amber";
  if (st === "completed") return "emerald";
  return "violet";
}

export type { JobProgress };
