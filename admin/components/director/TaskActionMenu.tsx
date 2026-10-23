"use client";

import { useEffect, useId, useRef, useState } from "react";

export default function TaskActionMenu({
  title,
  pending,
  urgent = false,
  important = false,
  onUrgent,
  onImportant,
  onEdit,
  onDelete,
}: {
  title: string;
  pending: boolean;
  urgent?: boolean;
  important?: boolean;
  onUrgent?: () => void;
  onImportant?: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [pinned, setPinned] = useState(false);
  const [hover, setHover] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const open = pinned || hover;

  useEffect(() => {
    if (!pinned) return;
    const onPointer = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setPinned(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPinned(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [pinned]);

  const close = () => {
    setPinned(false);
    setHover(false);
  };

  return (
    <div
      ref={root}
      className="relative shrink-0 opacity-70 transition-opacity focus-within:opacity-100 hover:opacity-100 has-[[aria-expanded=true]]:opacity-100"
      onMouseEnter={() => {
        if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) setHover(true);
      }}
      onMouseLeave={() => setHover(false)}
    >
      <button
        type="button"
        className={`inline-flex size-8 items-center justify-center rounded-md text-base font-bold leading-none hover:bg-slate-100 dark:hover:bg-slate-800 ${
          urgent
            ? "text-rose-700 dark:text-rose-300"
            : important
              ? "text-amber-800 dark:text-amber-200"
              : "text-slate-500 dark:text-slate-400"
        }`}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={menuId}
        aria-label={`Actions pour « ${title} »`}
        onClick={() => setPinned((value) => !value)}
      >
        ⋯
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          className="absolute right-0 top-full z-30 w-44 rounded-lg border border-slate-200 bg-white p-0.5 shadow-md dark:border-slate-700 dark:bg-slate-900"
        >
          {onUrgent ? (
            <button
              type="button"
              role="menuitem"
              className="flex min-h-9 w-full items-center rounded-md px-2.5 text-left text-xs font-semibold text-slate-800 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800"
              disabled={pending}
              onClick={() => {
                close();
                onUrgent();
              }}
            >
              {urgent ? "Retirer l'urgence" : "Marquer urgent"}
            </button>
          ) : null}
          {onImportant ? (
            <button
              type="button"
              role="menuitem"
              className="flex min-h-9 w-full items-center rounded-md px-2.5 text-left text-xs font-semibold text-slate-800 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800"
              disabled={pending}
              onClick={() => {
                close();
                onImportant();
              }}
            >
              {important ? "Retirer l'importance" : "Marquer important"}
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className="flex min-h-9 w-full items-center rounded-md px-2.5 text-left text-xs font-semibold text-slate-800 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800"
            disabled={pending}
            onClick={() => {
              close();
              onEdit();
            }}
          >
            Modifier
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex min-h-9 w-full items-center rounded-md px-2.5 text-left text-xs font-semibold text-red-800 hover:bg-red-50 dark:text-red-200 dark:hover:bg-red-950"
            disabled={pending}
            onClick={() => {
              close();
              onDelete();
            }}
          >
            Supprimer
          </button>
        </div>
      ) : null}
    </div>
  );
}
