"use client";

import { useEffect, useId, useState } from "react";

type Props = {
  title: string;
  hint: string;
  /** Ouvert au premier rendu ; l’utilisateur peut ensuite replier/déplier librement. */
  defaultOpen?: boolean;
  children: React.ReactNode;
};

/**
 * Bloc mission repliable (même look que &lt;details&gt;, sans l’élément natif).
 * Évite les conflits navigateur / React 19 sur &lt;details open&gt; contrôlé (removeChild).
 */
export default function CollapsibleMissionSection({ title, hint, defaultOpen = true, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  useEffect(() => {
    setOpen(defaultOpen);
  }, [defaultOpen]);

  return (
    <section className="rounded-2xl border border-slate-200 bg-slate-50/80 shadow-sm">
      <button
        type="button"
        id={`${panelId}-trigger`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left hover:bg-slate-100/80"
      >
        <span className="min-w-0">
          <span className="block text-sm font-medium text-slate-800">{title}</span>
          <span className="mt-0.5 block text-xs font-normal text-slate-500">{hint}</span>
        </span>
        <span
          className={`shrink-0 text-slate-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          aria-hidden
        >
          ▼
        </span>
      </button>
      {open ? (
        <div id={panelId} role="region" aria-labelledby={`${panelId}-trigger`} className="border-t border-slate-200 bg-white px-3 py-3 sm:px-4">
          {children}
        </div>
      ) : null}
    </section>
  );
}
