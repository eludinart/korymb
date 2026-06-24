import { getActiveConversationId, loadConversations } from "./chatSessions";

export type PendingChatJob = {
  jobId: string;
  conversationId: string;
  startedAt: number;
  linkedParentJobId?: string;
  /** Aperçu de la question posée (bandeau latéral). */
  userPreview?: string;
};

const STORAGE_KEY = "korymb-chat-pending-jobs-v1";

export function loadPendingChatJobs(): PendingChatJob[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PendingChatJob[];
    if (!Array.isArray(parsed)) return [];
    const fallbackId = getActiveConversationId() || loadConversations()[0]?.id || "legacy";
    return parsed.map((j) => ({
      ...j,
      conversationId: j.conversationId || fallbackId,
    }));
  } catch {
    return [];
  }
}

export function savePendingChatJobs(jobs: PendingChatJob[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
}

export function addPendingChatJob(job: PendingChatJob) {
  const list = loadPendingChatJobs().filter((j) => j.jobId !== job.jobId);
  savePendingChatJobs([...list, job]);
}

export function removePendingChatJob(jobId: string) {
  savePendingChatJobs(loadPendingChatJobs().filter((j) => j.jobId !== jobId));
}

export function pendingJobsForConversation(conversationId: string): PendingChatJob[] {
  return loadPendingChatJobs().filter((j) => j.conversationId === conversationId);
}
