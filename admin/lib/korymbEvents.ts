"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { requestJson } from "./api";
import { queryClient, QK } from "./queryClient";

/**
 * Flux SSE Korymb (/api/korymb-events) → cache React Query.
 *
 * - `runtime_sync` : métadonnées LLM / base (affichées par RuntimeHeader).
 * - `job_event`    : invalide les queries jobs (listes débouncées + détail ciblé)
 *                    pour que les écrans se mettent à jour sans polling agressif.
 * - L'état de connexion est exposé via `useSseConnected()` : les composants
 *   allongent leurs intervalles de polling quand le flux temps réel est actif.
 */

// ── État de connexion SSE (store minimal pour useSyncExternalStore) ──────────
let _sseConnected = false;
const _subscribers = new Set<() => void>();

function setSseConnected(value: boolean) {
  if (_sseConnected === value) return;
  _sseConnected = value;
  _subscribers.forEach((fn) => fn());
}

export function isSseConnected(): boolean {
  return _sseConnected;
}

export function useSseConnected(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      _subscribers.add(onChange);
      return () => _subscribers.delete(onChange);
    },
    () => _sseConnected,
    () => false,
  );
}

/**
 * Intervalle de polling adaptatif : `false` si onglet caché,
 * `sseMs` quand le flux SSE est connecté (les invalidations arrivent en push),
 * sinon `fastMs` (fallback polling pur).
 */
export function adaptivePollInterval(fastMs: number, sseMs?: number): number | false {
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return false;
  if (_sseConnected && sseMs) return sseMs;
  return fastMs;
}

// ── Hook flux runtime (porté par RuntimeHeader, une seule instance) ──────────
export type LlmMeta = { provider: string | null; model: string | null };
export type DbMeta = { engine: string | null; runtimeEnv: string | null };
export type RuntimeStreamState = {
  llm: LlmMeta;
  db: DbMeta;
  status: "ok" | "warning" | "error";
};

export function useKorymbEventStream(): RuntimeStreamState {
  const [llm, setLlm] = useState<LlmMeta>({ provider: null, model: null });
  const [db, setDb] = useState<DbMeta>({ engine: null, runtimeEnv: null });
  const [status, setStatus] = useState<"ok" | "warning" | "error">("warning");

  useEffect(() => {
    let es: EventSource | null = null;
    let retry: number | undefined;
    let jobInvalidateTimer: number | undefined;
    let closed = false;
    let retryMs = 1500;

    const pollFallback = async () => {
      try {
        const [{ data: llmData }, { data: healthData }] = await Promise.all([
          requestJson("/llm", { retries: 0, timeoutMs: 8_000 }),
          requestJson("/health", { retries: 0, timeoutMs: 8_000 }),
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
      es.onopen = () => setSseConnected(true);
      es.addEventListener("runtime_sync", (ev) => {
        setSseConnected(true);
        try {
          const payload = JSON.parse((ev as MessageEvent).data || "{}");
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
          const d = JSON.parse((ev as MessageEvent).data || "{}") as { type?: string; job_id?: string };
          if (d?.type === "director_notification") {
            window.dispatchEvent(new CustomEvent("korymb:director_notification", { detail: d }));
            return;
          }
          if (jobInvalidateTimer) window.clearTimeout(jobInvalidateTimer);
          jobInvalidateTimer = window.setTimeout(() => {
            void queryClient.invalidateQueries({ queryKey: QK.jobsCards });
            void queryClient.invalidateQueries({ queryKey: QK.jobsLight });
            void queryClient.invalidateQueries({ queryKey: QK.jobsActive });
            void queryClient.invalidateQueries({ queryKey: QK.deliverablesLibrary });
          }, 4000);
          const jid = d?.job_id != null ? String(d.job_id) : "";
          if (jid) {
            void queryClient.invalidateQueries({ queryKey: ["job-detail-live", jid] });
            void queryClient.invalidateQueries({ queryKey: ["job-detail-historique-live", jid] });
            void queryClient.invalidateQueries({ queryKey: ["mission-cio-resume-live", jid] });
            void queryClient.invalidateQueries({ queryKey: ["chat-live", jid] });
          }
        } catch {
          /* ignore */
        }
      });
      es.addEventListener("runtime_error", () => setStatus("error"));
      es.onerror = () => {
        if (es) es.close();
        setSseConnected(false);
        setStatus("warning");
        retry = window.setTimeout(open, retryMs);
        retryMs = Math.min(10000, retryMs + 1000);
      };
    };

    open();
    const id = window.setInterval(pollFallback, 45_000);
    void pollFallback();
    return () => {
      closed = true;
      setSseConnected(false);
      if (retry) window.clearTimeout(retry);
      if (es) es.close();
      window.clearInterval(id);
      if (jobInvalidateTimer) window.clearTimeout(jobInvalidateTimer);
    };
  }, []);

  return { llm, db, status };
}
