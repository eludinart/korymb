"use client";

import { useEffect, useId, useRef, useState } from "react";

export default function TaskActionMenu({
  title,
  pending,
  onEdit,
  onDelete,
}: {
  title: string;
  pending: boolean;
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
      className="relative shrink-0"
      onMouseEnter={() => {
        if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) setHover(true);
      }}
      onMouseLeave={() => setHover(false)}
    >
      <button
        type="button"
        className="inline-flex size-11 items-center justify-center rounded-lg text-lg font-bold leading-none text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
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
          className="absolute right-0 top-full z-30 w-44 rounded-xl border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          <button
            type="button"
            role="menuitem"
            className="flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm font-semibold text-slate-800 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800"
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
            className="flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm font-semibold text-red-800 hover:bg-red-50 dark:text-red-200 dark:hover:bg-red-950"
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
