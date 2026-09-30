"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import InboxActionCard, { type InboxActionItem } from "./InboxActionCard";
import InboxDisplayToolbar from "./InboxDisplayToolbar";
import { EmptyState } from "../ui/PageChrome";
import {
  countInboxBySeverity,
  countInboxByTab,
  filterInboxBySeverity,
  filterInboxByTab,
  filterInboxItems,
  inboxItemKey,
  loadInboxDisplayPrefs,
  saveInboxDisplayPrefs,
  sortInboxItems,
  type InboxDisplayPrefs,
  type InboxSeverityFilter,
} from "../../lib/inboxDisplay";

type Props = {
  items: InboxActionItem[];
  emptyTitle?: string;
  emptyHint?: string;
  compactToolbar?: boolean;
  limit?: number;
  /** Filtre sévérité forcé (ex. URL ?severity=critical). */
  initialSeverity?: InboxSeverityFilter | null;
};

export default function DirectorInboxList({
  items,
  emptyTitle = "Rien en attente",
  emptyHint,
  compactToolbar = false,
  limit,
  initialSeverity = null,
}: Props) {
  const qc = useQueryClient();
  const [prefs, setPrefs] = useState<InboxDisplayPrefs>(() => {
    const base = loadInboxDisplayPrefs();
    if (initialSeverity && initialSeverity !== "all") {
      return { ...base, severity: initialSeverity, sort: "severity_desc" };
    }
    return base;
  });

  useEffect(() => {
    if (!initialSeverity || initialSeverity === "all") return;
    setPrefs((prev) =>
      prev.severity === initialSeverity ? prev : { ...prev, severity: initialSeverity, sort: "severity_desc" },
    );
  }, [initialSeverity]);

  const onPrefsChange = (next: InboxDisplayPrefs) => {
    setPrefs(next);
    saveInboxDisplayPrefs(next);
  };

  const onDismissed = () => {
    void qc.invalidateQueries({ queryKey: ["admin-inbox"] });
    void qc.invalidateQueries({ queryKey: ["admin-briefing"] });
  };

  const tabCounts = useMemo(() => countInboxByTab(items), [items]);
  const severityCounts = useMemo(() => countInboxBySeverity(items), [items]);

  const { visible, total } = useMemo(() => {
    const byTab = filterInboxByTab(items, prefs.tab);
    const bySeverity = filterInboxBySeverity(byTab, prefs.severity);
    const filtered = filterInboxItems(bySeverity, prefs.kindFilter);
    const sorted = sortInboxItems(filtered, prefs.sort);
    const totalCount = sorted.length;
    const sliced = limit != null ? sorted.slice(0, limit) : sorted;
    return { visible: sliced, total: totalCount };
  }, [items, prefs, limit]);

  if (items.length === 0) {
    return <EmptyState title={emptyTitle}>{emptyHint}</EmptyState>;
  }

  return (
    <>
      <InboxDisplayToolbar
        prefs={prefs}
        onChange={onPrefsChange}
        total={items.length}
        visible={visible.length}
        tabCounts={tabCounts}
        severityCounts={severityCounts}
        compact={compactToolbar}
      />
      {visible.length === 0 ? (
        <EmptyState title="Aucune décision pour ce filtre">Changez le type, la sévérité ou l&apos;ordre d&apos;affichage.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {visible.map((item, idx) => (
            <InboxActionCard
              key={inboxItemKey(item, idx)}
              item={item}
              onDismissed={onDismissed}
            />
          ))}
        </ul>
      )}
      {limit != null && total > limit ? (
        <p className="mt-3 text-center text-sm font-medium text-violet-800">
          {total - limit} autre{total - limit > 1 ? "s" : ""} décision{total - limit > 1 ? "s" : ""} — voir toutes les décisions
        </p>
      ) : null}
    </>
  );
}
