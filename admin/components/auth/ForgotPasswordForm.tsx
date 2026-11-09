"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { formatHttpApiErrorPayload } from "../../lib/api";

export default function ForgotPasswordForm({
  audience,
  workspaceSlug = "",
}: {
  audience: "operator" | "subscriber";
  workspaceSlug?: string;
}) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const isOperator = audience === "operator";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          audience,
          ...(workspaceSlug ? { workspace_slug: workspaceSlug } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(formatHttpApiErrorPayload(data) || "Demande impossible.");
        return;
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur réseau.");
    } finally {
      setLoading(false);
    }
  }

  const backHref = isOperator
    ? "/login"
    : workspaceSlug
      ? `/p/${encodeURIComponent(workspaceSlug)}/connexion`
      : "/";

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center gap-6 px-4">
      <div className="rounded-2xl border-2 border-violet-200 bg-white p-6 shadow-lg dark:border-violet-800 dark:bg-slate-900 sm:p-8">
        <p className="text-xs font-extrabold uppercase tracking-wider text-violet-700 dark:text-violet-300">
          {isOperator ? "Korymb" : "Mon espace"}
        </p>
        <h1 className="mt-2 text-2xl font-extrabold text-slate-900 dark:text-slate-50">Mot de passe oublié</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Indiquez votre e-mail : si un compte existe, vous recevrez un lien valable une heure.
        </p>
        {done ? (
          <p className="mt-6 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
            Si un compte correspond, un e-mail avec un lien de réinitialisation a été envoyé. Vérifiez aussi vos
            indésirables.
          </p>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={onSubmit}>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">
              E-mail
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
              />
            </label>
            {error ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/50 dark:text-red-200">
                {error}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-violet-700 px-4 py-3 text-sm font-bold text-white hover:bg-violet-800 disabled:opacity-60"
            >
              {loading ? "Envoi…" : "Envoyer le lien"}
            </button>
          </form>
        )}
        <p className="mt-4 text-center text-sm text-slate-600 dark:text-slate-300">
          <Link href={backHref} className="font-semibold text-violet-700 hover:underline dark:text-violet-300">
            ← Retour à la connexion
          </Link>
        </p>
      </div>
    </div>
  );
}
