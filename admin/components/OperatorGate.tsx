"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { AuthMeResponse } from "../lib/authSession";

/** Le cockpit n'existe qu'avec une session. Sinon, retour à la landing. */
export default function OperatorGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        if (cancelled) return;
        if (!res.ok) {
          window.location.replace("/");
          return;
        }
        const me = (await res.json()) as AuthMeResponse;
        if (cancelled) return;
        if (me.role === "subscriber") {
          const slug = me.workspace?.slug || "espace";
          router.replace(`/a/${encodeURIComponent(slug)}`);
          return;
        }
        if (!me.user && me.mode !== "agent_secret") {
          window.location.replace("/");
          return;
        }
        setOpen(true);
      } catch {
        if (!cancelled) window.location.replace("/");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!open) {
    return (
      <div className="min-h-dvh" aria-busy="true" aria-live="polite">
        <div className="border-b border-slate-200/80 bg-white/80 px-5 py-3 backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/80">
          <div className="h-6 w-28 animate-pulse rounded-md bg-slate-200 dark:bg-slate-800" />
        </div>
        <p className="px-5 py-8 text-sm font-semibold text-slate-700 dark:text-slate-200">Ouverture de la session…</p>
      </div>
    );
  }
  return <>{children}</>;
}
