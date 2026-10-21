"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { businessApi, dueLabel, todayISO } from "../../lib/business";
import { invalidateWorkTasks } from "./workTaskActions";

export default function TaskComposer({ projectId }: { projectId?: string | null }) {
  const qc = useQueryClient();
  const today = todayISO();
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [assignee, setAssignee] = useState("");
  const [showDate, setShowDate] = useState(false);
  const [showAssignee, setShowAssignee] = useState(false);
  const [error, setError] = useState("");

  const add = useMutation({
    mutationFn: () => businessApi.createTask({
      title: title.trim(),
      due_at: due || null,
      assignee: assignee.trim() || undefined,
      project_id: projectId || null,
    }),
    onSuccess: () => {
      setTitle("");
      setDue("");
      setAssignee("");
      setShowDate(false);
      setShowAssignee(false);
      setError("");
      invalidateWorkTasks(qc);
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!title.trim()) {
          setError("Le titre est obligatoire.");
          return;
        }
        add.mutate();
      }}
    >
      <div className="flex gap-2">
        <input
          className="input-field min-w-0 flex-1"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Nouvelle tâche"
          aria-label="Nouvelle tâche"
          maxLength={800}
        />
        <button type="submit" className="btn-primary shrink-0" disabled={add.isPending}>
          {add.isPending ? "Ajout…" : "Ajouter"}
        </button>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        <button
          type="button"
          className="text-xs font-bold text-violet-800 hover:underline dark:text-violet-200"
          aria-expanded={showDate}
          onClick={() => setShowDate((value) => !value)}
        >
          {due ? dueLabel(due, today) : "Date"}
        </button>
        <button
          type="button"
          className="text-xs font-bold text-violet-800 hover:underline dark:text-violet-200"
          aria-expanded={showAssignee}
          onClick={() => setShowAssignee((value) => !value)}
        >
          {assignee.trim() ? `Assigné à ${assignee.trim()}` : "Assigné à"}
        </button>
      </div>
      {showDate ? (
        <input
          type="date"
          className="input-field max-w-xs"
          value={due}
          aria-label="Date d'exécution"
          onChange={(event) => {
            setDue(event.target.value);
            if (event.target.value) setShowDate(false);
          }}
        />
      ) : null}
      {showAssignee ? (
        <input
          className="input-field max-w-xs"
          value={assignee}
          onChange={(event) => setAssignee(event.target.value)}
          placeholder="Prénom"
          aria-label="Assigné à"
          maxLength={120}
          title="La personne qui doit faire cette tâche. La cloche le signale."
        />
      ) : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </form>
  );
}
