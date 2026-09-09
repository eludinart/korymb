"use client";

import { missionStatusMeta } from "../lib/missionBossView";

type Props = {
  status?: string | null;
  executionLive?: boolean | null;
  className?: string;
};

export default function MissionStatusBadge({ status, executionLive, className = "" }: Props) {
  const m = missionStatusMeta(status, { executionLive });
  const s = String(status || "").toLowerCase();
  const pulse =
    executionLive !== false &&
    (s === "running" || s === "in_progress" || s === "pending" || s === "accepted");
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-extrabold uppercase tracking-wide ${m.className} ${className}`}
    >
      {pulse ? (
        <span className="relative flex h-2 w-2" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-50" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
        </span>
      ) : null}
      {m.label}
    </span>
  );
}
