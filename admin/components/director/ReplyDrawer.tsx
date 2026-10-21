"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { agentHeaders, requestJson } from "@/lib/api";
import { persistChatConversationToServer } from "@/lib/chatConversationsApi";
import type { ChatConversation } from "@/lib/chatSessions";
import { buildReplyContext, newReplyConversationId, type ReplyKind } from "@/lib/replyContext";

type Turn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  failed?: boolean;
};

export type ReplyDiscussTarget = {
  kind: ReplyKind;
  title: string;
  notes?: string;
  subject?: string;
  conversationId: string;
  draft: string;
};

function asTurns(raw: unknown): Turn[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as { id?: unknown; role?: unknown; content?: unknown };
    const role = row.role === "assistant" ? "assistant" : row.role === "user" ? "user" : "";
    const content = typeof row.content === "string" ? row.content : "";
    if (!role || !content.trim()) return [];
    return [{ id: String(row.id || `${role}-${content.slice(0, 12)}`), role, content }];
  });
}

export default function ReplyDrawer({
  open,
  target,
  onClose,
  onUse,
  onConversationId,
}: {
  open: boolean;
  target: ReplyDiscussTarget;
  onClose: () => void;
  onUse: (text: string) => void;
  onConversationId: (id: string) => Promise<void>;
}) {
  const [ready, setReady] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => setReady(true), []);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const existing = target.conversationId.trim();
    setConversationId(existing);
    setMessage("");
    setError("");
    if (!existing) {
      setTurns([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const { res, data } = await requestJson(`/chat/conversations/${encodeURIComponent(existing)}`, {
          headers: agentHeaders(),
          expectOk: false,
        });
        if (cancelled) return;
        if (!res.ok) {
          setTurns([]);
          if (res.status !== 404) setError("Impossible de rouvrir la discussion.");
          return;
        }
        const row = data as { messages?: unknown };
        setTurns(asTurns(row.messages));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Impossible de rouvrir la discussion.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, target.conversationId]);

  const persist = async (id: string, next: Turn[]) => {
    const conv: ChatConversation = {
      id,
      title: `Réponse · ${target.title.trim().slice(0, 80)}`,
      messages: next.filter((turn) => !turn.failed).map((turn) => ({
        id: turn.id,
        role: turn.role,
        content: turn.content,
      })),
      updatedAt: Date.now(),
      interlocutor: "assistant",
    };
    await persistChatConversationToServer(conv);
  };

  const ensureId = async () => {
    const current = conversationId.trim();
    if (current) return current;
    const created = newReplyConversationId();
    await persist(created, []);
    await onConversationId(created);
    setConversationId(created);
    return created;
  };

  const send = async () => {
    const ask = message.trim();
    if (!ask || sending) return;
    setSending(true);
    setError("");
    const userTurn: Turn = { id: `u-${Date.now()}`, role: "user", content: ask };
    const history = turns.filter((turn) => !turn.failed).map((turn) => ({ role: turn.role, content: turn.content }));
    setTurns((prev) => [...prev, userTurn]);
    setMessage("");
    try {
      const id = await ensureId();
      const { data } = await requestJson("/chat", {
        method: "POST",
        headers: agentHeaders(),
        timeoutMs: 25_000,
        body: JSON.stringify({
          message: ask,
          agent: "assistant",
          history,
          chat_session_id: id,
          chat_use_mode: "quotidien",
          reply_context: buildReplyContext({
            kind: target.kind,
            title: target.title,
            notes: target.notes,
            subject: target.subject,
            draft: target.draft,
          }),
        }),
      });
      const status = String((data as { status?: string })?.status || "");
      const response = String((data as { response?: string })?.response || "").trim();
      if (status === "completed" && response) {
        const assistantTurn: Turn = { id: `a-${Date.now()}`, role: "assistant", content: response };
        const next = [...turns.filter((turn) => !turn.failed), userTurn, assistantTurn];
        setTurns(next);
        await persist(id, next);
        return;
      }
      const failed: Turn = {
        id: `e-${Date.now()}`,
        role: "assistant",
        content: "La préparation n'a pas renvoyé de texte. Réessayez.",
        failed: true,
      };
      setTurns((prev) => [...prev, failed]);
    } catch (err) {
      const failed: Turn = {
        id: `e-${Date.now()}`,
        role: "assistant",
        content: err instanceof Error ? err.message : "La discussion n'a pas abouti.",
        failed: true,
      };
      setTurns((prev) => [...prev, failed]);
    } finally {
      setSending(false);
    }
  };

  if (!ready || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[90]" role="dialog" aria-modal="true" aria-label="Discuter la réponse">
      <button type="button" className="absolute inset-0 bg-slate-950/45 dark:bg-black/60" aria-label="Fermer" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl dark:bg-slate-900 lg:inset-y-0 lg:left-auto lg:right-0 lg:h-full lg:max-h-none lg:w-[min(28rem,100%)] lg:rounded-none">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <div className="min-w-0">
            <p className="text-sm font-extrabold text-slate-950 dark:text-slate-50">Discuter la réponse</p>
            <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{target.title}</p>
          </div>
          <button type="button" className="btn-secondary shrink-0" onClick={onClose}>
            Fermer
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {loading ? <p className="text-sm text-slate-500">Chargement de la discussion…</p> : null}
          {!loading && turns.length === 0 ? (
            <p className="text-sm text-slate-500">Décrivez la réponse que vous voulez. L'assistant la prépare avec vous.</p>
          ) : null}
          {turns.map((turn) => (
            <div key={turn.id} className={turn.role === "user" ? "ml-8" : "mr-6"}>
              <p className={`whitespace-pre-wrap rounded-xl px-3 py-2 text-sm ${
                turn.role === "user"
                  ? "bg-violet-100 text-violet-950 dark:bg-violet-900 dark:text-violet-50"
                  : turn.failed
                    ? "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-100"
                    : "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-50"
              }`}>
                {turn.content}
              </p>
              {turn.role === "assistant" && !turn.failed && turn.content.trim() ? (
                <button
                  type="button"
                  className="mt-1 text-xs font-bold text-violet-800 hover:underline dark:text-violet-200"
                  onClick={() => {
                    if (target.draft.trim() && !window.confirm("Remplacer la réponse déjà saisie ?")) return;
                    onUse(turn.content.trim());
                  }}
                >
                  Utiliser comme réponse
                </button>
              ) : null}
            </div>
          ))}
          {error ? <p className="text-sm text-red-700 dark:text-red-300">{error}</p> : null}
        </div>
        <form
          className="flex shrink-0 gap-2 border-t border-slate-100 p-3 dark:border-slate-800"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <textarea
            className="input-field min-h-16 flex-1 resize-y"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Votre message"
            aria-label="Message pour préparer la réponse"
            maxLength={4000}
          />
          <button type="submit" className="btn-primary self-end" disabled={sending || !message.trim()}>
            {sending ? "Envoi…" : "Envoyer"}
          </button>
        </form>
      </div>
    </div>,
    document.body,
  );
}
