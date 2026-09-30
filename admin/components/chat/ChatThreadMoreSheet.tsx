"use client";

import ChatBottomSheet from "./ChatBottomSheet";
import {
  CHAT_TEXT_SCALE_LABELS,
  CHAT_TEXT_SCALE_ORDER,
  type ChatTextScale,
} from "../../lib/chatTextScale";

type Props = {
  open: boolean;
  onClose: () => void;
  canConvertToMission?: boolean;
  convertBusy?: boolean;
  onConvertToMission?: () => void;
  onDelete?: () => void;
  linkedParentJobId?: string;
  onOpenLinkedMission?: () => void;
  textScale?: ChatTextScale;
  onTextScaleChange?: (scale: ChatTextScale) => void;
};

/** Menu ⋯ conversation mobile. */
export default function ChatThreadMoreSheet({
  open,
  onClose,
  canConvertToMission,
  convertBusy,
  onConvertToMission,
  onDelete,
  linkedParentJobId,
  onOpenLinkedMission,
  textScale = "md",
  onTextScaleChange,
}: Props) {
  const row =
    "flex w-full items-center gap-3 rounded-2xl px-3 py-3.5 text-left text-[15px] font-semibold active:bg-slate-100 disabled:opacity-40";

  return (
    <ChatBottomSheet open={open} onClose={onClose} title="Conversation">
      <div className="space-y-1 pb-2">
        {onTextScaleChange ? (
          <div className="mb-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Taille du texte</p>
            <div className="mt-2 grid grid-cols-3 gap-1.5">
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
                        : "rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-700 active:bg-slate-100"
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

        {canConvertToMission && onConvertToMission ? (
          <button
            type="button"
            disabled={convertBusy}
            className={`${row} text-violet-800`}
            onClick={() => {
              onClose();
              onConvertToMission();
            }}
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-100 text-violet-800" aria-hidden>
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 4v16M5 5h12l-2 4 2 4H5" />
              </svg>
            </span>
            Préparer un travail
          </button>
        ) : null}

        {linkedParentJobId && onOpenLinkedMission ? (
          <button
            type="button"
            className={`${row} text-slate-800`}
            onClick={() => {
              onClose();
              onOpenLinkedMission();
            }}
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-100 text-sky-800" aria-hidden>
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5h11M9 12h11M9 19h11M4 5h.01M4 12h.01M4 19h.01" />
              </svg>
            </span>
            Voir la mission liée
          </button>
        ) : null}

        {onDelete ? (
          <button
            type="button"
            className={`${row} text-red-700`}
            onClick={() => {
              onClose();
              onDelete();
            }}
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-red-50 text-red-700" aria-hidden>
              ×
            </span>
            Supprimer la conversation
          </button>
        ) : null}
      </div>
    </ChatBottomSheet>
  );
}
