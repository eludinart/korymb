"use client";

import {
  INBOX_KIND_OPTIONS,
  INBOX_SORT_OPTIONS,
  type InboxDisplayPrefs,
  type InboxKindFilter,
  type InboxSortMode,
} from "../../lib/inboxDisplay";

type Props = {
  prefs: InboxDisplayPrefs;
  onChange: (prefs: InboxDisplayPrefs) => void;
  total: number;
  visible: number;
  compact?: boolean;
};

export default function InboxDisplayToolbar({ prefs, onChange, total, visible, compact = false }: Props) {
  const setSort = (sort: InboxSortMode) => onChange({ ...prefs, sort });
  const setKind = (kindFilter: InboxKindFilter) => onChange({ ...prefs, kindFilter });

  return (
    <div
      className={`flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between ${
        compact ? "mb-3" : "mb-4"
      }`}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex min-w-[200px] flex-1 flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Ordre d&apos;affichage</span>
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
        <label className="flex min-w-[180px] flex-1 flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Type</span>
          <select
            value={prefs.kindFilter}
            onChange={(e) => setKind(e.target.value as InboxKindFilter)}
            className="field-input text-sm"
            aria-label="Filtrer par type de décision"
          >
            {INBOX_KIND_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-xs font-medium text-slate-500 sm:pb-2">
        {visible === total ? (
          <>{total} décision{total > 1 ? "s" : ""}</>
        ) : (
          <>
            {visible} sur {total} décision{total > 1 ? "s" : ""}
          </>
        )}
      </p>
    </div>
  );
}
