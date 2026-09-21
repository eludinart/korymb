"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { agentHeaders, requestJson } from "../../lib/api";
import { MEMORY_CONTEXT_TITLES } from "../../lib/agentMemory";

type Props = {
  groupId: string;
  groupLabel: string;
  memoryScope: string;
  onChangeScope: (scope: string) => void;
  scopeBusy?: boolean;
};

type MemoryState = {
  contexts?: Record<string, string>;
};

type GroupMemory = {
  group_id: string;
  notes: string;
  inherit_shared: boolean;
  updated_at?: string | null;
};

function previewText(raw: string | undefined, max = 280): string {
  const t = (raw || "").replace(/\s+/g, " ").trim();
  if (!t) return "— vide —";
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

export default function TeamMemoryPanel({
  groupId,
  groupLabel,
  memoryScope,
  onChangeScope,
  scopeBusy,
}: Props) {
  const qc = useQueryClient();
  const scope = memoryScope || "group";
  const [notes, setNotes] = useState("");
  const [inheritShared, setInheritShared] = useState(false);
  const [formMsg, setFormMsg] = useState("");

  const shared = useQuery({
    queryKey: ["memory"],
    queryFn: async () => {
      const { data, res } = await requestJson("/memory", {
        headers: agentHeaders(),
        retries: 0,
        expectOk: false,
      });
      if (!res.ok) throw new Error(String(data?.detail || `HTTP ${res.status}`));
      return data as MemoryState;
    },
    enabled: scope === "enterprise" || scope === "group",
    staleTime: 30_000,
  });

  const groupMem = useQuery({
    queryKey: ["agent-group-memory", groupId],
    queryFn: async () => {
      const { data, res } = await requestJson(`/agent-groups/${encodeURIComponent(groupId)}/memory`, {
        retries: 1,
        expectOk: false,
      });
      if (!res.ok) throw new Error(String(data?.detail || `HTTP ${res.status}`));
      return (data?.memory || {}) as GroupMemory;
    },
    enabled: scope === "group" && Boolean(groupId),
  });

  useEffect(() => {
    if (!groupMem.data) return;
    setNotes(groupMem.data.notes || "");
    setInheritShared(Boolean(groupMem.data.inherit_shared));
    setFormMsg("");
  }, [groupMem.data, groupId]);

  const saveGroupMem = useMutation({
    mutationFn: async () => {
      const { data, res } = await requestJson(`/admin/agent-groups/${encodeURIComponent(groupId)}/memory`, {
        method: "PUT",
        expectOk: false,
        body: JSON.stringify({ notes: notes.trim(), inherit_shared: inheritShared }),
      });
      if (!res.ok) throw new Error(String(data?.detail || `HTTP ${res.status}`));
      return data?.memory as GroupMemory;
    },
    onSuccess: async () => {
      setFormMsg("Mémoire d’équipe enregistrée.");
      await qc.invalidateQueries({ queryKey: ["agent-group-memory", groupId] });
    },
    onError: (e: unknown) => setFormMsg(e instanceof Error ? e.message : String(e)),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormMsg("");
    saveGroupMem.mutate();
  };

  const globalPreview = shared.data?.contexts?.global;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-bold text-slate-900">Mémoire de l’équipe</h3>
        <p className="mt-1 text-xs text-slate-500">
          Ce que « {groupLabel} » injecte dans ses missions / chat. Par défaut une équipe projet
          reste sur sa mission : elle ne lit pas la science d’entreprise (mémoire globale, faits,
          historique de toutes les missions).
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Portée (policy)</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(
            [
              ["enterprise", "Partagée (workspace)"],
              ["group", "Équipe / mission"],
              ["none", "Aucune"],
            ] as const
          ).map(([value, label]) => {
            const active = scope === value;
            return (
              <button
                key={value}
                type="button"
                disabled={scopeBusy}
                onClick={() => onChangeScope(value)}
                className={`rounded-xl px-3 py-2 text-sm font-bold transition ${
                  active
                    ? "bg-violet-700 text-white shadow-sm"
                    : "border border-slate-200 bg-white text-slate-700 hover:bg-violet-50"
                } disabled:opacity-50`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          « Équipe / mission » isole le prompt de la science d’entreprise. « Partagée » réinjecte
          la mémoire globale, les faits et l’historique workspace.
        </p>
      </div>

      {scope === "enterprise" ? (
        <div className="space-y-3 rounded-2xl border border-violet-100 bg-violet-50/40 p-4">
          <p className="text-sm font-semibold text-violet-950">
            Cette équipe lit la <strong>mémoire partagée</strong> du workspace.
          </p>
          <div className="rounded-xl border border-white bg-white p-3 shadow-sm">
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
              {MEMORY_CONTEXT_TITLES.global}
            </p>
            {shared.isLoading ? (
              <p className="mt-2 text-xs text-slate-400">Chargement…</p>
            ) : shared.isError ? (
              <p className="mt-2 text-xs text-amber-800">Aperçu indisponible.</p>
            ) : (
              <p className="mt-2 text-sm leading-relaxed text-slate-700">{previewText(globalPreview)}</p>
            )}
          </div>
          <Link
            href="/administration/memory"
            className="inline-flex rounded-xl bg-violet-700 px-4 py-2 text-sm font-bold text-white hover:bg-violet-800"
          >
            Éditer la mémoire partagée →
          </Link>
        </div>
      ) : null}

      {scope === "group" ? (
        <form onSubmit={onSubmit} className="space-y-3 rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4">
          <p className="text-sm font-semibold text-emerald-950">
            Scope <strong>équipe / mission</strong> — notes injectées pour ce groupe uniquement.
            Les agents ne reçoivent plus la science d’entreprise globale.
          </p>
          {groupMem.isLoading ? <p className="text-xs text-slate-400">Chargement…</p> : null}
          {groupMem.isError ? (
            <p className="text-xs text-red-700">Impossible de charger la mémoire d’équipe (redémarre le backend si besoin).</p>
          ) : null}
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">Notes d’équipe</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={8}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm leading-relaxed"
              placeholder="Brief projet, glossaire, décisions, contraintes… (injecté aux agents de cette équipe)"
            />
            <p className="mt-1 text-[11px] text-slate-400">{notes.length} / 16000</p>
          </div>
          <label className="flex items-start gap-2 text-sm text-slate-800">
            <input
              type="checkbox"
              className="mt-1"
              checked={inheritShared}
              onChange={(e) => setInheritShared(e.target.checked)}
            />
            <span>
              Hériter aussi du <strong>contexte global</strong> partagé
              <span className="mt-0.5 block text-xs text-slate-500">
                Réintroduit un extrait de la science d’entreprise dans les missions de cette équipe.
                À n’activer que si la mission a vraiment besoin du cadre workspace.
              </span>
            </span>
          </label>
          {inheritShared && globalPreview ? (
            <p className="rounded-lg bg-white/80 px-3 py-2 text-xs text-slate-600">
              Aperçu global : {previewText(globalPreview, 160)}
            </p>
          ) : null}
          {formMsg ? (
            <p className={`text-sm ${formMsg.startsWith("Mémoire") ? "text-emerald-800" : "text-red-700"}`}>
              {formMsg}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={saveGroupMem.isPending}
              className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              {saveGroupMem.isPending ? "Enregistrement…" : "Enregistrer la mémoire d’équipe"}
            </button>
            <Link
              href="/administration/memory"
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Mémoire partagée
            </Link>
          </div>
        </form>
      ) : null}

      {scope === "none" ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-900">Aucune mémoire d’équipe injectée</p>
          <p className="mt-1 text-xs text-slate-600">
            Les agents s’appuient sur leur prompt de rôle (et outils). Utile pour des tests sans contexte métier.
          </p>
        </div>
      ) : null}
    </div>
  );
}
