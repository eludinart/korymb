"use client";

type Props = {
  title: string;
  onBack: () => void;
  onOpenMore: () => void;
  subtitle?: string;
};

/** Barre conversation — titre et menu. Le choix d'équipe est dans le menu. */
export default function ChatConversationHeader({ title, onBack, onOpenMore, subtitle }: Props) {
  return (
    <header data-pull-refresh="" className="chat-thread-header flex h-11 shrink-0 items-center gap-0.5 px-1">
      <button
        type="button"
        onClick={onBack}
        className="flex h-10 w-9 shrink-0 items-center justify-center rounded-full text-slate-800 active:bg-slate-100 dark:text-slate-100 dark:active:bg-slate-800 lg:hidden"
        aria-label="Retour aux conversations"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 6 9 12l6 6" />
        </svg>
      </button>

      <div className="min-w-0 flex-1 px-1.5 py-1">
        <p className="truncate text-[13px] font-bold leading-tight text-slate-900 dark:text-slate-50">{title}</p>
        {subtitle ? (
          <p className="truncate text-[11px] font-semibold text-violet-700 dark:text-violet-300">{subtitle}</p>
        ) : null}
      </div>

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
