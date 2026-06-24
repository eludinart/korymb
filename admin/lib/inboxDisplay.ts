import type { InboxActionItem } from "../components/director/InboxActionCard";

export type InboxSortMode =
  | "priority_desc"
  | "priority_asc"
  | "overdue_desc"
  | "date_asc"
  | "date_desc";

export type InboxKindFilter = "all" | InboxActionItem["kind"];

export type InboxDisplayPrefs = {
  sort: InboxSortMode;
  kindFilter: InboxKindFilter;
};

const LS_KEY = "korymb-inbox-display-prefs";

const DEFAULT_PREFS: InboxDisplayPrefs = {
  sort: "priority_desc",
  kindFilter: "all",
};

export const INBOX_SORT_OPTIONS: { value: InboxSortMode; label: string }[] = [
  { value: "priority_desc", label: "Priorité — la plus urgente d'abord" },
  { value: "priority_asc", label: "Priorité — la moins urgente d'abord" },
  { value: "overdue_desc", label: "Retard — le plus en retard d'abord" },
  { value: "date_asc", label: "Ancienneté — la plus ancienne d'abord" },
  { value: "date_desc", label: "Ancienneté — la plus récente d'abord" },
];

export const INBOX_KIND_OPTIONS: { value: InboxKindFilter; label: string }[] = [
  { value: "all", label: "Tous les types" },
  { value: "hitl", label: "HITL" },
  { value: "cio_question", label: "Questions CIO" },
  { value: "closure", label: "Clôtures" },
  { value: "quality", label: "Qualité" },
  { value: "scheduler_output", label: "Approbations" },
  { value: "learning_suggestion", label: "Apprentissage" },
];

export function loadInboxDisplayPrefs(): InboxDisplayPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<InboxDisplayPrefs>;
    const sort = INBOX_SORT_OPTIONS.some((o) => o.value === parsed.sort) ? parsed.sort! : DEFAULT_PREFS.sort;
    const kindFilter = INBOX_KIND_OPTIONS.some((o) => o.value === parsed.kindFilter)
      ? parsed.kindFilter!
      : DEFAULT_PREFS.kindFilter;
    return { sort, kindFilter };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function saveInboxDisplayPrefs(prefs: InboxDisplayPrefs) {
  if (typeof window === "undefined") return;
  localStorage.setItem(LS_KEY, JSON.stringify(prefs));
}

function ts(item: InboxActionItem): number {
  const raw = item.created_at || item.updated_at;
  if (!raw) return 0;
  const n = Date.parse(raw);
  return Number.isFinite(n) ? n : 0;
}

export function filterInboxItems(items: InboxActionItem[], kindFilter: InboxKindFilter): InboxActionItem[] {
  if (kindFilter === "all") return items;
  return items.filter((i) => i.kind === kindFilter);
}

export function sortInboxItems(items: InboxActionItem[], sort: InboxSortMode): InboxActionItem[] {
  const list = [...items];
  switch (sort) {
    case "priority_asc":
      return list.sort(
        (a, b) =>
          Number(b.priority_score ?? 9) - Number(a.priority_score ?? 9) ||
          ts(b) - ts(a),
      );
    case "overdue_desc":
      return list.sort(
        (a, b) =>
          Number(b.days_overdue ?? 0) - Number(a.days_overdue ?? 0) ||
          Number(a.priority_score ?? 9) - Number(b.priority_score ?? 9) ||
          ts(a) - ts(b),
      );
    case "date_asc":
      return list.sort((a, b) => ts(a) - ts(b) || Number(a.priority_score ?? 9) - Number(b.priority_score ?? 9));
    case "date_desc":
      return list.sort((a, b) => ts(b) - ts(a) || Number(a.priority_score ?? 9) - Number(b.priority_score ?? 9));
    case "priority_desc":
    default:
      return list.sort(
        (a, b) =>
          Number(a.priority_score ?? 9) - Number(b.priority_score ?? 9) ||
          Number(b.days_overdue ?? 0) - Number(a.days_overdue ?? 0) ||
          ts(a) - ts(b),
      );
  }
}

export function formatInboxDate(iso?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

export function formatDaysOpen(days?: number): string {
  const n = Number(days ?? 0);
  if (n <= 0) return "Aujourd'hui";
  if (n === 1) return "1 jour";
  return `${n} jours`;
}

export function urgencyLabel(urgency?: string, daysOverdue?: number): string | null {
  const overdue = Number(daysOverdue ?? 0);
  if (overdue > 0) {
    return overdue === 1 ? "Retard +1 jour" : `Retard +${overdue} jours`;
  }
  if (urgency === "warning") return "À traiter bientôt";
  if (urgency === "critical") return "Très en retard";
  return null;
}

export function inboxItemKey(item: InboxActionItem, idx: number): string {
  return `${item.kind}-${item.job_id || item.output_id || item.suggestion_id || idx}`;
}
