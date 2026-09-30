"use client";

import { useEffect, useState } from "react";
import {
  loadThinkingMode,
  normalizeThinkingMode,
  saveThinkingMode,
  THINKING_MODES,
  type ThinkingModeId,
} from "../../lib/thinkingMode";

type Props = {
  value?: ThinkingModeId;
  onChange?: (mode: ThinkingModeId) => void;
  /** Si true, lit/écrit localStorage automatiquement. */
  persist?: boolean;
  className?: string;
  compact?: boolean;
};

export default function ThinkingModePicker({
  value,
  onChange,
  persist = true,
  className = "",
  compact = false,
}: Props) {
  const [mode, setMode] = useState<ThinkingModeId>(value || "auto");

  useEffect(() => {
    if (value) {
      setMode(normalizeThinkingMode(value));
      return;
    }
    if (persist) setMode(loadThinkingMode());
  }, [value, persist]);

  const choose = (next: ThinkingModeId) => {
    const m = normalizeThinkingMode(next);
    setMode(m);
    if (persist) saveThinkingMode(m);
    onChange?.(m);
  };

  return (
    <div className={className}>
      {!compact ? (
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">Mode de pensée</p>
      ) : null}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Mode de pensée">
        {THINKING_MODES.map((opt) => {
          const active = mode === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => choose(opt.id)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition ${
                active
                  ? "bg-violet-700 text-white shadow-sm"
                  : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
              }`}
              aria-pressed={active}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
