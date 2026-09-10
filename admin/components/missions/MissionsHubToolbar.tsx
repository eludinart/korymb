"use client";

export type MissionsHubView = "active" | "archives" | "guided";

type Props = {
  view: MissionsHubView;
  onViewChange: (view: MissionsHubView) => void;
  showCreate: boolean;
  onToggleCreate: () => void;
  activeCount: number;
  archivesCount: number;
};

export default function MissionsHubToolbar({
  view,
  onViewChange,
  showCreate,
  onToggleCreate,
  activeCount,
  archivesCount,
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
      </div>
      <button type="button" onClick={onToggleCreate} className="btn-primary w-full px-3 text-sm sm:w-auto">
        {showCreate ? "Masquer" : "Nouvelle mission"}
      </button>
    </div>
  );
}
