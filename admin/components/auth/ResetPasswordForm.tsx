"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import PasswordInput from "../ui/PasswordInput";
import { formatHttpApiErrorPayload } from "../../lib/api";

function ResetPasswordFormInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const workspace = searchParams.get("workspace") || "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const loginHref = workspace ? `/p/${encodeURIComponent(workspace)}/connexion` : "/login";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }
    if (!token) {
      setError("Lien invalide ou incomplet.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, new_password: password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(formatHttpApiErrorPayload(data) || "Réinitialisation impossible.");
        return;
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur réseau.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center gap-6 px-4">
      <div className="rounded-2xl border-2 border-violet-200 bg-white p-6 shadow-lg dark:border-violet-800 dark:bg-slate-900 sm:p-8">
        <p className="text-xs font-extrabold uppercase tracking-wider text-violet-700 dark:text-violet-300">Korymb</p>
        <h1 className="mt-2 text-2xl font-extrabold text-slate-900 dark:text-slate-50">Nouveau mot de passe</h1>
        {done ? (
          <>
            <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
              Mot de passe mis à jour. Vous pouvez vous connecter.
            </p>
            <p className="mt-4 text-center text-sm">
              <Link href={loginHref} className="font-bold text-violet-700 hover:underline dark:text-violet-300">
                Se connecter
              </Link>
            </p>
          </>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={onSubmit}>
            {!token ? (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950">
                Ce lien est incomplet. Demandez un nouvel e-mail depuis la page « Mot de passe oublié ».
              </p>
            ) : null}
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">
              Nouveau mot de passe
              <PasswordInput
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-600 dark:bg-slate-950"
                wrapperClassName="mt-1"
              />
            </label>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">
              Confirmer
              <PasswordInput
                required
                minLength={8}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-600 dark:bg-slate-950"
                wrapperClassName="mt-1"
              />
            </label>
            {error ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/50 dark:text-red-200">
                {error}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={loading || !token}
              className="w-full rounded-xl bg-violet-700 px-4 py-3 text-sm font-bold text-white hover:bg-violet-800 disabled:opacity-60"
            >
              {loading ? "Enregistrement…" : "Enregistrer le mot de passe"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordForm() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-500">Chargement…</div>}>
      <ResetPasswordFormInner />
    </Suspense>
  );
}
