import type { InboxActionItem } from "../components/director/InboxActionCard";
import { inboxItemKey } from "./inboxDisplay";

const LS_KEY = "korymb-inbox-snooze";

type SnoozeEntry = { until: number; key: string };

function loadSnoozes(): SnoozeEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LS_KEY);
    const parsed = raw ? (JSON.parse(raw) as SnoozeEntry[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveSnoozes(entries: SnoozeEntry[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(LS_KEY, JSON.stringify(entries));
}

export function snoozeInboxItem(item: InboxActionItem, idx: number, hours = 24): void {
  const key = inboxItemKey(item, idx);
  const until = Date.now() + hours * 60 * 60 * 1000;
  const rest = loadSnoozes().filter((e) => e.key !== key);
  saveSnoozes([...rest, { key, until }]);
}

export function filterSnoozedItems(items: InboxActionItem[]): InboxActionItem[] {
  const now = Date.now();
  const active = new Set(loadSnoozes().filter((e) => e.until > now).map((e) => e.key));
  if (!active.size) return items;
  return items.filter((item, idx) => !active.has(inboxItemKey(item, idx)));
}

export function clearExpiredSnoozes() {
  const now = Date.now();
  saveSnoozes(loadSnoozes().filter((e) => e.until > now));
}
