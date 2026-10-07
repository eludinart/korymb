"use client";

import Link from "next/link";
import ChatBottomSheet from "./ChatBottomSheet";
import ChatInterlocutorSelect, { type GroupOpt } from "./ChatInterlocutorSelect";
import ColorSchemeToggle from "../ColorSchemeToggle";
import ThinkingModePicker from "../director/ThinkingModePicker";
import {
  CHAT_TEXT_SCALE_LABELS,
  CHAT_TEXT_SCALE_ORDER,
  type ChatTextScale,
} from "../../lib/chatTextScale";

type Props = {
  open: boolean;
  onClose: () => void;
  onDelete?: () => void;
  linkedParentJobId?: string;
  onOpenLinkedMission?: () => void;
  textScale?: ChatTextScale;
  onTextScaleChange?: (scale: ChatTextScale) => void;
  interlocutor: string;
  groups: GroupOpt[];
  onInterlocutorChange: (value: string) => void;
  interlocutorDisabled?: boolean;
  onHandOffToTeam?: () => void;
};

/** Menu ⋯ : équipe, affichage, mission liée, suppression. */
export default function ChatThreadMoreSheet({
  open,
  onClose,
  onDelete,
  linkedParentJobId,
  onOpenLinkedMission,
  textScale = "sm",
  onTextScaleChange,
  interlocutor,
  groups,
  onInterlocutorChange,
  interlocutorDisabled,
  onHandOffToTeam,
}: Props) {
  const row =
    "flex w-full items-center gap-3 rounded-2xl px-3 py-3.5 text-left text-[15px] font-semibold active:bg-slate-100 disabled:opacity-40 dark:active:bg-slate-800";

  return (
    <ChatBottomSheet open={open} onClose={onClose} title="Conversation">
      <div className="space-y-1 pb-2">
        <div className="mb-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 dark:border-slate-700 dark:bg-slate-900">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Interlocuteur</p>
          <div className="mt-2">
            <ChatInterlocutorSelect
              value={interlocutor}
              onChange={onInterlocutorChange}
              groups={groups}
              disabled={interlocutorDisabled}
              variant="compact"
            />
          </div>
          {onHandOffToTeam ? (
            <button
              type="button"
              className="mt-2 text-sm font-semibold text-violet-800 dark:text-violet-300"
              onClick={() => {
                onClose();
                onHandOffToTeam();
              }}
            >
              Faire faire par l&apos;équipe
            </button>
          ) : null}
        </div>

        <div className="mb-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 dark:border-slate-700 dark:bg-slate-900">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Mode de pensée</p>
          <div className="mt-2">
            <ThinkingModePicker persist compact />
          </div>
        </div>

        <div className="mb-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 dark:border-slate-700 dark:bg-slate-900">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Affichage</p>
          <div className="mt-2">
            <ColorSchemeToggle className="w-full justify-center" />
          </div>
        </div>

        {onTextScaleChange ? (
          <div className="mb-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 dark:border-slate-700 dark:bg-slate-900">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Taille du texte</p>
            <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {CHAT_TEXT_SCALE_ORDER.map((id) => {
                const active = textScale === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onTextScaleChange(id)}
                    className={
                      active
                        ? "rounded-xl bg-violet-700 py-2.5 text-sm font-bold text-white"
                        : "rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-700 active:bg-slate-100 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-200 dark:active:bg-slate-800"
                    }
                    aria-pressed={active}
                  >
                    {CHAT_TEXT_SCALE_LABELS[id]}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {linkedParentJobId && onOpenLinkedMission ? (
          <button
            type="button"
            className={`${row} text-slate-800 dark:text-slate-100`}
            onClick={() => {
              onClose();
              onOpenLinkedMission();
            }}
          >
            <span
              className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200"
              aria-hidden
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5h11M9 12h11M9 19h11M4 5h.01M4 12h.01M4 19h.01" />
              </svg>
            </span>
            Voir la mission liée
          </button>
        ) : null}

        <Link href="/briefing" className={`${row} text-slate-800 dark:text-slate-100`} onClick={onClose}>
          Accueil
        </Link>

        {onDelete ? (
          <button
            type="button"
            className={`${row} text-red-700 dark:text-red-400`}
            onClick={() => {
              onClose();
              onDelete();
            }}
          >
            <span
              className="flex h-9 w-9 items-center justify-center rounded-full bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
              aria-hidden
            >
              ×
            </span>
            Supprimer la conversation
          </button>
        ) : null}
      </div>
    </ChatBottomSheet>
  );
}
