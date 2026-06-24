import { agentHeaders, formatHttpApiErrorPayload, requestJson } from "./api";

/** Supprime un job mission (cascade DB + état mémoire). */
export async function deleteMissionJob(jobId: string): Promise<void> {
  const { res, data } = await requestJson(`/jobs/${encodeURIComponent(jobId)}`, {
    method: "DELETE",
    headers: agentHeaders(),
    retries: 1,
    timeoutMs: 60_000,
    expectOk: false,
  });
  if (!res.ok) {
    const fallback = await requestJson(`/jobs/${encodeURIComponent(jobId)}/remove`, {
      method: "POST",
      headers: agentHeaders(),
      retries: 0,
      timeoutMs: 60_000,
      expectOk: false,
    });
    if (!fallback.res.ok) {
      throw new Error(
        formatHttpApiErrorPayload(data) ||
          formatHttpApiErrorPayload(fallback.data) ||
          `Suppression impossible (HTTP ${res.status})`,
      );
    }
  }
}
