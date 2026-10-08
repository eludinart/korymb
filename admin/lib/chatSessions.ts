import type { ChatMsg } from "../components/chat/ChatShell";
import {
  deleteChatConversationOnServer,
  fetchChatConversationsFromServer,
  persistChatConversationToServer,
} from "./chatConversationsApi";

export type ChatConversation = {
  id: string;
  title: string;
  messages: ChatMsg[];
  updatedAt: number;
  linkedParentJobId?: string;
  /** "assistant" | "coordinateur" | `group:${id}` — interlocuteur de cette conversation. */
  interlocutor?: string;
  unread?: boolean;
  unreadPreview?: string;
};

const INDEX_KEY = "korymb-chat-conversations-v1";
const ACTIVE_KEY = "korymb-chat-active-conversation-v1";

let boundWorkspaceId = "";

export function bindChatStorageWorkspace(workspaceId: string) {
  boundWorkspaceId = (workspaceId || "").trim();
}

export function chatStorageKey(base: string) {
  return boundWorkspaceId ? `${base}:${boundWorkspaceId}` : "";
}

function scopedKey(base: string) {
  return chatStorageKey(base);
}

function now() {
  return Date.now();
}

export function conversationTitleFromMessages(messages: ChatMsg[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  const raw = (firstUser?.content || "").trim().replace(/\s+/g, " ");
  if (raw) return raw.length > 52 ? `${raw.slice(0, 51)}…` : raw;
  const fileName = firstUser?.attachments?.[0]?.filename || "";
  if (fileName) return fileName.length > 52 ? `${fileName.slice(0, 51)}…` : fileName;
  return "Nouvelle conversation";
}

export function loadConversations(): ChatConversation[] {
  if (typeof window === "undefined") return [];
  const key = scopedKey(INDEX_KEY);
  if (!key) return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatConversation[];
    return Array.isArray(parsed) ? parsed.sort((a, b) => b.updatedAt - a.updatedAt) : [];
  } catch {
    return [];
  }
}

export function saveConversations(conversations: ChatConversation[]) {
  if (typeof window === "undefined") return;
  const key = scopedKey(INDEX_KEY);
  if (!key) return;
  const sorted = [...conversations].sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  localStorage.setItem(key, JSON.stringify(sorted));
}

export function getActiveConversationId(): string | null {
  if (typeof window === "undefined") return null;
  const key = scopedKey(ACTIVE_KEY);
  if (!key) return null;
  return localStorage.getItem(key);
}

export function setActiveConversationId(id: string) {
  if (typeof window === "undefined") return;
  const key = scopedKey(ACTIVE_KEY);
  if (!key) return;
  localStorage.setItem(key, id);
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
  void persistChatConversationToServer({ ...conversation, updatedAt: conversation.updatedAt || now() }).catch(() => {
    /* offline fallback localStorage */
  });
}

export function deleteConversation(id: string, opts?: { remote?: boolean }) {
  saveConversations(loadConversations().filter((c) => c.id !== id));
  if (opts?.remote === false) return;
  void deleteChatConversationOnServer(id).catch(() => {});
}

async function bindWorkspaceFromSession(): Promise<void> {
  try {
    const res = await fetch("/api/auth/me", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { workspace?: { id?: string } };
    const id = String(data?.workspace?.id || "").trim();
    if (id) bindChatStorageWorkspace(id);
  } catch {
    /* conserve le cache local si la session n'est pas lisible */
  }
}

/** Le serveur remplace une conversation seulement s'il est au moins aussi récent. Le local absent du serveur est conservé. */
export function mergeConversations(local: ChatConversation[], server: ChatConversation[]): ChatConversation[] {
  if (!server.length) return local;
  const localById = new Map(local.map((c) => [c.id, c]));
  const serverIds = new Set<string>();
  const merged: ChatConversation[] = [];
  for (const row of server) {
    serverIds.add(row.id);
    const prev = localById.get(row.id);
    if (prev && Number(prev.updatedAt || 0) > Number(row.updatedAt || 0)) {
      merged.push(prev);
      continue;
    }
    merged.push({
      ...row,
      interlocutor: row.interlocutor || prev?.interlocutor,
      linkedParentJobId: row.linkedParentJobId || prev?.linkedParentJobId,
    });
  }
  for (const conv of local) {
    if (!serverIds.has(conv.id)) merged.push(conv);
  }
  merged.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  return merged;
}

/** Charge les conversations de l'espace courant. Un serveur vide ne vide pas le fil local. */
export async function hydrateConversationsFromServer(): Promise<ChatConversation[]> {
  try {
    await bindWorkspaceFromSession();
    const server = await fetchChatConversationsFromServer();
    const local = loadConversations();
    const merged = mergeConversations(local, server);
    if (server.length) saveConversations(merged);
    return merged;
  } catch {
    return loadConversations();
  }
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
