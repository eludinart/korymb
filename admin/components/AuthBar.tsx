"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { AuthMeResponse } from "../lib/authSession";

export default function AuthBar() {
  const router = useRouter();
  const [me, setMe] = useState<AuthMeResponse | null>(null);
  const [loading, setLoading] = useState(true);

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

  async function logout() {
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
        <Link href="/login" className="rounded-full px-2 py-1 text-xs font-bold text-violet-800 hover:bg-violet-50 sm:text-sm">
          Connexion
        </Link>
      </div>
    );
  }

  const wsName = me.workspace?.name || "Mon Korymb";
  const roleLabel = me.role === "admin" ? "Admin" : "Utilisateur";

  return (
    <div className="flex max-w-[12rem] shrink-0 flex-col items-end gap-0.5 sm:max-w-none">
      <p className="truncate text-[10px] font-bold uppercase tracking-wide text-violet-700 sm:text-xs">{wsName}</p>
      <div className="flex items-center gap-2">
        <span className="hidden truncate text-xs text-slate-600 sm:inline">{me.user.email}</span>
        <Link href="/profil" className="text-[10px] font-bold text-violet-700 hover:underline sm:text-xs">
          Profil
        </Link>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">{roleLabel}</span>
        {me.role === "admin" ? (
          <Link href="/espace" className="text-[10px] font-bold text-violet-700 hover:underline sm:text-xs">
            Équipe
          </Link>
        ) : null}
        <button type="button" onClick={() => void logout()} className="text-[10px] font-bold text-slate-500 hover:text-red-700 sm:text-xs">
          Déconnexion
        </button>
      </div>
    </div>
  );
}
