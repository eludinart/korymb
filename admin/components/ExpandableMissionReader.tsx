"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Props = {
  title: string;
  hint?: string | null;
  badge?: string | null;
  children: ReactNode;
  className?: string;
  /** Colonne pleine hauteur (desktop) : corps scrollable dans le parent. */
  fillColumn?: boolean;
};

/**
 * Coque lecture « Agrandir / Réduire » (plein écran via portail), même UX que le fil de cadrage CIO.
 */
export default function ExpandableMissionReader({
  title,
  hint,
  badge,
  children,
  className = "",
  fillColumn = false,
}: Props) {
  const [readerOpen, setReaderOpen] = useState(false);

  useEffect(() => {
    if (!readerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [readerOpen]);

  const outerFlex = fillColumn || readerOpen;
  const panelRootClass = outerFlex
    ? "flex min-h-0 flex-1 flex-col overflow-hidden"
    : "flex flex-col overflow-hidden";

  const renderPanelInner = () => (
    <div className={panelRootClass}>
      <div className="flex shrink-0 items-start justify-between gap-2 border-b border-slate-100 px-3 py-2 sm:px-4">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{title}</p>
          {hint ? (
            <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-slate-500" title={hint}>
              {hint}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {badge ? (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
              {badge}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => setReaderOpen((v) => !v)}
            className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-50"
          >
            {readerOpen ? "Réduire" : "Agrandir"}
          </button>
        </div>
      </div>
      <div
        className={
          outerFlex
            ? "min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-3 py-3 sm:px-4"
            : "max-h-[min(72vh,52rem)] space-y-4 overflow-y-auto overflow-x-hidden px-3 py-3 sm:px-4"
        }
      >
        {children}
      </div>
    </div>
  );

  const shellClass = `rounded-xl border border-slate-200 bg-white overflow-hidden flex flex-col ${
    outerFlex ? "h-full min-h-0" : ""
  } ${fillColumn && !readerOpen ? "min-h-0 flex-1" : ""} ${className}`;

  const expandedShellClass =
    "fixed inset-x-2 inset-y-4 z-[210] flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white pb-safe shadow-2xl sm:inset-4";

  const backdrop =
    readerOpen && typeof document !== "undefined"
      ? createPortal(
          <div
            className="fixed inset-0 z-[200] bg-slate-950/50"
            aria-hidden
            onClick={() => setReaderOpen(false)}
          />,
          document.body,
        )
      : null;

  return (
    <>
      {backdrop}
      {readerOpen ? (
        typeof document !== "undefined"
          ? createPortal(
              <div
                key="expandable-reader-expanded"
                role="dialog"
                aria-modal="true"
                aria-label={`${title} — vue agrandie`}
                className={expandedShellClass}
              >
                {renderPanelInner()}
              </div>,
              document.body,
            )
          : null
      ) : (
        <div key="expandable-reader-inline" className={shellClass}>
          {renderPanelInner()}
        </div>
      )}
    </>
  );
}
