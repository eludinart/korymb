"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import InboxActionCard, { type InboxActionItem } from "./InboxActionCard";
import InboxDisplayToolbar from "./InboxDisplayToolbar";
import { EmptyState } from "../ui/PageChrome";
import {
  countInboxByTab,
  filterInboxByTab,
  filterInboxItems,
  inboxItemKey,
  loadInboxDisplayPrefs,
  saveInboxDisplayPrefs,
  sortInboxItems,
  type InboxDisplayPrefs,
} from "../../lib/inboxDisplay";

type Props = {
  items: InboxActionItem[];
  emptyTitle?: string;
  emptyHint?: string;
  compactToolbar?: boolean;
  limit?: number;
};

export default function DirectorInboxList({
  items,
  emptyTitle = "Rien en attente",
  emptyHint,
  compactToolbar = false,
  limit,
}: Props) {
  const qc = useQueryClient();
  const [prefs, setPrefs] = useState<InboxDisplayPrefs>(() => loadInboxDisplayPrefs());

  const onPrefsChange = (next: InboxDisplayPrefs) => {
    setPrefs(next);
    saveInboxDisplayPrefs(next);
  };

  const onDismissed = () => {
    void qc.invalidateQueries({ queryKey: ["admin-inbox"] });
    void qc.invalidateQueries({ queryKey: ["admin-briefing"] });
  };

  const tabCounts = useMemo(() => countInboxByTab(items), [items]);

  const { visible, total } = useMemo(() => {
    const byTab = filterInboxByTab(items, prefs.tab);
    const filtered = filterInboxItems(byTab, prefs.kindFilter);
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
        compact={compactToolbar}
      />
      {visible.length === 0 ? (
        <EmptyState title="Aucune décision pour ce filtre">Changez le type ou l&apos;ordre d&apos;affichage.</EmptyState>
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
          {total - limit} autre{total - limit > 1 ? "s" : ""} décision{total - limit > 1 ? "s" : ""} — voir l&apos;inbox complète
        </p>
      ) : null}
    </>
  );
}
