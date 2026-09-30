"use client";

import { useEffect, useRef, useState } from "react";
import ChatBottomSheet from "../chat/ChatBottomSheet";
import {
  loadThinkingMode,
  normalizeThinkingMode,
  saveThinkingMode,
  THINKING_MODES,
  thinkingModeLabel,
  type ThinkingModeId,
} from "../../lib/thinkingMode";

type Props = {
  value?: ThinkingModeId;
  onChange?: (mode: ThinkingModeId) => void;
  persist?: boolean;
  className?: string;
  /** Rangée de pastilles (desktop / écrans larges). */
  compact?: boolean;
  /** Bouton unique (style WhatsApp) — menu au clic. */
  icon?: boolean;
};

const MODE_LETTER: Record<ThinkingModeId, string> = {
  auto: "A",
  scientifique: "S",
  artiste: "Å",
  philosophe: "Φ",
  enfant: "?",
};

export default function ThinkingModePicker({
  value,
  onChange,
  persist = true,
  className = "",
  compact = false,
  icon = false,
}: Props) {
  const [mode, setMode] = useState<ThinkingModeId>(value || "auto");
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (value) {
      setMode(normalizeThinkingMode(value));
      return;
    }
    if (persist) setMode(loadThinkingMode());
  }, [value, persist]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      // Mobile : le sheet est en portal — ChatBottomSheet gère la fermeture.
      if (typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches) return;
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const choose = (next: ThinkingModeId) => {
    const m = normalizeThinkingMode(next);
    setMode(m);
    if (persist) saveThinkingMode(m);
    onChange?.(m);
    setMenuOpen(false);
  };

  if (icon) {
    const active = mode !== "auto";
    return (
      <div className={`relative shrink-0 ${className}`} ref={wrapRef}>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className={`flex h-9 w-9 items-center justify-center rounded-full text-[12px] font-extrabold transition ${
            active
              ? "bg-violet-100 text-violet-800 ring-1 ring-violet-300 dark:bg-violet-950 dark:text-violet-200 dark:ring-violet-600"
              : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          }`}
          aria-label={`Mode de pensée : ${thinkingModeLabel(mode)}. Changer.`}
          aria-expanded={menuOpen}
          title={thinkingModeLabel(mode)}
        >
          {MODE_LETTER[mode]}
        </button>

        {/* Desktop popover */}
        {menuOpen ? (
          <div className="absolute bottom-full left-0 z-40 mb-2 hidden w-48 overflow-hidden rounded-2xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900 lg:block">
            {THINKING_MODES.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => choose(opt.id)}
                className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold ${
                  mode === opt.id
                    ? "bg-violet-50 text-violet-900 dark:bg-violet-950 dark:text-violet-100"
                    : "text-slate-800 hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-[11px] font-extrabold dark:bg-slate-800">
                  {MODE_LETTER[opt.id]}
                </span>
                {opt.label}
              </button>
            ))}
          </div>
        ) : null}

        <ChatBottomSheet open={menuOpen} onClose={() => setMenuOpen(false)} title="Mode de pensée">
          <div className="space-y-1 pb-2 lg:hidden">
            {THINKING_MODES.map((opt) => {
              const selected = mode === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => choose(opt.id)}
                  className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3.5 text-left text-[15px] font-semibold ${
                    selected ? "bg-violet-50 text-violet-900" : "text-slate-800 active:bg-slate-100"
                  }`}
                  aria-pressed={selected}
                >
                  <span
                    className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-extrabold ${
                      selected ? "bg-violet-700 text-white" : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {MODE_LETTER[opt.id]}
                  </span>
                  {opt.label}
                </button>
              );
            })}
          </div>
        </ChatBottomSheet>
      </div>
    );
  }

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
