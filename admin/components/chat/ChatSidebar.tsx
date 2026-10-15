"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { isPersoConversation, showConversationInList, type ChatConversation } from "../../lib/chatSessions";
import type { PendingChatJob } from "../../lib/chatPendingJobs";

type Props = {
  conversations: ChatConversation[];
  activeId: string | null;
  pendingJobs: PendingChatJob[];
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onDeleteMany: (ids: string[]) => Promise<boolean | void> | boolean | void;
  interlocutorLabel?: (conv: ChatConversation) => string | null;
  className?: string;
  /** Mobile plein écran, tiroir, ou colonne desktop. */
  variant?: "sidebar" | "inbox" | "drawer";
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
  onDeleteMany,
  interlocutorLabel,
  className = "",
  variant = "sidebar",
}: Props) {
  const listRef = useRef<HTMLUListElement>(null);
  const activeRef = useRef<HTMLLIElement>(null);
  const allRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [selecting, setSelecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const inbox = variant === "inbox";
  const drawer = variant === "drawer";
  const roomy = inbox || drawer;
  const sorted = useMemo(
    () =>
      [...conversations].sort((a, b) => {
        const pin = (c: typeof a) => (isPersoConversation(c) ? 2 : c.pinned ? 1 : 0);
        const pinDiff = pin(b) - pin(a);
        if (pinDiff !== 0) return pinDiff;
        const byDate = Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
        if (byDate !== 0) return byDate;
        return String(b.id).localeCompare(String(a.id));
      }),
    [conversations],
  );
  const unreadCount = sorted.filter((c) => c.unread && showConversationInList(c)).length;
  const visible = useMemo(() => {
    let list = sorted.filter(showConversationInList);
    if (drawer && unreadOnly) list = list.filter((c) => c.unread);
    const q = query.trim().toLowerCase();
    if (!drawer || !q) return list;
    return list.filter((c) => {
      const fleet = interlocutorLabel?.(c) || "";
      return `${c.title} ${fleet}`.toLowerCase().includes(q);
    });
  }, [sorted, query, drawer, unreadOnly, interlocutorLabel]);

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

  const pickedIds = sorted.filter((c) => picked[c.id]).map((c) => c.id);
  const visiblePicked = visible.filter((c) => picked[c.id]).length;
  const allChecked = visible.length > 0 && visiblePicked === visible.length;

  useEffect(() => {
    const live = new Set(sorted.map((c) => c.id));
    setPicked((prev) => {
      const next: Record<string, boolean> = {};
      let changed = false;
      for (const [id, on] of Object.entries(prev)) {
        if (on && live.has(id)) next[id] = true;
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [sorted]);

  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = pickedIds.length > 0 && !allChecked;
  }, [pickedIds.length, allChecked]);

  const toggleAll = () => {
    setPicked((prev) => {
      const next = { ...prev };
      if (allChecked) {
        for (const c of visible) delete next[c.id];
      } else {
        for (const c of visible) next[c.id] = true;
      }
      return next;
    });
  };

  const removePicked = async () => {
    if (!pickedIds.length) return;
    setBusy(true);
    try {
      const done = await onDeleteMany(pickedIds);
      if (done !== false) setPicked({});
    } finally {
      setBusy(false);
    }
  };

  const pendingByConv = new Map<string, PendingChatJob[]>();
  for (const j of pendingJobs) {
    const list = pendingByConv.get(j.conversationId) || [];
    list.push(j);
    pendingByConv.set(j.conversationId, list);
  }

  const Root = drawer ? "div" : "aside";

  return (
    <Root
      className={
        roomy
          ? `chat-sidebar flex h-full min-h-0 w-full flex-col ${className}`
          : `chat-sidebar flex h-full min-h-0 w-[min(20rem,86vw)] flex-col border-r lg:w-72 lg:shrink-0 ${className}`
      }
      aria-label={drawer ? undefined : "Conversations"}
    >
      <div
        data-pull-refresh={inbox ? "" : undefined}
        className={`shrink-0 border-b border-slate-200 dark:border-slate-800 ${roomy ? "px-4 py-3" : "px-3 py-2"}`}
      >
        {inbox ? (
          <div className="mb-3 flex items-center justify-between gap-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-950 dark:text-slate-50">Conversation</h1>
            <Link
              href="/briefing"
              className="rounded-full px-3 py-1.5 text-xs font-bold text-violet-800 active:bg-violet-50 dark:text-violet-300 dark:active:bg-violet-950"
            >
              Aujourd&apos;hui
            </Link>
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => {
            setQuery("");
            onNew();
          }}
          className={
            roomy
              ? "w-full rounded-2xl bg-violet-700 px-4 py-3.5 text-[15px] font-semibold text-white shadow-sm active:bg-violet-800"
              : "w-full rounded-xl bg-violet-700 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-violet-800"
          }
        >
          Nouvelle conversation
        </button>
        {drawer ? (
          <div className="mt-2 flex items-center gap-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher un fil"
              aria-label="Rechercher un fil"
              className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-violet-400 focus:bg-white dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:bg-slate-950"
            />
            {unreadCount > 0 ? (
              <button
                type="button"
                aria-pressed={unreadOnly}
                onClick={() => setUnreadOnly((on) => !on)}
                className={
                  unreadOnly
                    ? "shrink-0 rounded-xl bg-emerald-700 px-2.5 py-2 text-[11px] font-bold text-white"
                    : "shrink-0 rounded-xl border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-[11px] font-bold text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100"
                }
              >
                À lire ({unreadCount})
              </button>
            ) : null}
          </div>
        ) : null}
        {sorted.length > 0 && !drawer ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setPicked({});
                setSelecting((on) => !on);
              }}
              className="min-h-11 rounded-lg px-1 text-[11px] font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-300"
            >
              {selecting ? "Terminer" : "Sélectionner"}
            </button>
            {selecting ? (
              <label className="flex min-h-11 cursor-pointer items-center gap-2 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                <input
                  ref={allRef}
                  type="checkbox"
                  checked={allChecked}
                  disabled={busy}
                  onChange={toggleAll}
                  className="h-4 w-4 rounded border-slate-300 text-violet-700 focus:ring-violet-500"
                />
                Tout
              </label>
            ) : null}
            {selecting && pickedIds.length > 0 ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void removePicked()}
                className="min-h-11 rounded-lg border border-red-200 bg-red-50 px-2.5 text-[11px] font-semibold text-red-800 hover:bg-red-100 disabled:opacity-40 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
              >
                {busy ? "Suppression…" : `Supprimer (${pickedIds.length})`}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <ul ref={listRef} className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain p-2 sm:p-2">
        {visible.length === 0 ? (
          <li className="px-3 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
            {query.trim() || unreadOnly
              ? "Aucun fil pour cette recherche."
              : "Aucune conversation. Lancez la première."}
          </li>
        ) : (
          visible.map((c) => {
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
                      ? "border-violet-400 bg-violet-50 shadow-sm ring-2 ring-violet-200 dark:border-violet-500 dark:bg-violet-950 dark:ring-violet-700"
                      : unread
                        ? "border-emerald-200 bg-emerald-50/80 active:bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40"
                        : roomy
                          ? "border-slate-200 bg-slate-50 active:bg-slate-100 dark:border-slate-700 dark:bg-slate-900"
                          : "border-transparent bg-transparent hover:border-slate-200 hover:bg-slate-50 dark:hover:border-slate-700 dark:hover:bg-slate-900"
                  }`}
                >
                  <label className={`flex min-h-11 shrink-0 cursor-pointer items-start pl-2 pt-3 ${selecting ? "" : "hidden"}`}>
                    <input
                      type="checkbox"
                      checked={Boolean(picked[c.id])}
                      disabled={busy}
                      aria-label={`Sélectionner ${c.title}`}
                      onChange={() => setPicked((prev) => ({ ...prev, [c.id]: !prev[c.id] }))}
                      className="h-4 w-4 rounded border-slate-300 text-violet-700 focus:ring-violet-500"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => onSelect(c.id)}
                    className={`min-w-0 flex-1 text-left ${roomy ? "px-3.5 py-3.5" : "px-3 py-2.5"}`}
                    aria-current={active ? "true" : undefined}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p
                        className={`line-clamp-2 font-semibold leading-snug text-slate-900 dark:text-slate-100 ${
                          roomy ? "text-[15px]" : "text-sm"
                        }`}
                      >
                        {c.title}
                      </p>
                      <time
                        dateTime={new Date(c.updatedAt).toISOString()}
                        className="shrink-0 text-right text-[10px] leading-tight tabular-nums text-slate-400 dark:text-slate-500"
                        title={formatDateTime(c.updatedAt)}
                      >
                        {roomy ? formatRelative(c.updatedAt) : formatDateTime(c.updatedAt)}
                      </time>
                    </div>
                    {c.pinned && !isPersoConversation(c) ? (
                      <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-300">
                        Épinglé
                      </p>
                    ) : null}
                    {fleet ? (
                      <p className="mt-0.5 truncate text-[11px] font-semibold text-violet-700/90 dark:text-violet-300/90">{fleet}</p>
                    ) : null}

                    {working ? (
                      <div className="mt-1.5 space-y-0.5">
                        <p className="flex items-center gap-1.5 text-[11px] font-medium text-violet-800">
                          <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-violet-600" />
                          {pending[0]?.progressLabel || "Je prépare…"}
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
                      roomy ? "opacity-100" : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
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
    </Root>
  );
}
