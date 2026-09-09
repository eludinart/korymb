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
  const tabClass = (active: boolean) =>
    `touch-target rounded-full px-3 text-sm font-bold transition-colors ${
      active ? "bg-violet-700 text-white shadow-sm" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
    }`;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50/90 px-3 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:px-4">
      <div className="flex w-full gap-2 overflow-x-auto pb-0.5 sm:w-auto sm:flex-wrap" role="tablist" aria-label="Vue missions">
        <button type="button" role="tab" aria-selected={view === "active"} className={`${tabClass(view === "active")} shrink-0`} onClick={() => onViewChange("active")}>
          Opérationnel ({activeCount})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "archives"}
          className={`${tabClass(view === "archives")} shrink-0`}
          onClick={() => onViewChange("archives")}
        >
          Archives ({archivesCount})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "guided"}
          className={`${tabClass(view === "guided")} shrink-0`}
          onClick={() => onViewChange("guided")}
        >
          Cadrage guidé
        </button>
      </div>
      <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end">
        <button type="button" onClick={onToggleCreate} className="btn-primary w-full px-3 text-sm sm:w-auto">
          {showCreate ? "Masquer" : "Nouvelle mission"}
        </button>
      </div>
    </div>
  );
}
