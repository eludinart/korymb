"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import StarterPackPicker from "../../components/StarterPackPicker";
import { agentHeaders, formatHttpApiErrorPayload, requestJson } from "../../lib/api";
import type { AuthMeResponse } from "../../lib/authSession";
import {
  FALLBACK_STARTER_PACKS,
  fetchStarterPacks,
  starterPackLabel,
  type StarterPackSummary,
} from "../../lib/starterPacks";

export default function EspacePage() {
  const [me, setMe] = useState<AuthMeResponse | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [newWsName, setNewWsName] = useState("");
  const [starterPackId, setStarterPackId] = useState("blank");
  const [packs, setPacks] = useState<StarterPackSummary[]>(FALLBACK_STARTER_PACKS);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/auth/me", { cache: "no-store" });
    if (res.ok) setMe((await res.json()) as AuthMeResponse);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    void fetchStarterPacks().then((list) => {
      if (!cancelled) setPacks(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onInvite(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const { res, data } = await requestJson("/auth/members", {
        method: "POST",
        headers: agentHeaders(),
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      if (!res.ok) throw new Error(formatHttpApiErrorPayload(data) || "Invitation échouée.");
      setMessage(`Invitation envoyée à ${inviteEmail}.`);
      setInviteEmail("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setLoading(false);
    }
  }

  async function onCreateWorkspace(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const { res, data } = await requestJson("/auth/workspaces", {
        method: "POST",
        headers: agentHeaders(),
        body: JSON.stringify({ name: newWsName, starter_pack_id: starterPackId }),
      });
      if (!res.ok) throw new Error(formatHttpApiErrorPayload(data) || "Création échouée.");
      const packName = starterPackLabel(starterPackId);
      setMessage(
        `Espace « ${newWsName} » créé (modèle : ${packName}). Rechargez la page pour basculer.`,
      );
      setNewWsName("");
      setStarterPackId("blank");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setLoading(false);
    }
  }

  if (me && me.role !== "admin" && me.mode !== "agent_secret") {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-950">
        Seuls les administrateurs de l&apos;espace peuvent gérer l&apos;équipe et créer de nouveaux espaces.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-extrabold text-slate-900">Équipe et espaces</h1>
        <p className="mt-1 text-sm text-slate-600">
          Inviter des opérateurs et créer d’autres espaces Korymb. Espace actuel :{" "}
          <strong>{me?.workspace?.name || "—"}</strong>
          {me?.workspace?.starter_pack_id ? (
            <>
              {" "}
              · modèle{" "}
              <strong>{starterPackLabel(me.workspace.starter_pack_id)}</strong>
            </>
          ) : null}
        </p>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold text-slate-900">Membres de l&apos;équipe</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {(me?.members || []).map((m) => (
            <li key={m.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
              <span>{m.display_name || m.email}</span>
              <span className="text-xs font-bold uppercase text-violet-700">{m.role}</span>
            </li>
          ))}
        </ul>
        <form className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={onInvite}>
          <label className="flex-1 text-sm font-semibold">
            Inviter par e-mail
            <input
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="text-sm font-semibold">
            Rôle
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as "member" | "admin")}
              className="mt-1 block rounded-xl border border-slate-300 px-3 py-2"
            >
              <option value="member">Utilisateur</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <button
            type="submit"
            disabled={loading}
            className="rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60"
          >
            Inviter
          </button>
        </form>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold text-slate-900">Créer un autre espace Korymb</h2>
        <p className="mt-1 text-sm text-slate-600">Chaque espace a ses propres missions, mémoire et configuration.</p>
        <form className="mt-4 space-y-4" onSubmit={onCreateWorkspace}>
          <input
            type="text"
            required
            placeholder="Nom du nouvel espace"
            value={newWsName}
            onChange={(e) => setNewWsName(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
          />
          <StarterPackPicker
            packs={packs}
            value={starterPackId}
            onChange={setStarterPackId}
            disabled={loading}
            name="new_workspace_pack"
          />
          <button
            type="submit"
            disabled={loading}
            className="rounded-xl border-2 border-violet-700 px-4 py-2.5 text-sm font-bold text-violet-800 disabled:opacity-60"
          >
            {loading ? "Création…" : "Créer l'espace"}
          </button>
        </form>
      </section>

      {message ? <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{message}</p> : null}
      {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
    </div>
  );
}
