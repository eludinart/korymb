"use client";

import MissionStatusBadge from "./MissionStatusBadge";

type Props = {
  status?: string | null;
  tokensTotal?: number | null;
  costUsd?: number | null;
  eventsTotal?: number | null;
  logTotal?: number | null;
  className?: string;
};

/** Bandeau compact métriques + statut (lecture en quelques secondes). */
export default function MissionMetricsRow({
  status,
  tokensTotal,
  costUsd,
  eventsTotal,
  logTotal,
  className = "",
}: Props) {
  const chip = "inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-700 tabular-nums shadow-sm";
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <MissionStatusBadge status={status} />
      <span className={chip}>
        <span className="font-medium text-slate-500">Tokens</span>
        {Number(tokensTotal || 0).toLocaleString("fr-FR")}
      </span>
      <span className={chip}>
        <span className="font-medium text-slate-500">Coût</span>
        ${Number(costUsd || 0).toFixed(4)}
      </span>
      <span className={chip}>
        <span className="font-medium text-slate-500">Évén.</span>
        {Number(eventsTotal || 0).toLocaleString("fr-FR")}
      </span>
      <span className={chip}>
        <span className="font-medium text-slate-500">Logs</span>
        {Number(logTotal || 0).toLocaleString("fr-FR")}
      </span>
    </div>
  );
}
