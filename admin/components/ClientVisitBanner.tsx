"use client";

import { useState } from "react";
import { formatHttpApiErrorPayload } from "../lib/api";
import { useUiMode } from "../lib/uiMode";

/** Bandeau fixe : le profil Élude consulte l'espace d'un client, sans se confondre avec lui. */
export default function ClientVisitBanner() {
  const { visitingClientSpace, homeWorkspaceId, workspaceName, accountEmail, loading } = useUiMode();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (loading || !visitingClientSpace) return null;

  const space = workspaceName || "cet espace";

  async function returnHome() {
    if (!homeWorkspaceId || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/switch-workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace_id: homeWorkspaceId, next: "/briefing" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(formatHttpApiErrorPayload(data) || "Retour impossible.");
      }
      window.location.assign(String(data.redirect || "/briefing"));
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "Retour impossible.");
    }
  }

  return (
    <div className="border-b-2 border-amber-400 bg-amber-50 text-amber-950 dark:border-amber-600 dark:bg-amber-950 dark:text-amber-50">
      <div className="flex w-full flex-wrap items-center justify-between gap-3 px-3 py-2.5 sm:px-5 lg:px-6 xl:px-8">
        <div className="min-w-0">
          <p className="text-[11px] font-extrabold uppercase tracking-wider text-amber-800 dark:text-amber-200">
            Profil Élude · administrateur
          </p>
          <p className="mt-0.5 text-sm font-semibold">
            Vous consultez l&apos;espace « {space} ». Les données affichées sont celles de ce client.
            {accountEmail ? ` Votre session reste ${accountEmail}.` : ""}
          </p>
          {error ? <p className="mt-1 text-sm font-semibold text-red-700 dark:text-red-300">{error}</p> : null}
        </div>
        <button
          type="button"
          disabled={busy || !homeWorkspaceId}
          onClick={() => void returnHome()}
          className="shrink-0 rounded-xl bg-amber-800 px-4 py-2 text-sm font-bold text-white hover:bg-amber-900 disabled:opacity-60"
        >
          {busy ? "Retour…" : "Revenir à mon espace"}
        </button>
      </div>
    </div>
  );
}
