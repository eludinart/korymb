"use client";

import { Fragment, useEffect, useMemo, useRef } from "react";
import { buildLiveMissionFlow } from "../lib/liveMissionFlow";

type Props = {
  events: unknown;
  /** Clé agent → libellé (ex. issue de GET /agents). */
  agentLabelMap?: Record<string, string>;
  className?: string;
};

const kindClass: Record<string, string> = {
  cio: "border-violet-200 bg-violet-50/90 text-violet-950",
  agent: "border-slate-200 bg-white text-slate-900",
  system: "border-slate-300 bg-slate-100 text-slate-800",
};

export default function LiveAgentInteractionStrip({ events, agentLabelMap, className = "" }: Props) {
  const steps = useMemo(() => buildLiveMissionFlow(events, agentLabelMap), [events, agentLabelMap]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ left: el.scrollWidth, behavior: "smooth" });
  }, [steps.length]);

  if (steps.length === 0) {
    return (
      <div
        className={`rounded-lg border border-dashed border-slate-200 bg-slate-50/80 px-3 py-2 text-center text-[11px] text-slate-500 ${className}`}
      >
        En attente des premiers événements d&apos;orchestration…
      </div>
    );
  }

  return (
    <div className={`rounded-xl border border-slate-200 bg-slate-50/90 shadow-sm ${className}`}>
      <p className="border-b border-slate-200/80 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        Déroulé des agents (temps réel)
      </p>
      <div
        ref={scrollRef}
        className="flex max-h-[4.75rem] min-h-[2.75rem] items-stretch gap-0.5 overflow-x-auto overflow-y-hidden px-2 py-1.5"
      >
        {steps.map((s, i) => {
          const isLast = i === steps.length - 1;
          return (
            <Fragment key={s.id}>
              {i > 0 ? (
                <span className="flex shrink-0 items-center px-0.5 text-xs font-medium text-slate-300" aria-hidden>
                  →
                </span>
              ) : null}
              <div
                className={`flex min-w-[5.5rem] max-w-[9.5rem] shrink-0 flex-col justify-center rounded-lg border px-1.5 py-1 text-left transition-shadow ${
                  kindClass[s.kind] || kindClass.agent
                } ${isLast ? "ring-2 ring-violet-400/70 ring-offset-1 ring-offset-slate-50" : ""}`}
                title={`${s.label} — ${s.detail}`}
              >
                <span className="truncate text-[10px] font-bold leading-tight">{s.label}</span>
                {s.detail ? (
                  <span className="mt-0.5 line-clamp-2 text-[9px] font-medium leading-snug text-slate-600">{s.detail}</span>
                ) : null}
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
