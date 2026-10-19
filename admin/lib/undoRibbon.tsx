"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

type UndoEntry = {
  id: number;
  message: string;
  undo: () => void;
  commit?: () => void;
  timer: number;
};

type UndoApi = {
  /** Barre 6 s. `commit` part si on n'annule pas (suppression différée). */
  pushUndo: (message: string, undo?: () => void, commit?: () => void) => void;
};

const UndoContext = createContext<UndoApi | null>(null);

const UNDO_TTL_MS = 6_000;

export function UndoRibbonProvider({ children }: { children: ReactNode }) {
  const currentRef = useRef<UndoEntry | null>(null);
  const [visible, setVisible] = useState<UndoEntry | null>(null);

  const clearTimer = (entry: UndoEntry | null) => {
    if (entry) window.clearTimeout(entry.timer);
  };

  const pushUndo = useCallback((message: string, undo?: () => void, commit?: () => void) => {
    const text = String(message || "").trim();
    if (!text) return;
    const previous = currentRef.current;
    if (previous) {
      clearTimer(previous);
      previous.commit?.();
    }
    const id = Date.now() + Math.floor(Math.random() * 1000);
    const entry: UndoEntry = {
      id,
      message: text,
      undo: undo || (() => undefined),
      commit,
      timer: 0,
    };
    entry.timer = window.setTimeout(() => {
      if (currentRef.current?.id !== id) return;
      currentRef.current = null;
      setVisible(null);
      commit?.();
    }, UNDO_TTL_MS);
    currentRef.current = entry;
    setVisible(entry);
  }, []);

  const onUndo = () => {
    const entry = currentRef.current;
    if (!entry) return;
    clearTimer(entry);
    currentRef.current = null;
    setVisible(null);
    entry.undo();
  };

  return (
    <UndoContext.Provider value={{ pushUndo }}>
      {children}
      {visible ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-[max(1rem,var(--safe-bottom))] z-[90] flex justify-center px-4">
          <div
            role="status"
            className="pointer-events-auto flex max-w-[min(32rem,calc(100vw-2rem))] items-center gap-3 rounded-full bg-slate-900 px-4 py-2.5 text-sm text-white shadow-lg"
          >
            <span className="min-w-0 truncate font-medium">{visible.message}</span>
            <button
              type="button"
              onClick={onUndo}
              className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-900"
            >
              Annuler
            </button>
          </div>
        </div>
      ) : null}
    </UndoContext.Provider>
  );
}

export function useUndoRibbon(): UndoApi {
  const ctx = useContext(UndoContext);
  if (!ctx) {
    return { pushUndo: () => undefined };
  }
  return ctx;
}
