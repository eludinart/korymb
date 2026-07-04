import type { ChatMsg } from "../components/chat/ChatShell";
import { JOB_ID_MAX_LEN, normalizeJobId } from "./missionBossView";
import { deleteMissionJobBundle } from "./deleteMissionBundle";
import { pendingJobsForConversation } from "./chatPendingJobs";

function jobIdFromMessageId(id: string): string | null {
  const m = /^a-(.+)$/.exec(id) || /^e-(.+)$/.exec(id);
  return m?.[1]?.slice(0, JOB_ID_MAX_LEN) || null;
}

/** Jobs chat propres à une conversation (sans la mission parente liée). */
export function collectChatConversationJobIds(conversationId: string, messages: ChatMsg[]): string[] {
  const ids = new Set<string>();
  for (const j of pendingJobsForConversation(conversationId)) {
    if (j.jobId) ids.add(j.jobId);
  }
  for (const m of messages) {
    if (m.jobId) ids.add(normalizeJobId(String(m.jobId)));
    const fromId = jobIdFromMessageId(m.id);
    if (fromId) ids.add(fromId);
  }
  return [...ids];
}

export async function deleteChatConversationJobs(conversationId: string, messages: ChatMsg[]): Promise<void> {
  const jobIds = collectChatConversationJobIds(conversationId, messages);
  if (!jobIds.length) return;
  await deleteMissionJobBundle(jobIds);
}

export function confirmDeleteChatConversation(): boolean {
  if (typeof window === "undefined") return false;
  return window.confirm(
    "Supprimer cette conversation ?\n\nLes échanges locaux et les jobs chat associés seront effacés. La mission parente liée, si présente, n'est pas supprimée.",
  );
}
