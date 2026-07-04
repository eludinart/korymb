"use client";

import Link from "next/link";

type Props = {
  jobId: string;
  missionTitle?: string;
  variant?: "chat" | "mission";
};

/** Bandeau contextuel : même dossier mission ↔ chat. */
export default function MissionContextBanner({ jobId, missionTitle, variant = "chat" }: Props) {
  const title = missionTitle?.trim() || `Mission #${jobId}`;
  if (variant === "mission") {
    return (
      <div className="rounded-xl border border-violet-200 bg-violet-50/80 px-3 py-2 text-xs text-violet-950">
        <span className="font-semibold">Dossier mission</span>
        <span className="text-violet-800"> — échanges et synthèse regroupés ici.</span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5 text-sm text-sky-950">
      <p className="min-w-0">
        <span className="font-semibold">Lié à la mission</span>
        <span className="mx-1 text-sky-700">·</span>
        <span className="truncate text-sky-900">{title}</span>
      </p>
      <Link
        href={`/missions?job=${encodeURIComponent(jobId)}`}
        className="shrink-0 rounded-lg bg-sky-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-800"
      >
        Voir dans Missions →
      </Link>
    </div>
  );
}
