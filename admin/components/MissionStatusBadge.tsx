"use client";

import { missionStatusMeta } from "../lib/missionBossView";

type Props = {
  status?: string | null;
  className?: string;
};

export default function MissionStatusBadge({ status, className = "" }: Props) {
  const m = missionStatusMeta(status);
  return (
    <span
      className={`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-extrabold uppercase tracking-wide ${m.className} ${className}`}
    >
      {m.label}
    </span>
  );
}
