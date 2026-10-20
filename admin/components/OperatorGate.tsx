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
    return <p className="p-8 text-center text-sm text-slate-600">Ouverture…</p>;
  }
  return <>{children}</>;
}
