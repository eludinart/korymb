import { chatStorageKey, getActiveConversationId, loadConversations } from "./chatSessions";

export type PendingChatJob = {
  jobId: string;
  conversationId: string;
  startedAt: number;
  linkedParentJobId?: string;
  /** Aperçu de la question posée (bandeau latéral). */
  userPreview?: string;
  /** Progression réelle (équipe / jalons), pas une ETA. */
  progressPercent?: number;
  progressLabel?: string;
  progressStatus?: string;
};

const STORAGE_KEY = "korymb-chat-pending-jobs-v1";

function pendingStorageKey() {
  return chatStorageKey(STORAGE_KEY);
}

export function loadPendingChatJobs(): PendingChatJob[] {
  if (typeof window === "undefined") return [];
  const key = pendingStorageKey();
  if (!key) return [];
  try {
    const raw = localStorage.getItem(key);
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
  const key = pendingStorageKey();
  if (!key) return;
  localStorage.setItem(key, JSON.stringify(jobs));
}

export function addPendingChatJob(job: PendingChatJob) {
  const list = loadPendingChatJobs().filter((j) => j.jobId !== job.jobId);
  savePendingChatJobs([...list, job]);
}

export function removePendingChatJob(jobId: string) {
  savePendingChatJobs(loadPendingChatJobs().filter((j) => j.jobId !== jobId));
}

export function updatePendingChatJobProgress(
  jobId: string,
  patch: Pick<PendingChatJob, "progressPercent" | "progressLabel" | "progressStatus">,
) {
  const list = loadPendingChatJobs();
  const next = list.map((j) => (j.jobId === jobId ? { ...j, ...patch } : j));
  savePendingChatJobs(next);
  return next;
}

export function pendingJobsForConversation(conversationId: string): PendingChatJob[] {
  return loadPendingChatJobs().filter((j) => j.conversationId === conversationId);
}
