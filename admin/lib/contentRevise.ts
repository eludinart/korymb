import { agentHeaders, requestJson } from "./api";

export type ReviseResult = {
  status: string;
  job_id: string;
  parent_job_id: string;
  source?: string;
  next?: { mission?: string; hint?: string };
};

export async function reviseJob(jobId: string, instruction: string, formatId = "") {
  const { data } = await requestJson(`/jobs/${encodeURIComponent(jobId)}/revise`, {
    method: "POST",
    headers: agentHeaders(),
    body: JSON.stringify({ instruction, format_id: formatId || "" }),
    timeoutMs: 60_000,
  });
  return data as ReviseResult;
}
