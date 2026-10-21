import { dueDay, type BizWorkTask } from "./business";

export const TASK_SORT_STORAGE_KEY = "korymb-task-sort";

export const TASK_SORTS = [
  { id: "urgent-overdue", label: "Urgence, puis retard" },
  { id: "created", label: "Date de création" },
  { id: "urgent", label: "Urgence" },
  { id: "overdue", label: "Délai dépassé" },
  { id: "due-soon", label: "Échéance proche" },
  { id: "priority", label: "Priorité P1, P2" },
  { id: "project", label: "Projet" },
  { id: "assignee", label: "Personne assignée" },
  { id: "activity", label: "Dernière activité" },
] as const;

export type TaskSortId = (typeof TASK_SORTS)[number]["id"];

export function isTaskSortId(value: string | null | undefined): value is TaskSortId {
  return TASK_SORTS.some((item) => item.id === value);
}

export function readTaskSort(): TaskSortId {
  if (typeof window === "undefined") return "urgent-overdue";
  try {
    const raw = window.localStorage.getItem(TASK_SORT_STORAGE_KEY);
    return isTaskSortId(raw) ? raw : "urgent-overdue";
  } catch {
    return "urgent-overdue";
  }
}

export function writeTaskSort(id: TaskSortId) {
  try {
    window.localStorage.setItem(TASK_SORT_STORAGE_KEY, id);
  } catch {
    /* stockage indisponible */
  }
}

function priorityRank(priority: string | undefined): number {
  const match = /^P(\d+)/i.exec((priority || "").trim());
  if (!match) return 1000;
  return Number(match[1]);
}

function stamp(value: string | undefined): string {
  return value || "";
}

export function sortTasks(
  tasks: BizWorkTask[],
  sort: TaskSortId,
  today: string,
  projectTitle: (id: string | null | undefined) => string = () => "",
): BizWorkTask[] {
  const dueRank = (task: BizWorkTask) => {
    const day = dueDay(task.due_at);
    if (!day) return 2;
    if (day < today) return 0;
    if (day === today) return 1;
    return 3;
  };
  const copy = [...tasks];
  copy.sort((a, b) => {
    const title = a.title.localeCompare(b.title, "fr");
    if (sort === "created") {
      return stamp(b.created_at).localeCompare(stamp(a.created_at)) || title;
    }
    if (sort === "urgent") {
      const gap = Number(Boolean(b.urgent)) - Number(Boolean(a.urgent));
      return gap || stamp(b.updated_at).localeCompare(stamp(a.updated_at)) || title;
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
      const gap = priorityRank(a.priority) - priorityRank(b.priority);
      return gap || title;
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
    const urgentGap = Number(Boolean(b.urgent)) - Number(Boolean(a.urgent));
    if (urgentGap !== 0) return urgentGap;
    const gap = dueRank(a) - dueRank(b);
    if (gap !== 0) return gap;
    return dueDay(a.due_at).localeCompare(dueDay(b.due_at)) || title;
  });
  return copy;
}
