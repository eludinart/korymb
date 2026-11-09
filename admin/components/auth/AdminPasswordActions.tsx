"use client";

import { FormEvent, useState } from "react";
import PasswordInput from "../ui/PasswordInput";
import { agentHeaders, formatHttpApiErrorPayload, requestJson } from "../../lib/api";

type Props = {
  userId: string;
  label?: string;
};

/** Force un MDP ou envoie un lien de reset (admin espace / owner plateforme). */
export default function AdminPasswordActions({ userId, label = "Mot de passe" }: Props) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function onSetPassword(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const { res, data } = await requestJson(`/auth/users/${encodeURIComponent(userId)}/password`, {
        method: "POST",
        headers: agentHeaders(),
        body: JSON.stringify({ new_password: password }),
        expectOk: false,
      });
      if (!res.ok) throw new Error(formatHttpApiErrorPayload(data) || "Échec.");
      setMessage("Mot de passe mis à jour.");
      setPassword("");
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setLoading(false);
    }
  }

  async function onSendLink() {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const { res, data } = await requestJson(`/auth/users/${encodeURIComponent(userId)}/password-reset`, {
        method: "POST",
        headers: agentHeaders(),
        expectOk: false,
      });
      if (!res.ok) throw new Error(formatHttpApiErrorPayload(data) || "Échec.");
      const payload = data as { message?: string; mail_sent?: boolean };
      setMessage(payload.message || (payload.mail_sent ? "E-mail envoyé." : "Lien créé."));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="text-xs">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-lg border border-slate-300 px-2 py-1 font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Fermer" : label}
        </button>
        <button
          type="button"
          disabled={loading}
          className="rounded-lg border border-violet-300 px-2 py-1 font-semibold text-violet-800 hover:bg-violet-50 disabled:opacity-60 dark:border-violet-700 dark:text-violet-200"
          onClick={() => void onSendLink()}
        >
          Envoyer lien reset
        </button>
      </div>
      {open ? (
        <form className="mt-2 flex flex-wrap items-end gap-2" onSubmit={onSetPassword}>
          <label className="font-semibold text-slate-600 dark:text-slate-300">
            Nouveau mot de passe
            <PasswordInput
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="block w-44 rounded-lg border border-slate-300 px-2 py-1 dark:border-slate-600 dark:bg-slate-950"
              wrapperClassName="mt-0.5"
            />
          </label>
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-violet-700 px-2.5 py-1.5 font-bold text-white disabled:opacity-60"
          >
            Définir
          </button>
        </form>
      ) : null}
      {message ? <p className="mt-1 font-semibold text-emerald-700">{message}</p> : null}
      {error ? <p className="mt-1 font-semibold text-red-700">{error}</p> : null}
    </div>
  );
}
