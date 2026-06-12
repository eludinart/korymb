"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { agentHeaders, requestJson } from "./api";
import { isSseConnected } from "./korymbEvents";

/** Détail complet d'un job (logs + events depuis l'offset 0). */
export async function fetchJobDetail(jobId: string) {
  const { data } = await requestJson(
    `/jobs/${encodeURIComponent(jobId)}?log_offset=0&events_offset=0`,
    { headers: agentHeaders(), retries: 2, timeoutMs: 60_000 },
  );
  return data;
}

type UseJobDetailOptions = {
  queryKey: readonly unknown[];
  /** Intervalle (ms) si le job est actif ; défaut 3000. */
  activeIntervalMs?: number;
  /** Intervalle (ms) si le job est terminé ; défaut 15000 (false pour stopper). */
  idleIntervalMs?: number | false;
  /** Force un intervalle court (suivi live d'une continuation). */
  forceFastPoll?: boolean;
};

/** Query partagée de détail job avec polling adaptatif selon le statut. */
export function useJobDetail(jobId: string | null, options: UseJobDetailOptions) {
  const { queryKey, activeIntervalMs = 3000, idleIntervalMs = 15_000, forceFastPoll = false } = options;
  return useQuery({
    queryKey,
    enabled: Boolean(jobId),
    queryFn: () => fetchJobDetail(String(jobId)),
    placeholderData: keepPreviousData,
    retry: 2,
    retryDelay: (attempt) => Math.min(1500 * 2 ** attempt, 8000),
    refetchInterval: (query) => {
      if (!jobId || typeof document === "undefined" || document.visibilityState !== "visible") return false;
      if (query.state.fetchStatus === "fetching") return false;
      // SSE connecté : les job_events invalident déjà la query — le polling devient un filet.
      const sseFactor = isSseConnected() ? 3 : 1;
      if (forceFastPoll) return 2000 * sseFactor;
      const st = String((query.state.data as { status?: string } | undefined)?.status || "");
      if (st === "running" || st === "pending" || st === "awaiting_validation") return activeIntervalMs * sseFactor;
      return idleIntervalMs === false ? false : idleIntervalMs * sseFactor;
    },
  });
}
