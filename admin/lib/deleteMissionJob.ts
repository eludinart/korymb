import { agentHeaders, formatHttpApiErrorPayload, requestJson } from "./api";

export type DeleteMissionJobResult = {
  deleted?: string;
  deleted_ids?: string[];
  count?: number;
};

async function deleteMissionJobOnce(jobId: string, method: "DELETE" | "POST", path: string) {
  return requestJson(path, {
    method,
    headers: agentHeaders(),
    retries: method === "DELETE" ? 1 : 0,
    timeoutMs: 120_000,
    expectOk: false,
  });
}

export function deletedCountFrom(result: DeleteMissionJobResult): number {
  if (typeof result.count === "number" && result.count > 0) return result.count;
  if (Array.isArray(result.deleted_ids) && result.deleted_ids.length > 0) return result.deleted_ids.length;
  if (result.deleted) return 1;
  return 0;
}

/** Supprime un job mission et tout son cluster (cascade DB + état mémoire). */
export async function deleteMissionJob(jobId: string): Promise<DeleteMissionJobResult> {
  const enc = encodeURIComponent(jobId);
  const { res, data } = await deleteMissionJobOnce(jobId, "DELETE", `/jobs/${enc}`);
  if (res.ok) return data as DeleteMissionJobResult;

  const fallback = await deleteMissionJobOnce(jobId, "POST", `/jobs/${enc}/remove`);
  if (fallback.res.ok) return fallback.data as DeleteMissionJobResult;

  const detail =
    formatHttpApiErrorPayload(data) ||
    formatHttpApiErrorPayload(fallback.data) ||
    (res.status === 404 || fallback.res.status === 404
      ? "Job introuvable."
      : `Suppression impossible (HTTP ${res.status}).`);

  throw new Error(detail);
}
