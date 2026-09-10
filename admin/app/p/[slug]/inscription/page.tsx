"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatHttpApiErrorPayload } from "../../../../lib/api";
import type { StorefrontPublic } from "../../../../lib/storefront";

async function loadStorefront(slug: string): Promise<StorefrontPublic> {
  const res = await fetch(`/api/public/storefront/${encodeURIComponent(slug)}`, { cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as StorefrontPublic & { detail?: string };
  if (!res.ok) throw new Error(data.detail || "Vitrine introuvable.");
  return data;
}

export default function StorefrontRegisterPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const storefront = useQuery({
    queryKey: ["storefront-public", slug],
    queryFn: () => loadStorefront(slug),
    enabled: Boolean(slug),
  });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/register-subscriber", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          display_name: displayName,
          workspace_slug: slug,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(formatHttpApiErrorPayload(data) || "Inscription impossible.");
        return;
      }
      const destSlug = String(data.workspace?.slug || slug);
      router.replace(`/a/${encodeURIComponent(destSlug)}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur réseau.");
    } finally {
      setLoading(false);
    }
  }

  const name = storefront.data?.name || "cet espace";

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center gap-6 px-4 py-10">
      <div className="rounded-2xl border-2 border-violet-200 bg-white p-6 shadow-lg sm:p-8">
        <p className="text-xs font-extrabold uppercase tracking-wider text-violet-700">Participant</p>
        <h1 className="mt-2 text-2xl font-extrabold text-slate-900">Demander l’accès participant</h1>
        <p className="mt-2 text-sm text-slate-600">
          Votre inscription à {name} devra être validée avant d’accéder aux séances et ressources réservées. Les contenus publics restent visibles sans compte.
        </p>
        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <label className="block text-sm font-semibold text-slate-700">
            Nom affiché
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
              placeholder="Votre prénom"
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
            Mot de passe
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
            disabled={loading || storefront.isError}
            className="w-full rounded-xl bg-violet-700 px-4 py-3 text-sm font-bold text-white hover:bg-violet-800 disabled:opacity-60"
          >
            {loading ? "Envoi…" : "Envoyer ma demande"}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-slate-600">
          <Link href={`/p/${encodeURIComponent(slug || "")}`} className="font-semibold text-slate-500 hover:text-violet-700">
            ← Vitrine
          </Link>
          <span className="mx-2">·</span>
          Déjà inscrit ?{" "}
          <Link
            href={`/p/${encodeURIComponent(slug || "")}/connexion`}
            className="font-bold text-violet-700 hover:underline"
          >
            Connexion
          </Link>
        </p>
      </div>
    </div>
  );
}
