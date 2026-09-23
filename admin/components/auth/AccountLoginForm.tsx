"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import { formatHttpApiErrorPayload } from "../../lib/api";

export function AccountLoginForm({
  audience,
  workspaceSlug = "",
}: {
  audience: "operator" | "subscriber";
  workspaceSlug?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const workspace = workspaceSlug || searchParams.get("workspace") || "";
  const next = searchParams.get("next") || "";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const isOperator = audience === "operator";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          audience,
          ...(workspace ? { workspace_id: workspace } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(formatHttpApiErrorPayload(data) || "Connexion impossible.");
        return;
      }
      const role = String(data.role || "");
      const slug = String(data.workspace?.slug || workspace || "");
      if (isOperator) {
        if (next.startsWith("/") && !next.startsWith("/a/") && !next.startsWith("/p/")) {
          router.replace(next);
        } else {
          router.replace("/briefing");
        }
      } else if (next.startsWith("/a/")) {
        router.replace(next);
      } else if (slug) {
        router.replace(`/a/${encodeURIComponent(slug)}`);
      } else {
        router.replace("/");
      }
      void role;
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
        <p className="text-xs font-extrabold uppercase tracking-wider text-violet-700">
          {isOperator ? "Korymb" : "Mon espace"}
        </p>
        <h1 className="mt-2 text-2xl font-extrabold text-slate-900">Connexion</h1>
        <p className="mt-2 text-sm text-slate-600">
          {isOperator
            ? "Aujourd’hui, personnes, calendrier et messages."
            : "Rendez-vous et ressources qui vous sont destinés."}
        </p>
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
        {isOperator ? (
          <p className="mt-4 text-center text-sm text-slate-600">
            <Link href="/" className="font-semibold text-slate-500 hover:text-violet-700">
              ← Accueil Korymb
            </Link>
            <span className="mx-2">·</span>
            Pas encore d’espace ?{" "}
            <Link href="/register" className="font-bold text-violet-700 hover:underline">
              Créer un espace Korymb
            </Link>
            {workspace ? (
              <>
                <span className="mx-2">·</span>
                Vous êtes participant ?{" "}
                <Link
                  href={`/p/${encodeURIComponent(workspace)}/connexion`}
                  className="font-semibold text-emerald-800 hover:underline"
                >
                  Connexion participant
                </Link>
              </>
            ) : null}
          </p>
        ) : (
          <p className="mt-4 text-center text-sm text-slate-600">
            <Link
              href={workspace ? `/p/${encodeURIComponent(workspace)}` : "/"}
              className="font-semibold text-slate-500 hover:text-violet-700"
            >
              ← Vitrine
            </Link>
            <span className="mx-2">·</span>
            Pas encore de compte ?{" "}
            <Link
              href={workspace ? `/p/${encodeURIComponent(workspace)}/inscription` : "/"}
              className="font-bold text-violet-700 hover:underline"
            >
              Demander l’inscription
            </Link>
            <span className="mx-2">·</span>
            Code invité ?{" "}
            <Link
              href={workspace ? `/p/${encodeURIComponent(workspace)}/invitation` : "/"}
              className="font-bold text-emerald-800 hover:underline"
            >
              Première connexion
            </Link>
            <span className="mx-2">·</span>
            Vous pilotez l’activité ?{" "}
            <Link href="/login" className="font-semibold text-violet-800 hover:underline">
              Connexion Korymb
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}

export default function AccountLoginFormSuspense(props: { audience: "operator" | "subscriber"; workspaceSlug?: string }) {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-500">Chargement…</div>}>
      <AccountLoginForm {...props} />
    </Suspense>
  );
}
