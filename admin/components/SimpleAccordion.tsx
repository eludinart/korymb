"use client";

import { useId, useState } from "react";

type Props = {
  title: string;
  hint?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  /** Classes sur le conteneur externe (bordure, fond, marge). */
  className?: string;
  /** Classes additionnelles sur le bouton d’en-tête. */
  triggerClassName?: string;
  /** Conteneur du panneau déplié (bordure haute, padding). */
  panelClassName?: string;
};

/**
 * Accordéon sans &lt;details&gt; natif (évite des désynchronisations DOM / removeChild avec React 19 + mises à jour fréquentes).
 */
export default function SimpleAccordion({
  title,
  hint,
  defaultOpen = false,
  children,
  className = "",
  triggerClassName = "",
  panelClassName = "border-t border-slate-200 px-4 py-4",
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const uid = useId();
  const panelId = `${uid}-panel`;
  const triggerId = `${uid}-trigger`;

  return (
    <section className={className}>
      <button
        type="button"
        id={triggerId}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center justify-between gap-3 text-left ${triggerClassName}`}
      >
        <span className="min-w-0">
          <span className="block text-sm font-medium text-slate-800">{title}</span>
          {hint ? <span className="mt-0.5 block text-xs font-normal text-slate-500">{hint}</span> : null}
        </span>
        <span className={`shrink-0 text-slate-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`} aria-hidden>
          ▼
        </span>
      </button>
      {open ? (
        <div id={panelId} role="region" aria-labelledby={triggerId} className={panelClassName}>
          {children}
        </div>
      ) : null}
    </section>
  );
}
