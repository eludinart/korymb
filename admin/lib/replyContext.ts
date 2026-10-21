export const REPLY_MAX = 4000;

export type ReplyKind = "Tâche" | "Étape" | "Question";

export function replyBlockStartsOpen(title: string, hint: string, reply: string): boolean {
  if (reply.trim()) return true;
  if (title.trim().endsWith("?")) return true;
  const blob = hint.toLocaleLowerCase("fr");
  const waits = blob.includes("attente");
  const asks = blob.includes("réponse") || blob.includes("reponse");
  return waits && asks;
}

export function buildReplyContext(input: {
  kind: ReplyKind;
  title: string;
  notes?: string;
  subject?: string;
  draft?: string;
}): string {
  const lines = [input.kind, input.title.trim(), (input.notes || "").trim(), (input.subject || "").trim()];
  const draft = (input.draft || "").trim();
  if (draft) lines.push(draft);
  return lines.filter(Boolean).join("\n").slice(0, REPLY_MAX);
}

export function newReplyConversationId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `rcv-${hex}`;
}
