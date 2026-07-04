"use client";

import { useMemo } from "react";
import { buildLiveMissionFlow } from "../../lib/liveMissionFlow";

type Props = {
  events: unknown;
  agentLabelMap?: Record<string, string>;
  tokensTotal?: number;
  costUsd?: number;
  className?: string;
};

export default function MissionAgentTracePanel({
  events,
  agentLabelMap,
  tokensTotal,
  costUsd,
  className = "",
}: Props) {
  const steps = useMemo(() => buildLiveMissionFlow(events, agentLabelMap), [events, agentLabelMap]);

  const toolHints = useMemo(() => {
    const hints: string[] = [];
    const list = Array.isArray(events) ? events : [];
    for (const ev of list) {
      if (!ev || typeof ev !== "object") continue;
      const t = String((ev as { type?: string }).type || "");
      const p = ((ev as { payload?: unknown }).payload || {}) as Record<string, unknown>;
      if (t === "tool_call" || t === "tool_use") {
        const name = String(p.tool || p.name || "").trim();
        if (name) hints.push(name);
      }
    }
    return [...new Set(hints)].slice(0, 8);
  }, [events]);

  if (steps.length === 0 && !toolHints.length) {
    return null;
  }

  return (
    <aside
      className={`rounded-2xl border border-slate-200 bg-slate-50/90 p-4 shadow-sm ${className}`}
      aria-label="Trace agent"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
        <p className="text-xs font-extrabold uppercase tracking-widest text-slate-500">Trace agent</p>
        {(tokensTotal != null || costUsd != null) && (
          <p className="text-[11px] font-semibold text-slate-500">
            {tokensTotal != null ? `${tokensTotal.toLocaleString("fr-FR")} tokens` : ""}
            {costUsd != null ? ` · $${Number(costUsd).toFixed(3)}` : ""}
          </p>
        )}
      </div>
      <ol className="mt-3 space-y-2">
        {steps.map((s, i) => (
          <li key={s.id} className="flex gap-2 text-sm">
            <span
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                s.kind === "cio"
                  ? "bg-violet-200 text-violet-900"
                  : s.kind === "agent"
                    ? "bg-sky-100 text-sky-900"
                    : "bg-slate-200 text-slate-700"
              }`}
            >
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="font-bold text-slate-900">{s.label}</p>
              <p className="text-xs text-slate-600">{s.detail}</p>
            </div>
          </li>
        ))}
      </ol>
      {toolHints.length > 0 ? (
        <p className="mt-3 text-xs text-slate-500">
          <span className="font-bold">Outils :</span> {toolHints.join(", ")}
        </p>
      ) : null}
    </aside>
  );
}
