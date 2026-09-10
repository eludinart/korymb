"use client";

import { useKorymbEventStream } from "../lib/korymbEvents";

function statusUi(status: "ok" | "warning" | "error") {
  if (status === "ok") return { dot: "bg-emerald-500", text: "Actif", textClass: "text-emerald-800" };
  if (status === "error") return { dot: "bg-red-500", text: "Hors ligne", textClass: "text-red-800" };
  return { dot: "bg-amber-500", text: "Sync…", textClass: "text-amber-800" };
}

function shortModel(model: string | null): string {
  if (!model) return "";
  return model.split("/").pop() || model;
}

/** Mini-diagnostic LLM / DB / SSE. Le hook reste monté même si le bandeau est masqué. */
export default function RuntimeHeader({ visible = true }: { visible?: boolean }) {
  const { llm, db, status } = useKorymbEventStream();
  if (!visible) return null;

  const ui = statusUi(status);
  const providerLabel = llm.provider ? llm.provider.toUpperCase() : "";
  const modelLabel = shortModel(llm.model);
  const modelFull = llm.model || "";
  const dbEnv = String(db.runtimeEnv || "").toLowerCase().includes("prod") ? "PROD" : "DEV";
  const dbEngine = db.engine ? db.engine.toUpperCase() : "";

  return (
    <p
      className="mt-0.5 flex max-w-[18rem] items-center gap-1.5 overflow-hidden whitespace-nowrap text-[11px] font-semibold text-slate-600"
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
          <span className="shrink-0 text-slate-300" aria-hidden>
            ·
          </span>
          <span className="shrink-0 font-mono text-[10px] text-slate-700">
            {dbEngine} {dbEnv}
          </span>
        </>
      ) : null}
      {providerLabel ? (
        <>
          <span className="shrink-0 text-slate-300" aria-hidden>
            ·
          </span>
          <span className="min-w-0 truncate font-mono text-[10px] text-violet-800">
            {providerLabel}
            {modelLabel ? ` / ${modelLabel}` : ""}
          </span>
        </>
      ) : null}
    </p>
  );
}
