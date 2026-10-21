"use client";

import { useEffect, useState } from "react";
import { readTaskSort, writeTaskSort, type TaskSortId } from "../../lib/taskSort";

export function useTaskSort() {
  const [sort, setSort] = useState<TaskSortId>("urgent-overdue");

  useEffect(() => {
    setSort(readTaskSort());
  }, []);

  const choose = (id: TaskSortId) => {
    setSort(id);
    writeTaskSort(id);
  };

  return { sort, choose };
}
