"use client";

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { practiceThemeVars, type PracticeIdentity } from "../../lib/practiceTheme";

export function PracticeTheme({
  identity,
  children,
  className = "",
}: {
  identity: PracticeIdentity;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`practice-root ${className}`.trim()} style={practiceThemeVars(identity) as CSSProperties}>
      {children}
    </div>
  );
}

/** Rappel du moteur — le chrome reste au nom de la pratique et du participant. */
export function PracticePoweredBy({ location }: { location?: string }) {
  return (
    <footer
      className="border-t py-8 text-center"
      style={{ borderColor: "color-mix(in srgb, var(--practice-accent, #047857) 22%, white)" }}
    >
      {location ? <p className="practice-kicker mb-3">{location}</p> : null}
      <Link
        href="/"
        className="text-sm font-bold text-slate-800 underline decoration-slate-400 underline-offset-[5px] hover:decoration-slate-800"
      >
        Propulsé par Korymb
      </Link>
    </footer>
  );
}
