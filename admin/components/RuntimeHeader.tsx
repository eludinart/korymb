"use client";

import { useEffect, useState } from "react";
import { requestJson } from "../lib/api";
import { queryClient, QK } from "../lib/queryClient";

type LlmMeta = { provider: string | null; model: string | null };
type DbMeta = { engine: string | null; runtimeEnv: string | null };

function statusUi(status: "ok" | "warning" | "error") {
  if (status === "ok") return { dot: "bg-emerald-500", text: "Actif", textClass: "text-emerald-700" };
  if (status === "error") return { dot: "bg-red-500", text: "Hors ligne", textClass: "text-red-700" };
  return { dot: "bg-amber-500", text: "Synchronisation", textClass: "text-amber-700" };
}

export default function RuntimeHeader() {
  const [llm, setLlm] = useState<LlmMeta>({ provider: null, model: null });
  const [db, setDb] = useState<DbMeta>({ engine: null, runtimeEnv: null });
  const [status, setStatus] = useState<"ok" | "warning" | "error">("warning");

  useEffect(() => {
    let es: EventSource | null = null;
    let retry: number | undefined;
    let closed = false;
    let retryMs = 1500;

    const pollFallback = async () => {
      try {
        const [{ data: llmData }, { data: healthData }] = await Promise.all([
          requestJson("/llm", { retries: 1 }),
          requestJson("/health", { retries: 1 }),
        ]);
        setLlm({
          provider: llmData?.provider != null ? String(llmData.provider) : null,
          model: llmData?.model != null ? String(llmData.model) : null,
        });
        setDb({
          engine: healthData?.database?.engine != null ? String(healthData.database.engine) : null,
          runtimeEnv: healthData?.database?.runtime_env != null ? String(healthData.database.runtime_env) : null,
        });
        setStatus("ok");
      } catch {
        setStatus("warning");
      }
    };

    const open = () => {
      if (closed) return;
      try {
        es = new EventSource("/api/korymb-events");
      } catch {
        retry = window.setTimeout(open, retryMs);
        retryMs = Math.min(10000, retryMs + 1000);
        return;
      }
      es.addEventListener("runtime_sync", (ev) => {
        try {
          const payload = JSON.parse(ev.data || "{}");
          const provider = payload?.llm?.provider != null ? String(payload.llm.provider) : null;
          const model = payload?.llm?.model != null ? String(payload.llm.model) : null;
          const dbEngine = payload?.database?.engine != null ? String(payload.database.engine) : null;
          const dbRuntimeEnv = payload?.database?.runtime_env != null ? String(payload.database.runtime_env) : null;
          setLlm({ provider, model });
          setDb({ engine: dbEngine, runtimeEnv: dbRuntimeEnv });
          setStatus(provider && model ? "ok" : "warning");
          retryMs = 1500;
        } catch {
          setStatus("warning");
        }
      });
      es.addEventListener("job_event", (ev) => {
        try {
          const d = JSON.parse(ev.data || "{}") as { job_id?: string };
          void queryClient.invalidateQueries({ queryKey: QK.jobs });
          const jid = d?.job_id != null ? String(d.job_id) : "";
          if (jid) {
            void queryClient.invalidateQueries({ queryKey: ["job-detail-live", jid] });
            void queryClient.invalidateQueries({ queryKey: ["job-detail-historique-live", jid] });
          }
        } catch {
          /* ignore */
        }
      });
      es.addEventListener("runtime_error", () => setStatus("error"));
      es.onerror = () => {
        if (es) es.close();
        setStatus("warning");
        retry = window.setTimeout(open, retryMs);
        retryMs = Math.min(10000, retryMs + 1000);
      };
    };

    open();
    const id = window.setInterval(pollFallback, 20000);
    void pollFallback();
    return () => {
      closed = true;
      if (retry) window.clearTimeout(retry);
      if (es) es.close();
      window.clearInterval(id);
    };
  }, []);

  const ui = statusUi(status);
  const modelHint =
    llm.provider && llm.model ? `${llm.provider} · ${llm.model}` : "Synchronisation du modèle…";
  const dbEnv = String(db.runtimeEnv || "").toLowerCase().includes("prod") ? "PROD" : "DEV";
  const dbEngine = db.engine ? db.engine.toUpperCase() : "DB ?";
  return (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600"
      title={modelHint}
    >
      <span className="text-slate-400">Flux métier</span>
      <span className={`inline-flex items-center gap-1 ${ui.textClass}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${ui.dot}`} />
        {ui.text}
      </span>
      <span className="text-slate-300">•</span>
      <span className="inline-flex items-center gap-1">
        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-700">{dbEngine}</span>
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            dbEnv === "PROD" ? "bg-violet-100 text-violet-700" : "bg-emerald-100 text-emerald-700"
          }`}
        >
          {dbEnv}
        </span>
      </span>
    </div>
  );
}
