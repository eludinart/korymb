"use client";

import { useCallback, useEffect } from "react";
import AgentMessageMarkdown from "../AgentMessageMarkdown";

type Props = {
  open: boolean;
  title: string;
  body: string;
  onClose: () => void;
};

function downloadMarkdown(filename: string, body: string) {
  const blob = new Blob([body], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function InAppDeliverableModal({ open, title, body, onClose }: Props) {
  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", onKeyDown);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prev;
    };
  }, [open, onKeyDown]);

  if (!open) return null;

  const fname = `livrable-${title.slice(0, 40).replace(/[^\w\-àâäéèêëïîôùûüç]+/gi, "_")}.md`;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-4" role="dialog" aria-modal aria-labelledby="in-app-deliverable-title">
      <button type="button" className="absolute inset-0 bg-slate-900/55" onClick={onClose} aria-label="Fermer" />
      <div className="relative z-10 flex max-h-[min(92dvh,48rem)] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:rounded-2xl">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wide text-violet-800">Livrable · lecture intégrée</p>
            <h2 id="in-app-deliverable-title" className="mt-0.5 text-sm font-semibold leading-snug text-slate-900">
              {title}
            </h2>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(body)}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
            >
              Copier
            </button>
            <button
              type="button"
              onClick={() => downloadMarkdown(fname, body)}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
            >
              .md
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-[11px] font-bold text-violet-900 hover:bg-violet-100"
            >
              Fermer
            </button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <AgentMessageMarkdown
            source={body}
            className="text-sm leading-relaxed text-slate-800 [&_li]:text-sm [&_p]:text-sm"
          />
        </div>
      </div>
    </div>
  );
}
