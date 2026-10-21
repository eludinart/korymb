"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { BizWorkTask } from "@/lib/business";

const NOTE_MAX = 2500;

export default function TaskEditDialog({
  task,
  saving,
  error,
  onClose,
  onSave,
}: {
  task: BizWorkTask | null;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSave: (patch: { title: string; notes: string; assignee: string }) => void;
}) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [assignee, setAssignee] = useState("");
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    setTitle(task?.title ?? "");
    setNotes(task?.notes ?? "");
    setAssignee(task?.assignee ?? "");
    setLocalError("");
  }, [task]);

  const shownError = localError || error;

  return (
    <Dialog
      open={task !== null}
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent className="border-slate-200 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50">
        <DialogHeader>
          <DialogTitle>Modifier la tâche</DialogTitle>
          <DialogDescription>
            Changez le texte ou ajoutez un commentaire. Le commentaire reste attaché à la tâche.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const nextTitle = title.trim();
            if (!nextTitle) {
              setLocalError("Le titre est obligatoire.");
              return;
            }
            setLocalError("");
            onSave({ title: nextTitle, notes: notes.trim(), assignee: assignee.trim() });
          }}
        >
          <label className="grid gap-1 text-sm font-semibold">
            Texte
            <input
              className="input-field"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={800}
              aria-label="Texte de la tâche"
              autoFocus
            />
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            Assigné à
            <input
              className="input-field"
              value={assignee}
              onChange={(event) => setAssignee(event.target.value)}
              maxLength={120}
              placeholder="Prénom"
              aria-label="Assigné à"
              title="La personne qui doit faire cette tâche. La cloche le signale."
            />
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            Commentaire
            <textarea
              className="input-field min-h-40 resize-y"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={NOTE_MAX}
              placeholder="Ajouter un commentaire"
              aria-label="Commentaire"
            />
            <span className="text-xs font-normal text-slate-500">
              {notes.length}/{NOTE_MAX}
            </span>
          </label>
          {shownError ? <p className="text-sm text-red-700 dark:text-red-300">{shownError}</p> : null}
          <DialogFooter className="gap-2">
            <button type="button" className="btn-secondary" disabled={saving} onClick={onClose}>
              Annuler
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
