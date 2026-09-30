"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AuthMeResponse } from "../lib/authSession";

export default function AuthBar() {
  const router = useRouter();
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [me, setMe] = useState<AuthMeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      if (res.ok) {
        setMe((await res.json()) as AuthMeResponse);
      } else {
        setMe(null);
      }
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  /** Évite le clip à gauche (html/body overflow-x:hidden) sur mobile. */
  useLayoutEffect(() => {
    if (!menuOpen) return;
    const btn = buttonRef.current;
    const panel = panelRef.current;
    if (!btn || !panel) return;

    const place = () => {
      const r = btn.getBoundingClientRect();
      const pad = 12;
      const width = Math.min(256, window.innerWidth - pad * 2);
      let left = r.right - width;
      left = Math.max(pad, Math.min(left, window.innerWidth - width - pad));
      const top = Math.min(r.bottom + 8, window.innerHeight - 8);
      panel.style.position = "fixed";
      panel.style.top = `${Math.max(pad, top)}px`;
      panel.style.left = `${left}px`;
      panel.style.width = `${width}px`;
      panel.style.right = "auto";
      panel.style.margin = "0";
    };

    place();
    window.addEventListener("resize", place);
    window.visualViewport?.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [menuOpen]);

  async function logout() {
    setMenuOpen(false);
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/");
    router.refresh();
  }

  if (loading) {
    return <span className="hidden text-xs text-slate-500 sm:inline">…</span>;
  }

  if (!me?.user) {
    const agentMode = me?.mode === "agent_secret" || me?.role === "admin";
    return (
      <div className="flex shrink-0 items-center gap-2">
        {agentMode ? (
          <span
            className="hidden rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300 sm:inline"
            title="Accès local via secret agent — connectez un compte pour le profil dirigeant"
          >
            Mode agent
          </span>
        ) : null}
        <Link
          href="/login"
          className="touch-target inline-flex items-center justify-center rounded-xl px-3 text-sm font-bold text-violet-800 hover:bg-violet-50 dark:text-violet-200 dark:hover:bg-violet-950"
        >
          Connexion
        </Link>
      </div>
    );
  }

  const wsName = me.workspace?.name || "Mon Korymb";
  const roleLabel = me.role === "admin" ? "Admin" : "Utilisateur";
  const initial = (me.user.email || "U").slice(0, 1).toUpperCase();

  return (
    <div className="relative shrink-0" ref={menuRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        className="touch-target inline-flex max-w-[12rem] items-center gap-2 rounded-xl border-2 border-slate-200 bg-white px-2.5 text-sm font-extrabold text-violet-800 shadow-sm hover:bg-violet-50 dark:border-slate-600 dark:bg-slate-900 dark:text-violet-200 dark:hover:bg-slate-800 sm:max-w-[16rem] sm:px-3"
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        aria-label="Compte"
      >
        <span className="hidden min-w-0 truncate text-[11px] font-bold uppercase tracking-wide sm:inline">
          {wsName}
        </span>
        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-xs dark:bg-violet-900 dark:text-violet-100">
          {initial}
        </span>
      </button>

      {menuOpen ? (
        <div
          ref={panelRef}
          role="menu"
          className="z-[80] overflow-hidden rounded-2xl border-2 border-slate-200 bg-white shadow-xl dark:border-slate-600 dark:bg-slate-900"
        >
          <div className="border-b border-slate-100 px-3 py-2.5 dark:border-slate-700">
            <p className="truncate text-xs font-extrabold text-slate-950 dark:text-slate-50">{wsName}</p>
            <p className="truncate text-[11px] text-slate-600 dark:text-slate-300">{me.user.email}</p>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {roleLabel}
            </p>
          </div>
          <div className="p-1.5">
            <Link
              href="/profil"
              role="menuitem"
              onClick={() => setMenuOpen(false)}
              className="block rounded-xl px-3 py-2.5 text-sm font-bold text-slate-800 hover:bg-violet-50 dark:text-slate-100 dark:hover:bg-violet-950"
            >
              Profil
            </Link>
            {me.workspace?.slug ? (
              <Link
                href={`/a/${encodeURIComponent(me.workspace.slug)}`}
                role="menuitem"
                onClick={() => setMenuOpen(false)}
                className="block rounded-xl px-3 py-2.5 text-sm font-bold text-slate-800 hover:bg-emerald-50 dark:text-slate-100 dark:hover:bg-emerald-950"
              >
                Espace participant
              </Link>
            ) : null}
            {me.role === "admin" ? (
              <Link
                href="/espace"
                role="menuitem"
                onClick={() => setMenuOpen(false)}
                className="block rounded-xl px-3 py-2.5 text-sm font-bold text-slate-800 hover:bg-violet-50 dark:text-slate-100 dark:hover:bg-violet-950"
              >
                Équipe
              </Link>
            ) : null}
            <button
              type="button"
              role="menuitem"
              onClick={() => void logout()}
              className="block w-full rounded-xl px-3 py-2.5 text-left text-sm font-bold text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950"
            >
              Déconnexion
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
