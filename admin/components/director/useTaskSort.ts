"use client";

import { useEffect, useState } from "react";
import {
  readTaskSortCriteria,
  writeTaskSortCriteria,
  type TaskSortId,
} from "../../lib/taskSort";

export function useTaskSort() {
  const [criteria, setCriteria] = useState<TaskSortId[]>(["urgent-overdue"]);

  useEffect(() => {
    setCriteria(readTaskSortCriteria());
  }, []);

  const choose = (id: TaskSortId) => {
    const next = [id];
    setCriteria(next);
    writeTaskSortCriteria(next);
  };

  const setSortCriteria = (ids: TaskSortId[]) => {
    const next = ids.length ? ids : (["urgent-overdue"] as TaskSortId[]);
    setCriteria(next);
    writeTaskSortCriteria(next);
  };

  return {
    /** Premier critère — compat composants qui passent encore `sort` mono. */
    sort: criteria[0] || "urgent-overdue",
    criteria,
    choose,
    setSortCriteria,
  };
}
