"use client";

import { teamBadgeClass, teamIdentityLabel } from "../../lib/agentGroupUi";

export type MissionsHubView = "active" | "archives" | "guided";

type Props = {
  view: MissionsHubView;
  onViewChange: (view: MissionsHubView) => void;
  showCreate: boolean;
  onToggleCreate: () => void;
  activeCount: number;
  archivesCount: number;
  /** Filtre équipe (optionnel, affiché seulement s'il y a plusieurs équipes). */
  teamFilterOptions?: Array<{ id: string; label: string }>;
  teamFilter?: string;
  onTeamFilterChange?: (id: string) => void;
};

export default function MissionsHubToolbar({
  view,
  onViewChange,
  showCreate,
  onToggleCreate,
  activeCount,
  archivesCount,
  teamFilterOptions,
  teamFilter = "all",
  onTeamFilterChange,
}: Props) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-3 shadow-sm sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:px-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <button
          type="button"
          role="tab"
          aria-selected={view === "active"}
          className={`rounded-full px-3.5 py-2 text-sm font-bold transition-colors ${
            view === "active"
              ? "bg-slate-900 text-white shadow-sm"
              : "bg-slate-100 text-slate-700 hover:bg-slate-200"
          }`}
          onClick={() => onViewChange("active")}
        >
          En cours ({activeCount})
        </button>
        <button
          type="button"
          className={`rounded-full px-3 py-2 text-sm font-medium ${
            view === "archives" ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100"
          }`}
          onClick={() => onViewChange("archives")}
        >
          Archives ({archivesCount})
        </button>
        <button
          type="button"
          className={`rounded-full px-3 py-2 text-sm font-medium ${
            view === "guided" ? "bg-slate-800 text-white" : "text-slate-500 hover:bg-slate-100"
          }`}
          onClick={() => onViewChange("guided")}
        >
          Cadrage
        </button>
        {teamFilterOptions && onTeamFilterChange && (teamFilterOptions.length > 1 || teamFilter !== "all") ? (
          <select
            className={`h-9 max-w-[14rem] truncate rounded-full border px-2.5 text-xs font-semibold ${
              teamFilter === "all"
                ? "border-slate-200 bg-slate-50 text-slate-700"
                : teamBadgeClass(teamFilter)
            }`}
            value={teamFilter}
            onChange={(e) => onTeamFilterChange(e.target.value)}
            aria-label="Filtrer par équipe"
            title="Filtrer par équipe"
          >
            <option value="all">Toutes les équipes</option>
            {teamFilterOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {teamIdentityLabel(o.id, o.label)}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      <button type="button" onClick={onToggleCreate} className="btn-primary w-full px-3 text-sm sm:w-auto">
        {showCreate ? "Masquer" : "Nouvelle mission"}
      </button>
    </div>
  );
}
