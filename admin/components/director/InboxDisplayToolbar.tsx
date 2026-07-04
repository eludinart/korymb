"use client";

import {
  INBOX_SORT_OPTIONS,
  INBOX_TABS,
  type InboxDisplayPrefs,
  type InboxSortMode,
  type InboxTabId,
} from "../../lib/inboxDisplay";

type Props = {
  prefs: InboxDisplayPrefs;
  onChange: (prefs: InboxDisplayPrefs) => void;
  total: number;
  visible: number;
  tabCounts: Record<InboxTabId, number>;
  compact?: boolean;
};

export default function InboxDisplayToolbar({ prefs, onChange, total, visible, tabCounts, compact = false }: Props) {
  const setSort = (sort: InboxSortMode) => onChange({ ...prefs, sort });
  const setTab = (tab: InboxTabId) => onChange({ ...prefs, tab, kindFilter: "all" });

  return (
    <div className={`space-y-3 ${compact ? "mb-3" : "mb-4"}`}>
      <div
        className="flex gap-1.5 overflow-x-auto pb-1"
        role="tablist"
        aria-label="Filtrer par type de décision"
      >
        {INBOX_TABS.map((tab) => {
          const count = tabCounts[tab.id] ?? 0;
          const active = prefs.tab === tab.id;
          if (tab.id !== "all" && count === 0) return null;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(tab.id)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
                active
                  ? "bg-violet-700 text-white shadow-sm"
                  : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
              }`}
            >
              {tab.label}
              {count > 0 ? ` (${count})` : ""}
            </button>
          );
        })}
      </div>

      <div
        className={`flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between ${
          compact ? "" : ""
        }`}
      >
        <label className="flex min-w-[200px] flex-1 flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Ordre</span>
          <select
            value={prefs.sort}
            onChange={(e) => setSort(e.target.value as InboxSortMode)}
            className="field-input text-sm"
            aria-label="Ordre d'affichage des décisions"
          >
            {INBOX_SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs font-medium text-slate-500 sm:pb-2">
          {visible === total ? (
            <>{total} décision{total > 1 ? "s" : ""}</>
          ) : (
            <>
              {visible} sur {total}
            </>
          )}
        </p>
      </div>
    </div>
  );
}
