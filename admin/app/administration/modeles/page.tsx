"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { agentHeaders, formatHttpApiErrorPayload, requestJson } from "../../../lib/api";
import type { AuthMeResponse } from "../../../lib/authSession";
import {
  FALLBACK_STARTER_PACKS,
  fetchStarterPacks,
  starterPackLabel,
  type StarterPackSummary,
} from "../../../lib/starterPacks";

type ApplyResult = {
  starter_pack_id?: string;
  label?: string;
  created_playbooks?: number;
  skipped_playbooks?: number;
  created_templates?: number;
  skipped_templates?: number;
  memory_applied?: boolean;
};

export default function AdministrationModelesPage() {
  const [me, setMe] = useState<AuthMeResponse | null>(null);
  const [packs, setPacks] = useState<StarterPackSummary[]>(FALLBACK_STARTER_PACKS);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadMe = useCallback(async () => {
    const res = await fetch("/api/auth/me", { cache: "no-store" });
    if (res.ok) setMe((await res.json()) as AuthMeResponse);
  }, []);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  useEffect(() => {
    let cancelled = false;
    void fetchStarterPacks().then((list) => {
      if (!cancelled) setPacks(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function applyPack(packId: string) {
    if (packId === "blank") {
      setError("Le modèle « Commencer vide » n’ajoute pas de contenu. Choisissez Accompagnement ou Contenu.");
      return;
    }
    setBusyId(packId);
    setError("");
    setMessage("");
    try {
      const { res, data } = await requestJson("/auth/workspaces/apply-starter-pack", {
        method: "POST",
        headers: agentHeaders(),
        body: JSON.stringify({ starter_pack_id: packId }),
      });
      if (!res.ok) throw new Error(formatHttpApiErrorPayload(data) || "Application impossible.");
      const result = data as ApplyResult;
      const created = Number(result.created_playbooks || 0) + Number(result.created_templates || 0);
      const skipped = Number(result.skipped_playbooks || 0) + Number(result.skipped_templates || 0);
      setMessage(
        `Modèle « ${result.label || starterPackLabel(packId)} » appliqué : ${created} élément(s) ajouté(s)` +
          (skipped ? `, ${skipped} déjà présent(s)` : "") +
          (result.memory_applied ? ", mémoire initiale injectée" : "") +
          ".",
      );
      await loadMe();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setBusyId(null);
    }
  }

  const currentPack = me?.workspace?.starter_pack_id || "";

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6">
      <header>
        <p className="text-xs font-extrabold uppercase tracking-wider text-violet-700">Administration</p>
        <h1 className="mt-1 text-2xl font-extrabold text-slate-900">Modèles de démarrage</h1>
        <p className="mt-2 text-sm text-slate-600">
          Korymb reste un outil générique. Un modèle copie des playbooks et une mémoire de base dans{" "}
          <strong>{me?.workspace?.name || "cet espace"}</strong> — vous pouvez tout modifier ensuite. Ce n’est pas
          un secteur figé dans le moteur.
        </p>
        {currentPack ? (
          <p className="mt-2 text-sm text-slate-700">
            Modèle enregistré pour cet espace : <strong>{starterPackLabel(currentPack)}</strong>
            {currentPack !== "blank" ? ` (${currentPack})` : ""}.
          </p>
        ) : (
          <p className="mt-2 text-sm text-slate-700">Aucun modèle métier enregistré (espace démarré vide).</p>
        )}
      </header>

      {message ? <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{message}</p> : null}
      {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}

      <ul className="space-y-3">
        {packs.map((pack) => (
          <li
            key={pack.id}
            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-slate-900">{pack.label}</h2>
                <p className="mt-1 text-sm text-slate-600">{pack.description}</p>
                <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-violet-700">
                  {pack.playbook_count} playbook{pack.playbook_count !== 1 ? "s" : ""}
                  {pack.mission_template_count
                    ? ` · ${pack.mission_template_count} template${pack.mission_template_count > 1 ? "s" : ""}`
                    : ""}
                  {pack.has_memory_seed ? " · mémoire" : ""}
                </p>
              </div>
              {pack.id === "blank" ? (
                <span className="shrink-0 rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600">
                  Défaut (pas d’ajout)
                </span>
              ) : (
                <button
                  type="button"
                  disabled={busyId !== null}
                  onClick={() => void applyPack(pack.id)}
                  className="shrink-0 rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-violet-800 disabled:opacity-60"
                >
                  {busyId === pack.id ? "Application…" : "Appliquer à cet espace"}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      <p className="text-sm text-slate-600">
        Après application :{" "}
        <Link href="/gestion/playbooks" className="font-semibold text-violet-700 hover:underline">
          Playbooks
        </Link>
        {" · "}
        <Link href="/administration/templates" className="font-semibold text-violet-700 hover:underline">
          Templates missions
        </Link>
        {" · "}
        <Link href="/administration/memory" className="font-semibold text-violet-700 hover:underline">
          Mémoire partagée
        </Link>
      </p>
    </div>
  );
}
