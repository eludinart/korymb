"use client";

import { useEffect } from "react";

type Props = {
  message: string;
  detail?: string;
  busy?: boolean;
  onUndo: () => void;
  onDismiss: () => void;
};

export default function RepriseUndoSnack({ message, detail, busy, onUndo, onDismiss }: Props) {
  useEffect(() => {
    const t = window.setTimeout(onDismiss, 8000);
    return () => window.clearTimeout(t);
  }, [onDismiss]);

  return (
    <div
      role="status"
      className="fixed bottom-4 left-3 right-3 z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-slate-200 bg-slate-900 px-4 py-3 text-white shadow-2xl sm:left-auto sm:right-4"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold">{message}</p>
        {detail ? <p className="mt-0.5 truncate text-xs text-slate-300">{detail}</p> : null}
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={onUndo}
        className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-xs font-extrabold text-slate-900 hover:bg-slate-100 disabled:opacity-50"
      >
        {busy ? "…" : "Annuler"}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-400 hover:text-white"
        aria-label="Fermer"
      >
        ×
      </button>
    </div>
  );
}
