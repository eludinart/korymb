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

export type PlaybookRunPiece = {
  title: string;
  body: string;
  body_preview?: string;
};

export type PlaybookRun = {
  job_id: string;
  status: string;
  playbook_id?: string;
  created_at?: string;
  mission_preview?: string;
  result_preview?: string;
  pieces?: PlaybookRunPiece[];
};

export async function listPlaybookRuns() {
  const { data } = await requestJson("/playbooks/runs", { headers: agentHeaders() });
  return ((data as { runs?: PlaybookRun[] }).runs || []) as PlaybookRun[];
}
