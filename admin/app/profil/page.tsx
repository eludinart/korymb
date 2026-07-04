"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { agentHeaders, formatHttpApiErrorPayload, requestJson } from "../../lib/api";
import type { AuthMeResponse } from "../../lib/authSession";

export default function ProfilPage() {
  const [me, setMe] = useState<AuthMeResponse | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      if (!res.ok) {
        setMe(null);
        return;
      }
      const data = (await res.json()) as AuthMeResponse;
      setMe(data);
      setDisplayName(data.user?.display_name || "");
      setWorkspaceName(data.workspace?.name || "");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const { res, data } = await requestJson("/auth/profile", {
        method: "PATCH",
        headers: agentHeaders(),
        body: JSON.stringify({
          display_name: displayName,
          workspace_name: workspaceName,
        }),
      });
      if (!res.ok) throw new Error(formatHttpApiErrorPayload(data) || "Enregistrement impossible.");
      setMessage("Profil mis à jour.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setSaving(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
  }

  if (loading) {
    return <p className="text-sm text-slate-500">Chargement du profil…</p>;
  }

  if (!me?.user) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-950">
        Connectez-vous pour accéder à votre profil.{" "}
        <Link href="/login" className="font-bold text-violet-800 underline">
          Connexion
        </Link>
      </div>
    );
  }

  const roleLabel = me.role === "admin" ? "Administrateur" : "Utilisateur";

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <header>
        <h1 className="text-2xl font-extrabold text-slate-900">Mon profil</h1>
        <p className="mt-1 text-sm text-slate-600">{me.user.email}</p>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-full bg-violet-100 px-3 py-1 font-bold text-violet-900">{roleLabel}</span>
          <span className="text-slate-500">Espace : {me.workspace?.name || "—"}</span>
        </div>
        <form className="mt-6 space-y-4" onSubmit={onSave}>
          <label className="block text-sm font-semibold text-slate-700">
            Nom affiché
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
            />
          </label>
          {me.role === "admin" ? (
            <label className="block text-sm font-semibold text-slate-700">
              Nom de l&apos;espace Korymb
              <input
                type="text"
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
              />
            </label>
          ) : null}
          {message ? <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{message}</p> : null}
          {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-violet-700 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60"
          >
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </form>
      </section>

      <section className="flex flex-wrap gap-3">
        <Link href="/briefing" className="rounded-xl border-2 border-violet-300 px-4 py-2.5 text-sm font-bold text-violet-800 hover:bg-violet-50">
          Ouvrir le cockpit
        </Link>
        {me.role === "admin" ? (
          <Link href="/espace" className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Gérer l&apos;équipe
          </Link>
        ) : null}
        <button type="button" onClick={() => void logout()} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50">
          Déconnexion
        </button>
      </section>
    </div>
  );
}
