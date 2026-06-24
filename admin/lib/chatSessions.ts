import type { ChatMsg } from "../components/chat/ChatShell";

export type ChatConversation = {
  id: string;
  title: string;
  messages: ChatMsg[];
  updatedAt: number;
  linkedParentJobId?: string;
  unread?: boolean;
  unreadPreview?: string;
};

const INDEX_KEY = "korymb-chat-conversations-v1";
const ACTIVE_KEY = "korymb-chat-active-conversation-v1";
const LEGACY_MESSAGES_KEY = "korymb-chat-messages-v2";
const LEGACY_SESSION_KEY = "korymb-chat-session-v2";

function now() {
  return Date.now();
}

export function conversationTitleFromMessages(messages: ChatMsg[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  const raw = (firstUser?.content || "").trim().replace(/\s+/g, " ");
  if (!raw) return "Nouvelle conversation";
  return raw.length > 52 ? `${raw.slice(0, 51)}…` : raw;
}

export function loadConversations(): ChatConversation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ChatConversation[];
      return Array.isArray(parsed) ? parsed.sort((a, b) => b.updatedAt - a.updatedAt) : [];
    }
    const legacy = localStorage.getItem(LEGACY_MESSAGES_KEY);
    if (legacy) {
      const messages = JSON.parse(legacy) as ChatMsg[];
      if (Array.isArray(messages) && messages.length > 0) {
        const id = localStorage.getItem(LEGACY_SESSION_KEY) || `conv-${now()}`;
        const conv: ChatConversation = {
          id,
          title: conversationTitleFromMessages(messages),
          messages,
          updatedAt: now(),
        };
        saveConversations([conv]);
        setActiveConversationId(id);
        localStorage.removeItem(LEGACY_MESSAGES_KEY);
        return [conv];
      }
    }
    return [];
  } catch {
    return [];
  }
}

export function saveConversations(conversations: ChatConversation[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(INDEX_KEY, JSON.stringify(conversations));
}

export function getActiveConversationId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveConversationId(id: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(ACTIVE_KEY, id);
}

export function createConversation(opts?: { linkedParentJobId?: string }): ChatConversation {
  const id = `conv-${crypto.randomUUID?.() ?? `${now()}-${Math.random().toString(36).slice(2, 9)}`}`;
  return {
    id,
    title: opts?.linkedParentJobId ? `Mission #${opts.linkedParentJobId}` : "Nouvelle conversation",
    messages: [],
    updatedAt: now(),
    linkedParentJobId: opts?.linkedParentJobId,
  };
}

export function upsertConversation(conversation: ChatConversation) {
  const list = loadConversations().filter((c) => c.id !== conversation.id);
  saveConversations([{ ...conversation, updatedAt: conversation.updatedAt || now() }, ...list]);
}

export function deleteConversation(id: string) {
  saveConversations(loadConversations().filter((c) => c.id !== id));
}

export function findConversationByJobId(jobId: string): ChatConversation | undefined {
  return loadConversations().find((c) =>
    c.messages.some((m) => m.id === `a-${jobId}` || m.id === `e-${jobId}` || m.id === `ack-${jobId}`),
  );
}

export function findConversationForPendingJob(
  jobId: string,
  pendingConversationId?: string,
): string | undefined {
  if (pendingConversationId) return pendingConversationId;
  const byMsg = findConversationByJobId(jobId);
  return byMsg?.id;
}
