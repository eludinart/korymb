"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ActionToastKind = "ok" | "error";

type ToastItem = {
  id: number;
  msg: string;
  kind: ActionToastKind;
};

type ActionToastApi = {
  pushToast: (msg: string, kind?: ActionToastKind) => void;
};

const ActionToastContext = createContext<ActionToastApi | null>(null);

const TOAST_TTL_MS = 3_500;

/** Toast global pour confirmations d’actions (mission, template, QCM…). */
export function ActionToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const pushToast = useCallback((msg: string, kind: ActionToastKind = "ok") => {
    const text = String(msg || "").trim();
    if (!text) return;
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setItems((prev) => [...prev.slice(-4), { id, msg: text, kind }]);
    window.setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, TOAST_TTL_MS);
  }, []);

  const api = useMemo(() => ({ pushToast }), [pushToast]);

  return (
    <ActionToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed bottom-[max(1rem,var(--safe-bottom))] right-4 z-[80] flex max-w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
        aria-live="polite"
        aria-relevant="additions"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto min-h-[44px] rounded-xl px-5 py-3 text-sm font-medium text-white shadow-lg ${
              t.kind === "ok" ? "bg-emerald-600" : "bg-red-600"
            }`}
          >
            {t.msg}
          </div>
        ))}
      </div>
    </ActionToastContext.Provider>
  );
}

export function useActionToast(): ActionToastApi {
  const ctx = useContext(ActionToastContext);
  if (!ctx) {
    return {
      pushToast: () => {
        /* hors provider (tests / pages isolées) */
      },
    };
  }
  return ctx;
}
