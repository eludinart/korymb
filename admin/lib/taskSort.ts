import { dueDay, type BizWorkTask } from "./business";

export const TASK_SORT_STORAGE_KEY = "korymb-task-sort-v2";
/** Ancienne clé mono-critère — lue une fois pour migrer. */
const LEGACY_SORT_KEY = "korymb-task-sort";

export const TASK_SORTS = [
  { id: "urgent-overdue", label: "Urgence, puis retard" },
  { id: "important-urgent", label: "Important, puis urgent" },
  { id: "created", label: "Date de création" },
  { id: "urgent", label: "Urgence" },
  { id: "important", label: "Importance" },
  { id: "overdue", label: "Délai dépassé" },
  { id: "due-soon", label: "Échéance proche" },
  { id: "priority", label: "Priorité P1, P2" },
  { id: "project", label: "Projet" },
  { id: "assignee", label: "Personne assignée" },
  { id: "activity", label: "Dernière activité" },
  { id: "awaiting-reply", label: "Réponse en attente" },
] as const;

/** Quatre cases « Quoi d’abord » (matrice d’Eisenhower, langage courant). */
export const EISENHOWER_BUCKETS = [
  { id: "urgent-important", label: "Urgent et important" },
  { id: "important", label: "Important, pas urgent" },
  { id: "urgent", label: "Urgent, pas important" },
  { id: "neither", label: "Ni l’un ni l’autre" },
] as const;

export type EisenhowerBucketId = (typeof EISENHOWER_BUCKETS)[number]["id"];

export function eisenhowerBucket(task: Pick<BizWorkTask, "urgent" | "important">): EisenhowerBucketId {
  const urgent = Boolean(task.urgent);
  const important = Boolean(task.important);
  if (urgent && important) return "urgent-important";
  if (important) return "important";
  if (urgent) return "urgent";
  return "neither";
}

export function groupTasksByEisenhower(tasks: BizWorkTask[]): { id: EisenhowerBucketId; label: string; tasks: BizWorkTask[] }[] {
  const buckets = new Map<EisenhowerBucketId, BizWorkTask[]>();
  for (const item of EISENHOWER_BUCKETS) buckets.set(item.id, []);
  for (const task of tasks) {
    buckets.get(eisenhowerBucket(task))!.push(task);
  }
  return EISENHOWER_BUCKETS.map((item) => ({
    id: item.id,
    label: item.label,
    tasks: buckets.get(item.id) || [],
  })).filter((item) => item.tasks.length > 0);
}

export type TaskSortId = (typeof TASK_SORTS)[number]["id"];

export function isTaskSortId(value: string | null | undefined): value is TaskSortId {
  return TASK_SORTS.some((item) => item.id === value);
}

export function normalizeCriteria(raw: unknown): TaskSortId[] {
  if (!Array.isArray(raw)) return ["urgent-overdue"];
  const out: TaskSortId[] = [];
  for (const item of raw) {
    if (isTaskSortId(item) && !out.includes(item)) out.push(item);
  }
  return out.length ? out : ["urgent-overdue"];
}

export function readTaskSortCriteria(): TaskSortId[] {
  if (typeof window === "undefined") return ["urgent-overdue"];
  try {
    const raw = window.localStorage.getItem(TASK_SORT_STORAGE_KEY);
    if (raw) return normalizeCriteria(JSON.parse(raw));
    const legacy = window.localStorage.getItem(LEGACY_SORT_KEY);
    if (isTaskSortId(legacy)) {
      writeTaskSortCriteria([legacy]);
      return [legacy];
    }
  } catch {
    /* stockage indisponible */
  }
  return ["urgent-overdue"];
}

/** @deprecated Prefer readTaskSortCriteria — kept for callers that still want the primary key. */
export function readTaskSort(): TaskSortId {
  return readTaskSortCriteria()[0] || "urgent-overdue";
}

export function writeTaskSortCriteria(ids: TaskSortId[]) {
  try {
    window.localStorage.setItem(TASK_SORT_STORAGE_KEY, JSON.stringify(normalizeCriteria(ids)));
  } catch {
    /* stockage indisponible */
  }
}

/** @deprecated Prefer writeTaskSortCriteria */
export function writeTaskSort(id: TaskSortId) {
  writeTaskSortCriteria([id]);
}

function priorityRank(priority: string | undefined): number {
  const match = /^P(\d+)/i.exec((priority || "").trim());
  if (!match) return 1000;
  return Number(match[1]);
}

