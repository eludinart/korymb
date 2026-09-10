"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { agentHeaders, requestJson } from "../../../../../lib/api";

function OAuthCallbackInner() {
  const router = useRouter();
  const search = useSearchParams();
  const [status, setStatus] = useState("Connexion en cours…");
  const [error, setError] = useState("");

  useEffect(() => {
    const denied = search.get("error");
    const code = search.get("code") || "";
    const state = search.get("state") || "";
    if (denied) {
      setError("Connexion annulée chez le fournisseur.");
      return;
    }
    if (!code || !state) {
      setError("Retour OAuth incomplet.");
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await requestJson("/admin/integrations/oauth/finish", {
          method: "POST",
          headers: agentHeaders(),
          body: JSON.stringify({ code, state }),
        });
        if (cancelled) return;
        const provider = String((data as { provider?: string }).provider || "google");
        const group = provider === "linkedin" ? "linkedin_publish" : "google";
        router.replace(`/administration/integrations?group=${group}&oauth=ok`);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Impossible d’enregistrer le jeton.");
        setStatus("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, search]);

  return (
    <div className="mx-auto max-w-lg px-4 py-16 text-center">
      {error ? (
        <>
          <h1 className="text-xl font-bold text-slate-900">Connexion interrompue</h1>
          <p className="mt-3 text-sm text-red-700">{error}</p>
          <a href="/administration/integrations" className="btn-link-primary mt-6 inline-flex">
            Retour aux intégrations
          </a>
        </>
      ) : (
        <>
          <h1 className="text-xl font-bold text-slate-900">Connexion au fournisseur</h1>
          <p className="mt-3 text-sm text-slate-600">{status}</p>
        </>
      )}
    </div>
  );
}

export default function IntegrationOAuthCallbackPage() {
  return (
    <Suspense fallback={<p className="px-4 py-16 text-center text-sm text-slate-500">Chargement…</p>}>
      <OAuthCallbackInner />
    </Suspense>
  );
}
