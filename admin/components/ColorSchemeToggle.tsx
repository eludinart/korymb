"use client";

import type { MouseEvent } from "react";
import { COLOR_SCHEME_LABELS } from "../lib/colorScheme";
import { useColorSchemeContext } from "./ColorSchemeProvider";

type Props = {
  /** Variante compacte (icône seule) pour header / chat. */
  compact?: boolean;
  className?: string;
};

/** Bascule Clair ↔ Nocturne.
 *  Icône = mode actuel : soleil = clair, lune = nocturne.
 */
export default function ColorSchemeToggle({ compact = false, className = "" }: Props) {
  const { scheme, isDark, toggleScheme } = useColorSchemeContext();
  const label = COLOR_SCHEME_LABELS[scheme];
  const nextLabel = isDark ? "Clair" : "Nocturne";

  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    toggleScheme();
  };

  if (compact) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100 active:bg-slate-200 dark:text-amber-200 dark:hover:bg-slate-800 ${className}`}
        aria-label={`Mode ${label}. Passer en ${nextLabel}.`}
        title={`Mode ${label} — cliquer pour ${nextLabel}`}
      >
        {isDark ? <MoonIcon /> : <SunIcon />}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative z-10 inline-flex items-center gap-2 rounded-full border-2 border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 shadow-sm transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 ${className}`}
      aria-pressed={isDark}
      aria-label={`Mode ${label}. Passer en ${nextLabel}.`}
    >
      {isDark ? <MoonIcon /> : <SunIcon />}
      <span>{isDark ? "Nocturne" : "Clair"}</span>
    </button>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5Z"
      />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path
        strokeLinecap="round"
        d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
      />
    </svg>
  );
}
