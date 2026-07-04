"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import { formatHttpApiErrorPayload } from "../../lib/api";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/briefing";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(formatHttpApiErrorPayload(data) || "Connexion impossible.");
        return;
      }
      router.replace(next.startsWith("/") ? next : "/dashboard");
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
        <h1 className="mt-2 text-2xl font-extrabold text-slate-900">Connexion</h1>
        <p className="mt-2 text-sm text-slate-600">Accédez à votre espace de gestion Korymb.</p>
        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
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
            Mot de passe
            <input
              type="password"
              required
              autoComplete="current-password"
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
            {loading ? "Connexion…" : "Se connecter"}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-slate-600">
          <Link href="/" className="font-semibold text-slate-500 hover:text-violet-700">
            ← Accueil
          </Link>
          <span className="mx-2">·</span>
          Pas encore de compte ?{" "}
          <Link href="/register" className="font-bold text-violet-700 hover:underline">
            Créer mon Korymb
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-500">Chargement…</div>}>
      <LoginForm />
    </Suspense>
  );
}
