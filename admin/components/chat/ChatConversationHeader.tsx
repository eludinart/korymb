"use client";

import Link from "next/link";
import { describeInterlocutor, type GroupOpt } from "./ChatInterlocutorSelect";
import { CHAT_TEXT_SCALE_LABELS, type ChatTextScale } from "../../lib/chatTextScale";

type Props = {
  title: string;
  interlocutor: string;
  groups: GroupOpt[];
  onBack: () => void;
  onOpenFleet: () => void;
  onOpenMore: () => void;
  pending?: boolean;
  textScale?: ChatTextScale;
  onCycleTextScale?: () => void;
};

/** Barre conversation mobile — une ligne, pouce-friendly. */
export default function ChatConversationHeader({
  title,
  interlocutor,
  groups,
  onBack,
  onOpenFleet,
  onOpenMore,
  pending,
  textScale = "sm",
  onCycleTextScale,
}: Props) {
  const info = describeInterlocutor(interlocutor, groups);
  const fleetLabel =
    interlocutor === "assistant"
      ? "Assistant"
      : info.title.length > 18
        ? `${info.title.slice(0, 17)}…`
        : info.title;

  const scaleGlyph =
    textScale === "xs" ? "A−−" : textScale === "sm" ? "A−" : textScale === "lg" ? "A+" : "A";

  return (
    <header className="chat-thread-header flex h-11 shrink-0 items-center gap-0.5 px-1 lg:hidden">
      <button
        type="button"
        onClick={onBack}
        className="flex h-10 w-9 shrink-0 items-center justify-center rounded-full text-slate-800 active:bg-slate-100 dark:text-slate-100 dark:active:bg-slate-800"
        aria-label="Retour aux conversations"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 6 9 12l6 6" />
        </svg>
      </button>

      <Link
        href="/briefing"
        className="flex h-9 shrink-0 items-center rounded-full px-2 text-[11px] font-bold text-violet-800 active:bg-violet-50 dark:text-violet-300 dark:active:bg-violet-950"
        aria-label="Retour à l'accueil Korymb"
      >
        Accueil
      </Link>

      <button
        type="button"
        onClick={onOpenFleet}
        disabled={pending}
        className="min-w-0 flex-1 rounded-xl px-1.5 py-1 text-left active:bg-slate-50 disabled:opacity-50 dark:active:bg-slate-900"
        aria-label={`Interlocuteur : ${fleetLabel}. Changer.`}
      >
        <p className="truncate text-[13px] font-bold leading-tight text-slate-900 dark:text-slate-50">{title}</p>
        <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] font-semibold text-violet-700 dark:text-violet-300">
          <span className="truncate">{fleetLabel}</span>
          <span aria-hidden className="shrink-0 text-[9px] opacity-70">
            ▾
          </span>
        </p>
      </button>

      {onCycleTextScale ? (
        <button
          type="button"
          onClick={onCycleTextScale}
          className="flex h-9 min-w-9 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-extrabold text-slate-700 active:bg-slate-100 dark:text-slate-200 dark:active:bg-slate-800"
          aria-label={`Taille du texte : ${CHAT_TEXT_SCALE_LABELS[textScale]}. Changer.`}
          title={`Texte ${CHAT_TEXT_SCALE_LABELS[textScale]}`}
        >
          {scaleGlyph}
        </button>
      ) : null}

      <button
        type="button"
        onClick={onOpenMore}
        className="flex h-10 w-9 shrink-0 items-center justify-center rounded-full text-slate-700 active:bg-slate-100 dark:text-slate-200 dark:active:bg-slate-800"
        aria-label="Options de la conversation"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
          <circle cx="5" cy="12" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="19" cy="12" r="1.6" />
        </svg>
      </button>
    </header>
  );
}
