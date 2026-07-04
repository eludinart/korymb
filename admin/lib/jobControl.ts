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
  const { data } = await requestJson(
    `/jobs/${encodeURIComponent(jobId)}/pause`,
    { method: "POST", headers: agentHeaders(), retries: 0, timeoutMs: 15_000 },
  );
  return data as { ok?: boolean; message?: string };
}

export async function resumeActiveJob(jobId: string) {
  const { data } = await requestJson(
    `/jobs/${encodeURIComponent(jobId)}/resume-work`,
    { method: "POST", headers: agentHeaders(), retries: 0, timeoutMs: 15_000 },
  );
  return data as { ok?: boolean; message?: string };
}

export async function cancelActiveJob(jobId: string) {
  const { data } = await requestJson(
    `/jobs/${encodeURIComponent(jobId)}/cancel`,
    { method: "POST", headers: agentHeaders(), retries: 0, timeoutMs: 15_000 },
  );
  return data as { ok?: boolean; message?: string; forced?: boolean };
}

/** Relance une mission arrêtée (clone de la consigne + config). */
export async function restartStoppedJob(jobId: string) {
  const { data } = await requestJson(
    `/jobs/${encodeURIComponent(jobId)}/clone`,
    { method: "POST", headers: agentHeaders(), retries: 0, timeoutMs: 20_000 },
  );
  return data as { ok?: boolean; job_id?: string; source_job_id?: string };
}

/** Supprime définitivement un job arrêté (base + état mémoire). */
export async function deleteJob(jobId: string) {
  const { data } = await requestJson(
    `/jobs/${encodeURIComponent(jobId)}`,
    { method: "DELETE", headers: agentHeaders(), retries: 0, timeoutMs: 20_000 },
  );
  return data as { deleted?: string };
}

export async function cleanupOrphanJobs() {
  const { data } = await requestJson(
    "/jobs/cleanup-orphans",
    { method: "POST", headers: agentHeaders(), retries: 0, timeoutMs: 30_000 },
  );
  return data as { ok?: boolean; count?: number; cleaned?: string[] };
}

export function jobControlErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    const msg = err.message.trim();
    if (msg && msg !== "HTTP 500" && msg !== "HTTP 503") return msg;
  }
  if (err && typeof err === "object" && "message" in err) {
    const msg = String((err as { message: unknown }).message || "").trim();
    if (msg && msg !== "HTTP 500" && msg !== "HTTP 503") return msg;
  }
  return "Action impossible pour ce processus (erreur serveur).";
}
