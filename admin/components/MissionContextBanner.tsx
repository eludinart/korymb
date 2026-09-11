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
    <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-sky-950 sm:flex-wrap sm:justify-between sm:rounded-xl sm:border sm:border-sky-200 sm:bg-sky-50 sm:px-3 sm:py-2.5 sm:text-sm">
      <p className="min-w-0 truncate">
        <span className="font-semibold">Mission</span>
        <span className="mx-1 text-sky-700">·</span>
        <span className="text-sky-900">{title}</span>
      </p>
      <Link
        href={`/missions?job=${encodeURIComponent(jobId)}`}
        className="shrink-0 font-semibold text-sky-800 underline-offset-2 hover:underline sm:rounded-lg sm:bg-sky-700 sm:px-3 sm:py-1.5 sm:text-xs sm:font-bold sm:text-white sm:no-underline sm:hover:bg-sky-800 sm:hover:no-underline"
      >
        Ouvrir
      </Link>
    </div>
  );
}
