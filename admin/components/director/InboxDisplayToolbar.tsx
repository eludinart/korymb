"use client";

import {
  INBOX_SEVERITY_OPTIONS,
  INBOX_SORT_OPTIONS,
  INBOX_TABS,
  type InboxDisplayPrefs,
  type InboxSeverityFilter,
  type InboxSortMode,
  type InboxTabId,
} from "../../lib/inboxDisplay";

type Props = {
  prefs: InboxDisplayPrefs;
  onChange: (prefs: InboxDisplayPrefs) => void;
  total: number;
  visible: number;
  tabCounts: Record<InboxTabId, number>;
  severityCounts?: Record<string, number>;
  compact?: boolean;
};

export default function InboxDisplayToolbar({
  prefs,
  onChange,
  total,
  visible,
  tabCounts,
  severityCounts,
  compact = false,
}: Props) {
  const setSort = (sort: InboxSortMode) => onChange({ ...prefs, sort });
  const setTab = (tab: InboxTabId) => onChange({ ...prefs, tab, kindFilter: "all" });
  const setSeverity = (severity: InboxSeverityFilter) => onChange({ ...prefs, severity });

  const urgentCount =
    Number(severityCounts?.critical || 0) + Number(severityCounts?.high || 0);

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

      {urgentCount > 0 && prefs.severity === "all" ? (
        <button
          type="button"
          onClick={() => setSeverity("critical")}
          className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-left text-xs font-bold text-rose-950 hover:bg-rose-100"
        >
          {urgentCount} urgente{urgentCount > 1 ? "s" : ""} (envois / validations) — filtrer →
        </button>
      ) : null}

      <div
        className={`flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between ${
          compact ? "" : ""
        }`}
      >
        <label className="flex min-w-[160px] flex-1 flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Sévérité</span>
          <select
            value={prefs.severity}
            onChange={(e) => setSeverity(e.target.value as InboxSeverityFilter)}
            className="field-input text-sm"
            aria-label="Filtrer par sévérité"
          >
            {INBOX_SEVERITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
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
            <>
              {total} décision{total > 1 ? "s" : ""}
            </>
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
