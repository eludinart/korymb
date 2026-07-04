"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { formatHttpApiErrorPayload } from "../../lib/api";

export default function RegisterPage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          display_name: displayName,
          workspace_name: workspaceName || displayName || "Mon Korymb",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(formatHttpApiErrorPayload(data) || "Inscription impossible.");
        return;
      }
      router.replace("/briefing?welcome=1");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur réseau.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center gap-6 px-4">
      <div className="rounded-2xl border-2 border-violet-200 bg-white p-6 shadow-lg sm:p-8">
        <p className="text-xs font-extrabold uppercase tracking-wider text-violet-700">Korymb</p>
        <h1 className="mt-2 text-2xl font-extrabold text-slate-900">Créer mon Korymb</h1>
        <p className="mt-2 text-sm text-slate-600">
          Votre espace vierge de gestion d&apos;activité — missions, chat, livrables.
        </p>
        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <label className="block text-sm font-semibold text-slate-700">
            Nom affiché
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
              placeholder="Prénom ou entreprise"
            />
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            Nom de l&apos;espace Korymb
            <input
              type="text"
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
              placeholder="Mon activité"
            />
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            E-mail
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
            />
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            Mot de passe (8 caractères min.)
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
            />
          </label>
          {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-violet-700 px-4 py-3 text-sm font-bold text-white hover:bg-violet-800 disabled:opacity-60"
          >
            {loading ? "Création…" : "Créer mon espace"}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-slate-600">
          <Link href="/" className="font-semibold text-slate-500 hover:text-violet-700">
            ← Accueil
          </Link>
          <span className="mx-2">·</span>
          Déjà inscrit ?{" "}
          <Link href="/login" className="font-bold text-violet-700 hover:underline">
            Se connecter
          </Link>
        </p>
      </div>
    </div>
  );
}
