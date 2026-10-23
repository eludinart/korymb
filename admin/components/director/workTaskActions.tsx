"use client";

import { useState } from "react";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { businessApi, type BizWorkTask } from "../../lib/business";
import TaskEditDialog from "./TaskEditDialog";

export type TaskPatch = {
  status?: "open" | "done";
  due_at?: string | null;
  urgent?: boolean;
  important?: boolean;
  title?: string;
  notes?: string;
  assignee?: string;
  reply?: string;
  chat_conversation_id?: string;
};

export function invalidateWorkTasks(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: ["work-tasks"] });
  void qc.invalidateQueries({ queryKey: ["business-events"] });
  void qc.invalidateQueries({ queryKey: ["admin-briefing"] });
  void qc.invalidateQueries({ queryKey: ["director-notifications"] });
}

export function useWorkTaskActions() {
  const qc = useQueryClient();
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<BizWorkTask | null>(null);

  const refresh = () => invalidateWorkTasks(qc);

  const save = useMutation({
    mutationFn: (body: { id: string; patch: TaskPatch }) => businessApi.updateTask(body.id, body.patch),
    onSuccess: () => {
      setError("");
      refresh();
    },
    onError: (err: Error) => setError(err.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => businessApi.deleteTask(id),
    onSuccess: () => {
      setError("");
      setEditing(null);
      refresh();
    },
    onError: (err: Error) => setError(err.message),
  });

  return { error, setError, editing, setEditing, save, remove, refresh };
}

export type WorkTaskActions = ReturnType<typeof useWorkTaskActions>;

export function WorkTaskEditor({ actions }: { actions: WorkTaskActions }) {
  return (
    <TaskEditDialog
      task={actions.editing}
      saving={actions.save.isPending}
      error={actions.editing ? actions.error : ""}
      onClose={() => actions.setEditing(null)}
      onSave={(patch) => {
        if (!actions.editing) return;
        actions.save.mutate(
          { id: actions.editing.id, patch },
          { onSuccess: () => actions.setEditing(null) },
        );
      }}
    />
  );
}
