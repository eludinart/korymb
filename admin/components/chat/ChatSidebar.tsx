"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";
import type { ChatConversation } from "../../lib/chatSessions";
import type { PendingChatJob } from "../../lib/chatPendingJobs";

type Props = {
  conversations: ChatConversation[];
  activeId: string | null;
  pendingJobs: PendingChatJob[];
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  interlocutorLabel?: (conv: ChatConversation) => string | null;
  className?: string;
  /** Mobile plein écran : pas de chrome desktop. */
  variant?: "sidebar" | "inbox";
};

function formatRelative(ts: number): string {
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return "—";
  const now = Date.now();
  const diff = Math.max(0, now - d.getTime());
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} j`;
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
}

function formatDateTime(ts: number): string {
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return "—";
  const date = d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return `${date} ${time}`;
}

export default function ChatSidebar({
  conversations,
  activeId,
  pendingJobs,
  onSelect,
  onNew,
  onDelete,
  interlocutorLabel,
  className = "",
  variant = "sidebar",
}: Props) {
  const listRef = useRef<HTMLUListElement>(null);
  const activeRef = useRef<HTMLLIElement>(null);
  const inbox = variant === "inbox";
  const sorted = useMemo(
    () =>
      [...conversations].sort((a, b) => {
        const byDate = Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
        if (byDate !== 0) return byDate;
        return String(b.id).localeCompare(String(a.id));
      }),
    [conversations],
  );

  useEffect(() => {
    if (inbox) return;
    const list = listRef.current;
    const el = activeRef.current;
    if (!list || !el) return;
    const listRect = list.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    if (elRect.top < listRect.top) {
      list.scrollTop -= listRect.top - elRect.top;
    } else if (elRect.bottom > listRect.bottom) {
      list.scrollTop += elRect.bottom - listRect.bottom;
    }
  }, [activeId, sorted, inbox]);

  const pendingByConv = new Map<string, PendingChatJob[]>();
  for (const j of pendingJobs) {
    const list = pendingByConv.get(j.conversationId) || [];
    list.push(j);
    pendingByConv.set(j.conversationId, list);
  }

  return (
    <aside
      className={
        inbox
          ? `flex h-full min-h-0 w-full flex-col bg-white ${className}`
          : `flex h-full min-h-0 w-[min(20rem,86vw)] flex-col border-r border-slate-200 bg-white lg:w-72 lg:shrink-0 lg:bg-slate-50/90 ${className}`
      }
      aria-label="Conversations"
    >
      <div
        className={`shrink-0 border-b border-slate-200 ${inbox ? "px-4 py-3" : "px-3 py-2"}`}
      >
        {inbox ? (
          <div className="mb-3 flex items-center justify-between gap-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-950">Conversation</h1>
            <Link
              href="/briefing"
              className="rounded-full px-3 py-1.5 text-xs font-bold text-violet-800 active:bg-violet-50"
            >
              Accueil
            </Link>
          </div>
        ) : null}
        <button
          type="button"
          onClick={onNew}
          className={
            inbox
              ? "w-full rounded-2xl bg-violet-700 px-4 py-3.5 text-[15px] font-semibold text-white shadow-sm active:bg-violet-800"
              : "w-full rounded-xl bg-violet-700 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-violet-800"
          }
        >
          Nouvelle conversation
        </button>
      </div>

      <ul ref={listRef} className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain p-2 sm:p-2">
        {sorted.length === 0 ? (
          <li className="px-3 py-10 text-center text-sm text-slate-500">
            Aucune conversation. Lancez la première.
          </li>
        ) : (
          sorted.map((c) => {
            const active = !inbox && c.id === activeId;
            const pending = pendingByConv.get(c.id) || [];
            const working = pending.length > 0;
            const unread = Boolean(c.unread);
            const fleet = interlocutorLabel?.(c);
            return (
              <li key={c.id} ref={active ? activeRef : undefined}>
                <div
                  className={`group flex items-start gap-1 rounded-2xl border transition-colors ${
                    active
                      ? "border-violet-400 bg-white shadow-sm ring-2 ring-violet-300"
                      : unread
                        ? "border-emerald-200 bg-emerald-50/80 active:bg-emerald-50"
                        : inbox
                          ? "border-slate-100 bg-white active:bg-slate-50"
                          : "border-transparent bg-transparent hover:border-slate-200 hover:bg-white"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(c.id)}
                    className={`min-w-0 flex-1 text-left ${inbox ? "px-3.5 py-3.5" : "px-3 py-2.5"}`}
                    aria-current={active ? "true" : undefined}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p
                        className={`line-clamp-2 font-semibold leading-snug ${
                          inbox ? "text-[15px]" : "text-sm"
                        } ${active ? "text-violet-950" : "text-slate-900"}`}
                      >
                        {c.title}
                      </p>
                      <time
                        dateTime={new Date(c.updatedAt).toISOString()}
                        className="shrink-0 text-right text-[10px] leading-tight tabular-nums text-slate-400"
                        title={formatDateTime(c.updatedAt)}
                      >
                        {inbox ? formatRelative(c.updatedAt) : formatDateTime(c.updatedAt)}
                      </time>
                    </div>
                    {fleet ? (
                      <p className="mt-0.5 truncate text-[11px] font-semibold text-violet-700/90">{fleet}</p>
                    ) : null}

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
                    className={`touch-target shrink-0 rounded-lg px-2 text-base text-slate-400 transition-colors hover:bg-red-50 hover:text-red-700 ${
                      inbox ? "opacity-100" : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                    }`}
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
