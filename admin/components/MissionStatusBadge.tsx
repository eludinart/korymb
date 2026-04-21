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
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${m.className} ${className}`}
    >
      {m.label}
    </span>
  );
}
