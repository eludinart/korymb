"use client";

import { useEffect, useState } from "react";

type Variant = "inline" | "panel";

type Props = {
  active: boolean;
  /** Ce qui est en train de se faire, pas un vague « chargement ». */
  label: string;
  /** Affiché après ~8 s : explique que l’attente est normale. */
  hint?: string;
  variant?: Variant;
  className?: string;
};

function useElapsedSeconds(active: boolean) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) {
      setElapsed(0);
      return;
    }
    const started = Date.now();
    setElapsed(0);
    const id = window.setInterval(() => {
      setElapsed(Math.max(0, Math.floor((Date.now() - started) / 1000)));
    }, 400);
    return () => window.clearInterval(id);
  }, [active]);
  return elapsed;
}

function IndeterminateBar({ className = "" }: { className?: string }) {
  return (
    <div className={`relative h-1 overflow-hidden rounded-full bg-violet-100 ${className}`} aria-hidden>
      <span className="busy-indeterminate absolute inset-y-0 w-1/3 rounded-full bg-violet-600" />
    </div>
  );
}

export function BusySkeleton({ lines = 7, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-2.5 ${className}`} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          className="h-3 animate-pulse rounded-md bg-slate-200/90"
          style={{ width: `${92 - (i % 5) * 9}%` }}
        />
      ))}
    </div>
  );
}

/** Attente lisible : action en cours, temps écoulé, puis consigne si ça dure. */
export function BusyNotice({ active, label, hint, variant = "inline", className = "" }: Props) {
  const elapsed = useElapsedSeconds(active);
  if (!active) return null;

  const longWait = elapsed >= 8;
  const showTimer = elapsed >= 2;
  const status = longWait
    ? hint || "Toujours au travail — quelques secondes de plus, rien n’est bloqué."
    : showTimer
      ? `${label} · ${elapsed} s`
      : label;

  const body = (
    <div
      className="flex min-w-0 items-start gap-2.5"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="mt-1.5 h-2 w-2 shrink-0 animate-pulse rounded-full bg-violet-600" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-violet-950">{status}</p>
        {longWait && hint ? (
          <p className="mt-0.5 text-xs font-medium text-violet-800/80">{label}</p>
        ) : null}
        <IndeterminateBar className="mt-2" />
      </div>
    </div>
  );

  if (variant === "panel") {
    return (
      <div className={`rounded-2xl border border-violet-200 bg-violet-50/70 p-4 shadow-sm ${className}`}>
        {body}
        <BusySkeleton className="mt-4" />
      </div>
    );
  }

  return <div className={className}>{body}</div>;
}

export function LoadingLine({
  label = "Lecture en cours…",
  hint,
}: {
  label?: string;
  hint?: string;
}) {
  return <BusyNotice active label={label} hint={hint} variant="inline" />;
}
