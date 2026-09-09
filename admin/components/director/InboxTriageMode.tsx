"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import InboxActionCard, { type InboxActionItem } from "./InboxActionCard";
import { filterSnoozedItems, snoozeInboxItem } from "../../lib/inboxSnooze";
import { inboxItemKey, sortInboxItems } from "../../lib/inboxDisplay";

type Props = {
  items: InboxActionItem[];
  onDismissed?: () => void;
};

function stableInboxKey(item: InboxActionItem, index: number): string {
  return (
    item.job_id ||
    item.ticket_id ||
    item.output_id ||
    item.suggestion_id ||
    inboxItemKey(item, index)
  );
}

export default function InboxTriageMode({ items, onDismissed }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const focusParam = (searchParams.get("focus") || "").trim();

  const [doneKeys, setDoneKeys] = useState<Set<string>>(() => new Set());

  const sorted = useMemo(() => {
    const base = sortInboxItems(filterSnoozedItems(items), "priority_desc");
    return base.filter((it, i) => !doneKeys.has(stableInboxKey(it, i)));
  }, [items, doneKeys]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!focusParam || !sorted.length) return;
    const idx = sorted.findIndex(
      (it, i) =>
        it.job_id === focusParam ||
        it.ticket_id === focusParam ||
        it.output_id === focusParam ||
        it.suggestion_id === focusParam ||
        inboxItemKey(it, i) === focusParam,
    );
    if (idx >= 0) setIndex(idx);
  }, [focusParam, sorted]);

  useEffect(() => {
    if (index > 0 && index >= sorted.length) {
      setIndex(Math.max(0, sorted.length - 1));
    }
  }, [index, sorted.length]);

  const current = sorted[index];
  const total = sorted.length;
  const done = total === 0;

  const goNext = useCallback(() => {
    setIndex((i) => Math.min(i + 1, Math.max(0, total - 1)));
  }, [total]);

  const goPrev = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  const exitTriage = useCallback(() => {
    router.push("/inbox");
  }, [router]);

  const markCurrentDoneLocally = useCallback(() => {
    if (!current) return;
    const key = stableInboxKey(current, index);
    setDoneKeys((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, [current, index]);

  const snoozeCurrent = useCallback(() => {
    if (!current) return;
    snoozeInboxItem(current, index, 24);
    markCurrentDoneLocally();
    onDismissed?.();
  }, [current, index, markCurrentDoneLocally, onDismissed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Escape") {
        e.preventDefault();
        exitTriage();
      }
      if (e.key === "j" || e.key === "J") {
        e.preventDefault();
        goNext();
      }
      if (e.key === "k" || e.key === "K") {
        e.preventDefault();
        goPrev();
      }
      if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        snoozeCurrent();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [exitTriage, goNext, goPrev, snoozeCurrent]);

  if (done) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
        <div className="max-w-md rounded-3xl border-2 border-emerald-300 bg-white p-8 text-center shadow-2xl">
          <p className="text-4xl">✓</p>
          <h2 className="mt-3 text-2xl font-extrabold text-slate-900">Inbox vide</h2>
          <p className="mt-2 text-sm text-slate-600">Toutes vos décisions sont traitées. Bonne journée.</p>
          <button
            type="button"
            onClick={() => router.push("/briefing")}
            className="mt-6 rounded-2xl bg-violet-700 px-6 py-3 text-sm font-bold text-white hover:bg-violet-800"
          >
            Retour au briefing
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-900/70 backdrop-blur-sm">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-violet-300">Mode triage</p>
          <p className="text-sm font-semibold text-white">
            {index + 1} / {total}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold text-slate-300">
          <kbd className="rounded bg-white/10 px-1.5 py-0.5">J</kbd> suivant
          <kbd className="rounded bg-white/10 px-1.5 py-0.5">K</kbd> précédent
          <kbd className="rounded bg-white/10 px-1.5 py-0.5">S</kbd> reporter
          <kbd className="rounded bg-white/10 px-1.5 py-0.5">Esc</kbd> quitter
        </div>
        <button
          type="button"
          onClick={exitTriage}
          className="rounded-xl border border-white/20 px-3 py-1.5 text-sm font-bold text-white hover:bg-white/10"
        >
          Quitter
        </button>
      </header>

      <div className="flex flex-1 items-start justify-center overflow-y-auto p-4 sm:p-8">
        <div className="w-full max-w-2xl">
          {current ? (
            <InboxActionCard
              key={stableInboxKey(current, index)}
              item={current}
              defaultExpanded
              onDismissed={() => {
                markCurrentDoneLocally();
                onDismissed?.();
              }}
            />
          ) : null}
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              disabled={index <= 0}
              onClick={goPrev}
              className="rounded-xl border-2 border-white/30 bg-white/10 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
            >
              ← Précédent
            </button>
            <button
              type="button"
              onClick={snoozeCurrent}
              className="rounded-xl border-2 border-amber-300/50 bg-amber-500/20 px-4 py-2 text-sm font-bold text-amber-100"
            >
              Reporter 24 h
            </button>
            <button
              type="button"
              disabled={index >= total - 1}
              onClick={goNext}
              className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
            >
              Suivant →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