function stamp(value: string | undefined): string {
  return value || "";
}

function awaitingReply(task: BizWorkTask): boolean {
  if (task.status === "done") return false;
  if ((task.reply || "").trim()) return false;
  const notes = (task.notes || "").toLowerCase();
  const title = (task.title || "").trim();
  if (title.endsWith("?")) return true;
  if (notes.includes("attente") || notes.includes("répond") || notes.includes("repond")) return true;
  return Boolean(notes.trim());
}

/** Compare a vs b for one criterion. Negative → a before b. */
export function compareTasksBy(
  a: BizWorkTask,
  b: BizWorkTask,
  sort: TaskSortId,
  today: string,
  projectTitle: (id: string | null | undefined) => string = () => "",
): number {
  const title = a.title.localeCompare(b.title, "fr");
  if (sort === "created") {
    return stamp(b.created_at).localeCompare(stamp(a.created_at)) || title;
  }
  if (sort === "urgent") {
    const gap = Number(Boolean(b.urgent)) - Number(Boolean(a.urgent));
    return gap || stamp(b.updated_at).localeCompare(stamp(a.updated_at)) || title;
  }
  if (sort === "important") {
    const gap = Number(Boolean(b.important)) - Number(Boolean(a.important));
    return gap || stamp(b.updated_at).localeCompare(stamp(a.updated_at)) || title;
  }
  if (sort === "important-urgent") {
    const importantGap = Number(Boolean(b.important)) - Number(Boolean(a.important));
    if (importantGap !== 0) return importantGap;
    const urgentGap = Number(Boolean(b.urgent)) - Number(Boolean(a.urgent));
    return urgentGap || stamp(b.updated_at).localeCompare(stamp(a.updated_at)) || title;
  }
  if (sort === "overdue") {
    const aOver = dueDay(a.due_at) && dueDay(a.due_at) < today ? 0 : 1;
    const bOver = dueDay(b.due_at) && dueDay(b.due_at) < today ? 0 : 1;
    if (aOver !== bOver) return aOver - bOver;
    return dueDay(a.due_at).localeCompare(dueDay(b.due_at)) || title;
  }
  if (sort === "due-soon") {
    const aDay = dueDay(a.due_at);
    const bDay = dueDay(b.due_at);
    if (!aDay && !bDay) return title;
    if (!aDay) return 1;
    if (!bDay) return -1;
    return aDay.localeCompare(bDay) || title;
  }
  if (sort === "priority") {
    return priorityRank(a.priority) - priorityRank(b.priority) || title;
  }
  if (sort === "project") {
    const aName = projectTitle(a.project_id) || "\uffff";
    const bName = projectTitle(b.project_id) || "\uffff";
    return aName.localeCompare(bName, "fr") || title;
  }
  if (sort === "assignee") {
    const aName = a.assignee.trim() || "\uffff";
    const bName = b.assignee.trim() || "\uffff";
    return aName.localeCompare(bName, "fr") || title;
  }
  if (sort === "activity") {
    return stamp(b.updated_at).localeCompare(stamp(a.updated_at)) || title;
  }
  if (sort === "awaiting-reply") {
    const gap = Number(awaitingReply(b)) - Number(awaitingReply(a));
    return gap || title;
  }
  const dueRank = (task: BizWorkTask) => {
    const day = dueDay(task.due_at);
    if (!day) return 2;
    if (day < today) return 0;
    if (day === today) return 1;
    return 3;
  };
  const urgentGap = Number(Boolean(b.urgent)) - Number(Boolean(a.urgent));
  if (urgentGap !== 0) return urgentGap;
  const gap = dueRank(a) - dueRank(b);
  if (gap !== 0) return gap;
  return dueDay(a.due_at).localeCompare(dueDay(b.due_at)) || title;
}

export function sortTasks(
  tasks: BizWorkTask[],
  sort: TaskSortId | TaskSortId[],
  today: string,
  projectTitle: (id: string | null | undefined) => string = () => "",
): BizWorkTask[] {
  const criteria = normalizeCriteria(Array.isArray(sort) ? sort : [sort]);
  const copy = [...tasks];
  copy.sort((a, b) => {
    for (const id of criteria) {
      const gap = compareTasksBy(a, b, id, today, projectTitle);
      if (gap !== 0) return gap;
    }
    return a.title.localeCompare(b.title, "fr");
  });
  return copy;
}
