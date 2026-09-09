"use client";

import type { ChatConversation } from "../../lib/chatSessions";
import type { PendingChatJob } from "../../lib/chatPendingJobs";

type Props = {
  conversations: ChatConversation[];
  activeId: string | null;
  pendingJobs: PendingChatJob[];
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  className?: string;
};

function formatRelative(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  if (sameDay) {
    return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
}

export default function ChatSidebar({
  conversations,
  activeId,
  pendingJobs,
  onSelect,
  onNew,
  onDelete,
  className = "",
}: Props) {
  const pendingByConv = new Map<string, PendingChatJob[]>();
  for (const j of pendingJobs) {
    const list = pendingByConv.get(j.conversationId) || [];
    list.push(j);
    pendingByConv.set(j.conversationId, list);
  }

  return (
    <aside
      className={`flex h-full min-h-0 w-full flex-col border-r border-slate-200 bg-slate-50/90 lg:w-72 lg:shrink-0 ${className}`}
      aria-label="Conversations"
    >
      <div className="shrink-0 border-b border-slate-200 px-3 py-3">
        <button
          type="button"
          onClick={onNew}
          className="w-full rounded-xl bg-violet-700 px-3 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-violet-800"
        >
          + Nouvelle conversation
        </button>
      </div>

      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {conversations.length === 0 ? (
          <li className="px-2 py-6 text-center text-xs text-slate-500">Aucune conversation pour l&apos;instant.</li>
        ) : (
          conversations.map((c) => {
            const active = c.id === activeId;
            const pending = pendingByConv.get(c.id) || [];
            const working = pending.length > 0;
            const unread = Boolean(c.unread);
            return (
              <li key={c.id}>
                <div
                  className={`group flex items-start gap-1 rounded-xl border transition-colors ${
                    active
                      ? "border-violet-300 bg-white shadow-sm ring-1 ring-violet-100"
                      : unread
                        ? "border-emerald-200 bg-emerald-50/80 hover:bg-emerald-50"
                        : "border-transparent bg-transparent hover:border-slate-200 hover:bg-white"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(c.id)}
                    className="min-w-0 flex-1 px-3 py-2.5 text-left"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p
                        className={`line-clamp-2 text-sm font-semibold leading-snug ${
                          active ? "text-violet-950" : "text-slate-900"
                        }`}
                      >
                        {c.title}
                      </p>
                      <span className="shrink-0 text-[10px] tabular-nums text-slate-400">
                        {formatRelative(c.updatedAt)}
                      </span>
                    </div>

                    {working ? (
                      <div className="mt-1.5 space-y-0.5">
                        <p className="flex items-center gap-1.5 text-[11px] font-medium text-violet-800">
                          <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-violet-600" />
                          Exploration en cours…
                        </p>
                        {pending[0]?.userPreview ? (
                          <p className="truncate text-[11px] text-violet-600/90">{pending[0].userPreview}</p>
                        ) : null}
                      </div>
                    ) : null}

                    {unread && !working ? (
                      <p className="mt-1.5 text-[11px] font-semibold text-emerald-800">
                        ● Réponse prête
                        {c.unreadPreview ? (
                          <span className="mt-0.5 block truncate font-normal text-emerald-700/90">
                            {c.unreadPreview}
                          </span>
                        ) : null}
                      </p>
                    ) : null}

                    {!working && !unread && c.linkedParentJobId ? (
                      <p className="mt-1 text-[10px] text-slate-400">Liée mission #{c.linkedParentJobId}</p>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(c.id)}
                    className="touch-target shrink-0 rounded-lg px-2 text-base text-slate-400 opacity-100 transition-colors hover:bg-red-50 hover:text-red-700 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                    aria-label={`Supprimer ${c.title}`}
                    title="Supprimer"
                  >
                    ×
                  </button>
                </div>
              </li>
            );
          })
        )}
      </ul>
    </aside>
  );
}
