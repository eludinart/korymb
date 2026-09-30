"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Hauteur max relative (défaut ~85dvh). */
  tall?: boolean;
};

/** Bottom sheet mobile — historique / flotte / livrables. */
export default function ChatBottomSheet({ open, onClose, title, children, tall }: Props) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!ready || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[90] lg:hidden" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="absolute inset-0 bg-slate-950/45 dark:bg-black/60" aria-label="Fermer" onClick={onClose} />
      <div
        className={`absolute inset-x-0 bottom-0 flex flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl dark:bg-slate-900 dark:shadow-black/50 ${
          tall ? "max-h-[92dvh]" : "max-h-[85dvh]"
        }`}
        style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 pb-3 pt-2 dark:border-slate-800">
          <div className="mx-auto absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-full bg-slate-300 dark:bg-slate-600" aria-hidden />
          <p className="mt-2 text-base font-bold text-slate-900 dark:text-slate-50">{title}</p>
          <button
            type="button"
            onClick={onClose}
            className="mt-2 rounded-full px-2 py-1 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Fermer
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
