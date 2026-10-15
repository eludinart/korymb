"use client";

import { useEffect, useRef, useState } from "react";
import LlmHopList, { shortModel } from "./LlmHopList";
import { useKorymbEventStream } from "../lib/korymbEvents";

function statusUi(status: "ok" | "warning" | "error") {
  if (status === "ok") return { dot: "bg-emerald-500", text: "Actif", textClass: "text-emerald-800 dark:text-emerald-300" };
  if (status === "error") return { dot: "bg-red-500", text: "Hors ligne", textClass: "text-red-800 dark:text-red-300" };
  return { dot: "bg-amber-500", text: "Sync…", textClass: "text-amber-800 dark:text-amber-300" };
}

/** Mini-diagnostic LLM / DB / SSE. Le hook reste monté même si le bandeau est masqué. */
export default function RuntimeHeader({ visible = true }: { visible?: boolean }) {
  const { llm, db, status } = useKorymbEventStream();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!visible) return null;

  const ui = statusUi(status);
  const providerLabel = llm.provider ? llm.provider.toUpperCase() : "";
  const modelLabel = shortModel(llm.model);
  const modelFull = llm.model || "";
  const dbEnv = String(db.runtimeEnv || "").toLowerCase().includes("prod") ? "PROD" : "DEV";
  const dbEngine = db.engine ? db.engine.toUpperCase() : "";

  return (
    <div ref={boxRef} className="relative mt-0.5 max-w-[22rem]">
      <p
        className="flex items-center gap-1.5 overflow-hidden whitespace-nowrap text-[11px] font-semibold text-slate-600 dark:text-slate-300"
        title={[ui.text, dbEngine && dbEnv ? `${dbEngine} ${dbEnv}` : "", providerLabel, modelFull]
          .filter(Boolean)
          .join(" · ")}
      >
        <span className={`inline-flex shrink-0 items-center gap-1 ${ui.textClass}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${ui.dot}`} />
          {ui.text}
        </span>
        {dbEngine ? (
          <>
            <span className="shrink-0 text-slate-300 dark:text-slate-600" aria-hidden>
              ·
            </span>
            <span className="shrink-0 font-mono text-[10px] text-slate-700 dark:text-slate-200">
              {dbEngine} {dbEnv}
            </span>
          </>
        ) : null}
        {providerLabel ? (
          <>
            <span className="shrink-0 text-slate-300 dark:text-slate-600" aria-hidden>
              ·
            </span>
            <button
              type="button"
              aria-expanded={open}
              aria-haspopup="listbox"
              onClick={() => setOpen((value) => !value)}
              className="min-w-0 truncate font-mono text-[10px] text-violet-800 underline-offset-2 hover:underline dark:text-violet-200"
            >
              {providerLabel}
              {modelLabel ? ` / ${modelLabel}` : ""}
            </button>
          </>
        ) : null}
      </p>
      {open ? (
        <div className="absolute left-0 top-full z-50 mt-1 w-[min(24rem,calc(100vw-1.5rem))] rounded-xl border border-slate-200 bg-white p-2 text-left shadow-xl dark:border-violet-900 dark:bg-slate-950">
          <LlmHopList onChosen={() => setOpen(false)} />
        </div>
      ) : null}
    </div>
  );
}
