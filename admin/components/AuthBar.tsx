"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AuthMeResponse } from "../lib/authSession";

export default function AuthBar() {
  const router = useRouter();
  const menuRef = useRef<HTMLDivElement>(null);
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
    return (
      <div className="flex shrink-0 items-center gap-2">
        <Link
          href="/login"
          className="touch-target inline-flex items-center justify-center rounded-xl px-3 text-sm font-bold text-violet-800 hover:bg-violet-50"
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
      {/* Mobile: single avatar trigger */}
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        className="touch-target inline-flex items-center justify-center rounded-xl border-2 border-slate-200 bg-white px-2.5 text-sm font-extrabold text-violet-800 shadow-sm hover:bg-violet-50 sm:hidden"
        aria-expanded={menuOpen}
        aria-label="Compte"
      >
        {initial}
      </button>

      {/* Desktop: compact identity row */}
      <div className="hidden max-w-[16rem] flex-col items-end gap-0.5 sm:flex lg:max-w-none">
        <p className="truncate text-[10px] font-bold uppercase tracking-wide text-violet-700 sm:text-xs">{wsName}</p>
        <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
          <span className="hidden truncate text-xs text-slate-600 md:inline">{me.user.email}</span>
          <Link href="/profil" className="text-[10px] font-bold text-violet-700 hover:underline sm:text-xs">
            Profil
          </Link>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">{roleLabel}</span>
          {me.role === "admin" ? (
            <Link href="/espace" className="text-[10px] font-bold text-violet-700 hover:underline sm:text-xs">
              Équipe
            </Link>
          ) : null}
          <button
            type="button"
            onClick={() => void logout()}
            className="text-[10px] font-bold text-slate-500 hover:text-red-700 sm:text-xs"
          >
            Déconnexion
          </button>
        </div>
      </div>

      {menuOpen ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-[min(100vw-1.5rem,16rem)] overflow-hidden rounded-2xl border-2 border-slate-200 bg-white shadow-xl sm:hidden"
        >
          <div className="border-b border-slate-100 px-3 py-2.5">
            <p className="truncate text-xs font-extrabold text-slate-950">{wsName}</p>
            <p className="truncate text-[11px] text-slate-500">{me.user.email}</p>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">{roleLabel}</p>
          </div>
          <div className="p-1.5">
            <Link
              href="/profil"
              role="menuitem"
              onClick={() => setMenuOpen(false)}
              className="block rounded-xl px-3 py-2.5 text-sm font-bold text-slate-800 hover:bg-violet-50"
            >
              Profil
            </Link>
            {me.role === "admin" ? (
              <Link
                href="/espace"
                role="menuitem"
                onClick={() => setMenuOpen(false)}
                className="block rounded-xl px-3 py-2.5 text-sm font-bold text-slate-800 hover:bg-violet-50"
              >
                Équipe
              </Link>
            ) : null}
            <button
              type="button"
              role="menuitem"
              onClick={() => void logout()}
              className="block w-full rounded-xl px-3 py-2.5 text-left text-sm font-bold text-red-700 hover:bg-red-50"
            >
              Déconnexion
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
