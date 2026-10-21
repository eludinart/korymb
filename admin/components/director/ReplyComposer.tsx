"use client";

import { useEffect, useState } from "react";
import ReplyDrawer, { type ReplyDiscussTarget } from "./ReplyDrawer";
import { REPLY_MAX, replyBlockStartsOpen, type ReplyKind } from "@/lib/replyContext";

export default function ReplyComposer({
  kind,
  title,
  notes = "",
  subject = "",
  reply,
  replyAt = "",
  conversationId,
  saving,
  error = "",
  onSave,
  onConversationId,
  savedLabel,
  indent = true,
}: {
  kind: ReplyKind;
  title: string;
  notes?: string;
  subject?: string;
  reply: string;
  replyAt?: string;
  conversationId: string;
  saving: boolean;
  error?: string;
  onSave: (reply: string) => void | Promise<void>;
  onConversationId: (id: string) => Promise<void>;
  savedLabel?: string;
  indent?: boolean;
}) {
  const [open, setOpen] = useState(() => replyBlockStartsOpen(title, notes, reply));
  const [text, setText] = useState(reply);
  const [discussing, setDiscussing] = useState(false);
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    setText(reply);
  }, [reply]);

  useEffect(() => {
    if (replyBlockStartsOpen(title, notes, reply)) setOpen(true);
  }, [title, notes, reply]);

  const shownError = localError || error;
  const dirty = text.trim() !== reply.trim();
  const pad = indent ? "pl-7" : "";
  const target: ReplyDiscussTarget = {
    kind,
    title,
    notes,
    subject,
    conversationId,
    draft: text,
  };

  if (!open) {
    return (
      <div className={`mt-2 ${pad}`}>
        <button type="button" className="text-xs font-bold text-violet-800 hover:underline dark:text-violet-200" onClick={() => setOpen(true)}>
          Répondre
        </button>
      </div>
    );
  }

  return (
    <div className={`mt-2 grid gap-2 ${pad}`}>
      <label className="grid gap-1 text-xs font-semibold text-slate-700 dark:text-slate-200">
        Votre réponse
        <textarea
          className="input-field min-h-24 resize-y text-sm font-normal"
          value={text}
          maxLength={REPLY_MAX}
          aria-label={`Votre réponse — ${title}`}
          placeholder="Écrire la réponse"
          onChange={(event) => {
            setLocalError("");
            setText(event.target.value);
          }}
        />
        <span className="font-normal text-slate-500">{text.length}/{REPLY_MAX}</span>
      </label>
      {reply.trim() && savedLabel ? <p className="text-xs text-slate-500">{savedLabel}</p> : null}
      {replyAt && reply.trim() && !savedLabel ? (
        <p className="text-xs text-slate-500">Réponse enregistrée</p>
      ) : null}
      {shownError ? <p className="text-sm text-red-700 dark:text-red-300">{shownError}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={saving || !dirty}
          onClick={() => {
            setLocalError("");
            void Promise.resolve(onSave(text.trim())).catch((err: unknown) => {
              setLocalError(err instanceof Error ? err.message : "Impossible d'enregistrer la réponse.");
            });
          }}
        >
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            setLocalError("");
            setDiscussing(true);
          }}
        >
          Discuter
        </button>
      </div>
      <ReplyDrawer
        open={discussing}
        target={target}
        onClose={() => setDiscussing(false)}
        onConversationId={async (id) => {
          try {
            await onConversationId(id);
          } catch (err) {
            setLocalError(err instanceof Error ? err.message : "Impossible d'attacher la discussion.");
            throw err;
          }
        }}
        onUse={(next) => {
          setText(next.slice(0, REPLY_MAX));
          setLocalError("");
        }}
      />
    </div>
  );
}
