import { agentHeaders, requestJson } from "./api";
import type { ActiveAgentJob } from "./activeAgentWork";

export type JobControlAction = "pause" | "resume" | "cancel";

const STOPPABLE = new Set(["running", "pending", "awaiting_validation", "paused"]);

export function canPauseJob(job: ActiveAgentJob): boolean {
  return job.execution_live !== false && job.status === "running" && !job.pause_requested;
}

export function canResumeJob(job: ActiveAgentJob): boolean {
  return job.execution_live !== false && (job.status === "paused" || Boolean(job.pause_requested));
}

export function canRelaunchOrphan(job: ActiveAgentJob): boolean {
  return job.execution_live === false && (job.status === "paused" || job.status === "running");
}

export function canStopJob(job: ActiveAgentJob): boolean {
  return STOPPABLE.has(String(job.status || ""));
}

export async function pauseActiveJob(jobId: string) {
  const { data } = await requestJson<{ ok?: boolean; message?: string }>(
    `/jobs/${encodeURIComponent(jobId)}/pause`,
    { method: "POST", headers: agentHeaders(), retries: 0, timeoutMs: 15_000 },
  );
  return data;
}

export async function resumeActiveJob(jobId: string) {
  const { data } = await requestJson<{ ok?: boolean; message?: string }>(
    `/jobs/${encodeURIComponent(jobId)}/resume-work`,
    { method: "POST", headers: agentHeaders(), retries: 0, timeoutMs: 15_000 },
  );
  return data;
}

export async function cancelActiveJob(jobId: string) {
  const { data } = await requestJson<{ ok?: boolean; message?: string; forced?: boolean }>(
    `/jobs/${encodeURIComponent(jobId)}/cancel`,
    { method: "POST", headers: agentHeaders(), retries: 0, timeoutMs: 15_000 },
  );
  return data;
}

/** Relance une mission arrêtée (clone de la consigne + config). */
export async function restartStoppedJob(jobId: string) {
  const { data } = await requestJson<{ ok?: boolean; job_id?: string; source_job_id?: string }>(
    `/jobs/${encodeURIComponent(jobId)}/clone`,
    { method: "POST", headers: agentHeaders(), retries: 0, timeoutMs: 20_000 },
  );
  return data;
}

/** Supprime définitivement un job arrêté (base + état mémoire). */
export async function deleteJob(jobId: string) {
  const { data } = await requestJson<{ deleted?: string }>(
    `/jobs/${encodeURIComponent(jobId)}`,
    { method: "DELETE", headers: agentHeaders(), retries: 0, timeoutMs: 20_000 },
  );
  return data;
}

export async function cleanupOrphanJobs() {
  const { data } = await requestJson<{ ok?: boolean; count?: number; cleaned?: string[] }>(
    "/jobs/cleanup-orphans",
    { method: "POST", headers: agentHeaders(), retries: 0, timeoutMs: 30_000 },
  );
  return data;
}

export function jobControlErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Action impossible pour ce processus.";
}
