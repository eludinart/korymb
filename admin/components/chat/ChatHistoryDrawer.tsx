"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import ChatSidebar from "./ChatSidebar";
import ChatInterlocutorSelect, { type GroupOpt } from "./ChatInterlocutorSelect";
import { isPersoConversation, type ChatConversation } from "../../lib/chatSessions";
import type { PendingChatJob } from "../../lib/chatPendingJobs";
import { CHAT_USE_MODE_OPTIONS, type ChatUseMode } from "../../lib/chatUseMode";
import { LlmModelSection } from "../LlmHopList";

type Props = {
  open: boolean;
  onClose: () => void;
  conversations: ChatConversation[];
  activeId: string | null;
  pendingJobs: PendingChatJob[];
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onDeleteMany: (ids: string[]) => Promise<boolean | void> | boolean | void;
  interlocutorLabel?: (conv: ChatConversation) => string | null;
  chatUseMode: ChatUseMode;
  onChatUseModeChange: (mode: ChatUseMode) => void;
  onOpenPerso: () => void;
  onOpenSettings: () => void;
  activeTitle: string;
  pinned: boolean;
  onRename: (title: string) => void;
  onTogglePin: () => void;
  onCopy: () => Promise<boolean>;
  canConvert: boolean;
  onConvert?: () => void;
  missionJobId?: string;
  onOpenMission?: () => void;
  interlocutor: string;
  groups: GroupOpt[];
  onInterlocutorChange: (value: string) => void;
  interlocutorDisabled?: boolean;
};

/** Tiroir mobile : fils précédents et actions liées au chat. */
export default function ChatHistoryDrawer({
  open,
  onClose,
  conversations,
  activeId,
  pendingJobs,
  onSelect,
  onNew,
  onDelete,
  onDeleteMany,
  interlocutorLabel,
  chatUseMode,
  onChatUseModeChange,
  onOpenPerso,
  onOpenSettings,
  activeTitle,
  pinned,
  onRename,
  onTogglePin,
  onCopy,
  canConvert,
  onConvert,
  missionJobId,
  onOpenMission,
  interlocutor,
  groups,
  onInterlocutorChange,
  interlocutorDisabled,
}: Props) {
  const [ready, setReady] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const active = conversations.find((c) => c.id === activeId);
  const canRetitle = Boolean(active) && !isPersoConversation(active || { id: "" });
  useEffect(() => setReady(true), []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!ready || !open) return null;

  const action =
    "rounded-xl border border-slate-200 bg-white px-2 py-2.5 text-center text-xs font-bold text-slate-800 active:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:active:bg-slate-800";

  return createPortal(
    <div className="fixed inset-0 z-[90] lg:hidden" role="dialog" aria-modal="true" aria-label="Discussions">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/45 dark:bg-black/60"
        aria-label="Fermer les discussions"
        onClick={onClose}
      />
      <aside className="chat-history-drawer chat-sidebar">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <p className="text-base font-bold text-slate-950 dark:text-slate-50">Discussions</p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-2.5 py-1.5 text-sm font-semibold text-slate-600 active:bg-slate-100 dark:text-slate-300 dark:active:bg-slate-800"
          >
            Fermer
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          <ChatSidebar
            variant="drawer"
            conversations={conversations}
            activeId={activeId}
            pendingJobs={pendingJobs}
            onSelect={onSelect}
            onNew={onNew}
            onDelete={onDelete}
            onDeleteMany={onDeleteMany}
            interlocutorLabel={interlocutorLabel}
            className="border-0"
          />
        </div>

        <div
          className="max-h-[58%] shrink-0 space-y-2 overflow-y-auto border-t border-slate-200 px-3 pt-3 dark:border-slate-800"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}
        >
          <LlmModelSection />
          <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Mode du chat">
            {CHAT_USE_MODE_OPTIONS.map((opt) => {
              const active = chatUseMode === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onChatUseModeChange(opt.id)}
                  className={
                    active
                      ? "rounded-xl bg-violet-700 py-2.5 text-sm font-bold text-white"
                      : "rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-700 active:bg-slate-100 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-200"
                  }
                  aria-pressed={active}
                  title={opt.hint}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          {chatUseMode === "operationnel" ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Interlocuteur
              </p>
              <div className="mt-1.5">
                <ChatInterlocutorSelect
                  value={interlocutor}
                  onChange={onInterlocutorChange}
                  groups={groups}
                  disabled={interlocutorDisabled}
                  variant="compact"
                />
              </div>
            </div>
          ) : null}
          {renaming ? (
            <form
              className="flex gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                onRename(draftTitle);
                setRenaming(false);
              }}
            >
              <input
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                maxLength={80}
                aria-label="Nouveau titre du fil"
                className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-violet-400 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
              />
              <button type="submit" className="rounded-xl bg-violet-700 px-3 text-xs font-bold text-white">
                OK
              </button>
              <button
                type="button"
                className={action}
                onClick={() => setRenaming(false)}
              >
                Annuler
              </button>
            </form>
          ) : (
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                className={action}
                disabled={!canRetitle}
                onClick={() => {
                  setDraftTitle(activeTitle);
                  setRenaming(true);
                }}
              >
                Renommer
              </button>
              <button type="button" className={action} disabled={!canRetitle} onClick={onTogglePin}>
                {pinned ? "Désépingler" : "Épingler"}
              </button>
              <button
                type="button"
                className={action}
                onClick={() => {
                  setCopyError("");
                  void onCopy()
                    .then((ok) => {
                      if (!ok) {
                        setCopyError("Rien à copier.");
                        return;
                      }
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 1600);
                    })
                    .catch(() => setCopyError("Copie impossible."));
                }}
              >
                {copied ? "Copié" : "Copier"}
              </button>
            </div>
          )}
          {copyError ? <p className="text-center text-[11px] font-semibold text-red-700">{copyError}</p> : null}
          {missionJobId && onOpenMission ? (
            <button type="button" className={`${action} w-full`} onClick={onOpenMission}>
              Ouvrir la mission liée
            </button>
          ) : null}
          {canConvert && onConvert ? (
            <button type="button" className={`${action} w-full`} onClick={onConvert}>
              Transformer en mission
            </button>
          ) : null}
          <div className="grid grid-cols-3 gap-1.5">
            <button type="button" className={action} onClick={onOpenPerso}>
              Fil Perso
            </button>
            <button type="button" className={action} onClick={onOpenSettings}>
              Réglages
            </button>
            <Link href="/briefing" className={action} onClick={onClose}>
              Aujourd&apos;hui
            </Link>
          </div>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
