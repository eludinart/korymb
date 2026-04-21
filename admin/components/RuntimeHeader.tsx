"use client";

import { useEffect, useState } from "react";
import { requestJson } from "../lib/api";

type LlmMeta = { provider: string | null; model: string | null };

function statusUi(status: "ok" | "warning" | "error") {
  if (status === "ok") return { dot: "bg-emerald-500", text: "Actif", textClass: "text-emerald-700" };
  if (status === "error") return { dot: "bg-red-500", text: "Hors ligne", textClass: "text-red-700" };
  return { dot: "bg-amber-500", text: "Synchronisation", textClass: "text-amber-700" };
}

export default function RuntimeHeader() {
  const [llm, setLlm] = useState<LlmMeta>({ provider: null, model: null });
  const [status, setStatus] = useState<"ok" | "warning" | "error">("warning");

  useEffect(() => {
    let es: EventSource | null = null;
    let retry: number | undefined;
    let closed = false;
    let retryMs = 1500;

    const pollFallback = async () => {
      try {
        const { data } = await requestJson("/llm", { retries: 1 });
        setLlm({
          provider: data?.provider != null ? String(data.provider) : null,
          model: data?.model != null ? String(data.model) : null,
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
          setLlm({ provider, model });
          setStatus(provider && model ? "ok" : "warning");
          retryMs = 1500;
        } catch {
          setStatus("warning");
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
    </div>
  );
}
