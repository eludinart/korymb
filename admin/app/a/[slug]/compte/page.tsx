"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { agentHeaders, formatHttpApiErrorPayload, requestJson } from "../../../../lib/api";
import { accountDisplayName, type AuthMeResponse } from "../../../../lib/authSession";
import { useSubscriberSpace } from "../../../../lib/subscriberHome";
import { SessionList } from "../../../../components/espace/SubscriberLists";

export default function SubscriberComptePage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const home = useSubscriberSpace(slug);
  const [me, setMe] = useState<AuthMeResponse | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
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
      const body: Record<string, string> = { display_name: displayName };
      if (newPassword) {
        body.current_password = currentPassword;
        body.new_password = newPassword;
      }
      const { res, data } = await requestJson("/auth/profile", {
        method: "PATCH",
        headers: agentHeaders(),
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(formatHttpApiErrorPayload(data) || "Enregistrement impossible.");
      setMessage(newPassword ? "Profil et mot de passe mis à jour." : "Profil mis à jour.");
      setCurrentPassword("");
      setNewPassword("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setSaving(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/");
    router.refresh();
  }

  if (loading) {
    return <p className="text-sm text-slate-500">Chargement du compte…</p>;
  }

  if (!me?.user) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-950">
        Connectez-vous pour accéder à votre compte.{" "}
        <Link href="/login" className="font-bold underline" style={{ color: "var(--practice-ink)" }}>
          Connexion
        </Link>
      </div>
    );
  }

  const isOperator = me.role === "admin" || me.role === "member";
  const destSlug = me.workspace?.slug || slug || "";
  const practiceName = home.data?.name || me.workspace?.name || "cet espace";
  const userName = accountDisplayName(me);

  return (
    <div className="space-y-8">
      <header>
        <p className="practice-kicker">Chez {practiceName}</p>
        <h1 className="practice-heading mt-2 text-3xl font-extrabold">{userName || "Mon compte"}</h1>
        <p className="mt-2 text-slate-600">{me.user.email}</p>
      </header>

      <section className="practice-card p-5">
        <h2 className="text-lg font-bold text-slate-900">Mes inscriptions</h2>
        <p className="mt-1 text-sm text-slate-600">Séances, ateliers et visios qui vous concernent.</p>
        {home.isLoading ? <p className="mt-3 text-sm text-slate-500">Chargement…</p> : <SessionList events={home.data?.events || []} />}
      </section>

      <section className="practice-card p-5">
        <form className="space-y-4" onSubmit={onSave}>
          <label className="block text-sm font-semibold text-slate-700">
            Nom affiché
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
            />
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            Mot de passe actuel
            <input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
            />
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            Nouveau mot de passe
            <input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={8}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
            />
          </label>
          <p className="text-xs text-slate-500">Laissez les mots de passe vides pour ne changer que le nom.</p>
          {message ? <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{message}</p> : null}
          {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
          <button type="submit" disabled={saving} className="btn-practice disabled:opacity-60">
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </form>
      </section>

      <section className="flex flex-wrap gap-3">
        {destSlug ? (
          <Link href={`/p/${encodeURIComponent(destSlug)}`} className="btn-practice-secondary px-4 py-2.5 text-sm">
            Page publique
          </Link>
        ) : null}
        {isOperator ? (
          <Link href="/briefing" className="rounded-xl border-2 border-violet-300 px-4 py-2.5 text-sm font-bold text-violet-800 hover:bg-violet-50">
            Cockpit dirigeant
          </Link>
        ) : null}
        <button type="button" onClick={() => void logout()} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50">
          Déconnexion
        </button>
      </section>
    </div>
  );
}
