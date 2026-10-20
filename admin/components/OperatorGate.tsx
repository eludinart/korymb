"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { AUTH_ME_QUERY_KEY, fetchAuthMe } from "../lib/uiMode";

function SessionSkeleton() {
  return (
    <div className="min-h-dvh" aria-busy="true" aria-live="polite">
      <div className="border-b border-slate-200/80 bg-white/80 px-5 py-3 backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/80">
        <div className="h-6 w-28 animate-pulse rounded-md bg-slate-200 dark:bg-slate-800" />
      </div>
      <p className="px-5 py-8 text-sm font-semibold text-slate-700 dark:text-slate-200">Ouverture de la session…</p>
    </div>
  );
}

/** Le cockpit n'existe qu'avec une session. Sinon, retour à la landing.

Les enfants sont montés pendant le chargement pour que leurs lectures partent
en même temps que /api/auth/me, pas après. */
export default function OperatorGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const me = useQuery({
    queryKey: AUTH_ME_QUERY_KEY,
    queryFn: fetchAuthMe,
    staleTime: 60_000,
    retry: false,
  });

  useEffect(() => {
    if (!me.isFetched) return;
    const data = me.data;
    if (me.isError || !data) {
      window.location.replace("/");
      return;
    }
    if (data.role === "subscriber") {
      const slug = data.workspace?.slug || "espace";
      router.replace(`/a/${encodeURIComponent(slug)}`);
      return;
    }
    if (!data.user && data.mode !== "agent_secret") {
      window.location.replace("/");
    }
  }, [me.isFetched, me.isError, me.data, router]);

  const data = me.data;
  const allowed = Boolean(
    data && data.role !== "subscriber" && (data.user || data.mode === "agent_secret"),
  );

  if (me.isFetched && !allowed) {
    return <SessionSkeleton />;
  }

  return (
    <>
      {allowed ? null : <SessionSkeleton />}
      <div className={allowed ? "contents" : "hidden"} aria-hidden={allowed ? undefined : true}>
        {children}
      </div>
    </>
  );
}
