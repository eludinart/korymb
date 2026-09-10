"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { AuthMeResponse } from "../lib/authSession";

/** Empêche un compte participant d'ouvrir le cockpit dirigeant. */
export default function OperatorGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        if (!res.ok) return;
        const me = (await res.json()) as AuthMeResponse;
        if (cancelled) return;
        if (me.role === "subscriber") {
          const slug = me.workspace?.slug || "espace";
          setRedirecting(true);
          router.replace(`/a/${encodeURIComponent(slug)}`);
        }
      } catch {
        /* session absente : le middleware gère le login */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (redirecting) {
    return <p className="p-8 text-center text-sm text-slate-600">Redirection vers votre espace participant…</p>;
  }
  return <>{children}</>;
}
