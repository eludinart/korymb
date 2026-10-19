"use client";

import Link from "next/link";
import type { ReactNode } from "react";

type Props = {
  title: string;
  count: number;
  href?: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
};

/** Bloc repliable : missions d'un même dossier projet. */
export default function MissionProjectGroup({ title, count, href, open, onToggle, children }: Props) {
  const countLabel = count > 1 ? `${count} missions` : `${count} mission`;
  return (
    <section className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-2 shadow-sm dark:border-emerald-800 dark:bg-emerald-950/25">
      <header className="flex items-center gap-2 px-1.5 py-1">
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? `Replier ${title}` : `Déplier ${title}`}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-white/70 dark:hover:bg-emerald-950/50"
        >
          <span className="w-3 shrink-0 text-xs font-bold text-emerald-800 dark:text-emerald-200" aria-hidden>
            {open ? "▾" : "▸"}
          </span>
          <span className="truncate text-sm font-bold text-slate-900 dark:text-slate-50">{title}</span>
          <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-900 ring-1 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-100 dark:ring-emerald-800">
            {countLabel}
          </span>
        </button>
        {href ? (
          <Link
            href={href}
            className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-emerald-800 hover:bg-white hover:underline dark:text-emerald-200 dark:hover:bg-emerald-950"
          >
            Fiche
          </Link>
        ) : null}
      </header>
      {open ? <div className="mt-1 space-y-2">{children}</div> : null}
    </section>
  );
}
