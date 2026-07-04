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
    `rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
      active ? "bg-violet-700 text-white shadow-sm" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
    }`;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50/90 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Vue missions">
        <button type="button" role="tab" aria-selected={view === "active"} className={tabClass(view === "active")} onClick={() => onViewChange("active")}>
          Opérationnel ({activeCount})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "archives"}
          className={tabClass(view === "archives")}
          onClick={() => onViewChange("archives")}
        >
          Archives ({archivesCount})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "guided"}
          className={tabClass(view === "guided")}
          onClick={() => onViewChange("guided")}
        >
          Cadrage guidé
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onToggleCreate} className="btn-primary px-3 py-2 text-xs">
          {showCreate ? "Masquer" : "Nouvelle mission"}
        </button>
      </div>
    </div>
  );
}
