"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { AuthMeResponse } from "../lib/authSession";

export default function PublicShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "";
  const [me, setMe] = useState<AuthMeResponse | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      setMe(res.ok ? ((await res.json()) as AuthMeResponse) : null);
    } catch {
      setMe(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, pathname]);

  const loggedIn = Boolean(me?.user);

  return (
    <div className="min-h-screen bg-gradient-to-b from-violet-50 via-white to-slate-50">
      <header className="border-b border-violet-100 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link href="/" className="app-brand text-lg">
            Korymb
          </Link>
          <nav className="flex items-center gap-2 sm:gap-3">
            {loggedIn ? (
              <>
                <Link href="/profil" className="rounded-full px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-violet-50">
                  Profil
                </Link>
                <Link href="/briefing" className="rounded-full bg-violet-700 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-violet-800">
                  Mon cockpit
                </Link>
              </>
            ) : (
              <>
                <Link href="/login" className="rounded-full px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-violet-50">
                  Connexion
                </Link>
                <Link href="/register" className="rounded-full bg-violet-700 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-violet-800">
                  Créer mon Korymb
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>
      <main>{children}</main>
      <footer className="border-t border-slate-200 bg-white/60 py-8 text-center text-xs text-slate-500">
        Korymb — cockpit agentique pour piloter votre activité
      </footer>
    </div>
  );
}
