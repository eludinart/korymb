import type { ChatMsg } from "../components/chat/ChatShell";
import type { ChatConversation } from "./chatSessions";
import { agentHeaders, requestJson } from "./api";

function toServerConv(conv: ChatConversation) {
  return {
    id: conv.id,
    title: conv.title,
    messages: conv.messages,
    linked_parent_job_id: conv.linkedParentJobId || null,
  };
}

function fromServerRow(row: Record<string, unknown>): ChatConversation {
  const updatedRaw = row.updated_at || row.updatedAt;
  const updatedAt =
    typeof updatedRaw === "string" && updatedRaw
      ? Date.parse(updatedRaw) || Date.now()
      : Number(row.updatedAt) || Date.now();
  return {
    id: String(row.id || ""),
    title: String(row.title || "Conversation"),
    messages: (Array.isArray(row.messages) ? row.messages : []) as ChatMsg[],
    updatedAt,
    linkedParentJobId: (row.linked_parent_job_id as string) || undefined,
  };
}

export async function fetchChatConversationsFromServer(): Promise<ChatConversation[]> {
  const { data } = await requestJson("/chat/conversations", { headers: agentHeaders(), retries: 1 });
  const list = (data as { conversations?: unknown[] })?.conversations;
  if (!Array.isArray(list)) return [];
  return list.map((r) => fromServerRow(r as Record<string, unknown>)).filter((c) => c.id);
}

export async function persistChatConversationToServer(conv: ChatConversation): Promise<void> {
  await requestJson(`/chat/conversations/${encodeURIComponent(conv.id)}`, {
    method: "PUT",
    headers: agentHeaders(),
    body: JSON.stringify(toServerConv(conv)),
    retries: 0,
    timeoutMs: 20_000,
  });
}

export async function deleteChatConversationOnServer(id: string): Promise<void> {
  await requestJson(`/chat/conversations/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: agentHeaders(),
    retries: 0,
  });
}

export async function importLocalConversationsToServer(conversations: ChatConversation[]): Promise<number> {
  const { data } = await requestJson("/chat/conversations/import", {
    method: "POST",
    headers: agentHeaders(),
    body: JSON.stringify({ conversations }),
    retries: 1,
    timeoutMs: 30_000,
  });
  return Number((data as { imported?: number })?.imported ?? 0);
}
