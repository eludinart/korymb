"use client";

import { useKorymbEventStream } from "../lib/korymbEvents";

function statusUi(status: "ok" | "warning" | "error") {
  if (status === "ok") return { dot: "bg-emerald-500", text: "Actif", textClass: "text-emerald-800 font-bold" };
  if (status === "error") return { dot: "bg-red-500", text: "Hors ligne", textClass: "text-red-800 font-bold" };
  return { dot: "bg-amber-500", text: "Sync…", textClass: "text-amber-800 font-bold" };
}

function shortModel(model: string | null): string {
  if (!model) return "—";
  return model.split("/").pop() || model;
}

export default function RuntimeHeader({ showInfrastructure = true }: { showInfrastructure?: boolean }) {
  const { llm, db, status } = useKorymbEventStream();

  const ui = statusUi(status);
  const providerLabel = llm.provider ? llm.provider.toUpperCase() : "—";
  const modelLabel = shortModel(llm.model);
  const modelFull = llm.model || "Synchronisation du modèle…";
  const dbEnv = String(db.runtimeEnv || "").toLowerCase().includes("prod") ? "PROD" : "DEV";
  const dbEngine = db.engine ? db.engine.toUpperCase() : "DB ?";
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-700">
      {showInfrastructure ? (
        <>
          <span className="hidden font-bold text-slate-500 md:inline">Flux</span>
          <span className={`inline-flex items-center gap-1 ${ui.textClass}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${ui.dot}`} />
            {ui.text}
          </span>
          <span className="hidden text-slate-300 sm:inline">•</span>
          <span className="hidden items-center gap-1 sm:inline-flex">
            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-700">{dbEngine}</span>
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                dbEnv === "PROD" ? "bg-violet-100 text-violet-700" : "bg-emerald-100 text-emerald-700"
              }`}
            >
              {dbEnv}
            </span>
          </span>
          <span className="hidden text-slate-300 md:inline">•</span>
        </>
      ) : null}
      <span className="inline-flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <span className="inline-flex items-center gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Fournisseur</span>
          <span className="rounded bg-violet-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-violet-800">
            {providerLabel}
          </span>
        </span>
        <span className="inline-flex min-w-0 items-center gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Modèle</span>
          <span
            className="max-w-[9rem] truncate rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-700 sm:max-w-[14rem]"
            title={modelFull}
          >
            {modelLabel}
          </span>
        </span>
      </span>
    </div>
  );
}
