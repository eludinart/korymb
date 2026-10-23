"use client";

import Link from "next/link";
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import AgentMessageMarkdown from "../../../components/AgentMessageMarkdown";
import { requestJson, agentHeaders } from "../../../lib/api";
import {
  MEMORY_CONTEXT_KEYS,
  MEMORY_CONTEXT_TITLES,
  CIO_MEMORY_NOTE,
  type MemoryContextKey,
} from "../../../lib/agentMemory";

/** Libellés courts pour le rail / stepper (le titre long reste dans le panneau). */
const MEMORY_CONTEXT_SHORT: Record<MemoryContextKey, string> = {
  global: "Global",
  commercial: "Commercial",
  community_manager: "Communauté",
  developpeur: "Développeur",
  comptable: "Comptable",
};

// ── Types ─────────────────────────────────────────────────────────────────────

type MemorySnapshot = {
  id: number;
  comment: string;
  created_at: string;
  preview?: string;
  contexts?: Record<string, string>;
};

type MemoryState = {
  contexts: Record<string, string>;
  recent_missions: unknown[];
  updated_at: string | null;
};

const AGENTS_FOR_PREVIEW = [
  { key: "coordinateur", label: "CIO / Coordinateur" },
  { key: "commercial", label: "Commercial" },
  { key: "community_manager", label: "Community Manager" },
  { key: "developpeur", label: "Développeur" },
  { key: "comptable", label: "Comptable" },
];

type TabId = "edit" | "history" | "import-export" | "preview";

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// ── Simple diff view ──────────────────────────────────────────────────────────

function computeDiff(a: string, b: string): { type: "same" | "add" | "remove"; line: string }[] {
  const linesA = a.split("\n");
  const linesB = b.split("\n");
  const result: { type: "same" | "add" | "remove"; line: string }[] = [];
  const maxLen = Math.max(linesA.length, linesB.length);
  for (let i = 0; i < maxLen; i++) {
    const la = linesA[i];
    const lb = linesB[i];
    if (la === lb) {
      result.push({ type: "same", line: lb ?? la ?? "" });
    } else {
      if (la !== undefined) result.push({ type: "remove", line: la });
      if (lb !== undefined) result.push({ type: "add", line: lb });
    }
  }
  return result;
}

function DiffView({ before, after }: { before: Record<string, string>; after: Record<string, string> }) {
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  return (
    <div className="space-y-4">
      {keys.map((k) => {
        const textA = before[k] ?? "";
        const textB = after[k] ?? "";
        if (textA === textB) return null;
        const diff = computeDiff(textA, textB);
        return (
          <div key={k}>
            <p className="text-xs font-semibold text-slate-600 mb-1">{k}</p>
            <pre className="rounded-xl bg-slate-900 p-3 text-xs overflow-auto max-h-52">
              {diff.map((d, i) => (
                <span
                  key={i}
                  className={
                    d.type === "add"
                      ? "block text-emerald-400"
                      : d.type === "remove"
                      ? "block text-red-400"
                      : "block text-slate-400"
                  }
                >
                  {d.type === "add" ? "+ " : d.type === "remove" ? "- " : "  "}
                  {d.line}
                </span>
              ))}
            </pre>
          </div>
        );
      })}
    </div>
  );
}

// ── Tab: Edit ─────────────────────────────────────────────────────────────────

function EditTab({ qc, showToast }: { qc: ReturnType<typeof useQueryClient>; showToast: (m: string, ok?: boolean) => void }) {
  const memory = useQuery({
    queryKey: ["memory"],
    queryFn: async () => {
      const { data } = await requestJson("/memory", { headers: agentHeaders() });
      return data as MemoryState;
    },
  });

  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [search, setSearch] = useState("");
  const [activeKey, setActiveKey] = useState<MemoryContextKey>("global");
  const [viewMode, setViewMode] = useState<"edit" | "preview">("edit");

  const contexts = draft ?? memory.data?.contexts ?? {};
  const q = search.trim().toLowerCase();
  const visibleKeys = useMemo(
    () =>
      MEMORY_CONTEXT_KEYS.filter((key) => {
        if (!q) return true;
        const title = String(MEMORY_CONTEXT_TITLES[key] || key).toLowerCase();
        const short = MEMORY_CONTEXT_SHORT[key].toLowerCase();
        const body = String(contexts[key] || "").toLowerCase();
        return (
          title.includes(q) ||
          short.includes(q) ||
          body.includes(q) ||
          key.toLowerCase().includes(q)
        );
      }),
    [q, contexts],
  );

  // Si le volet actif disparaît du filtre, basculer sur le premier match.
  useEffect(() => {
    if (visibleKeys.length === 0) return;
    if (!visibleKeys.includes(activeKey)) {
      setActiveKey(visibleKeys[0]);
      setViewMode("edit");
    }
  }, [visibleKeys, activeKey]);

  const activeIndex = visibleKeys.indexOf(activeKey);
  const canPrev = activeIndex > 0;
  const canNext = activeIndex >= 0 && activeIndex < visibleKeys.length - 1;
  const activeBody = contexts[activeKey] ?? "";
  const activeFilled = activeBody.trim().length > 0;

  const selectKey = useCallback((key: MemoryContextKey) => {
    setActiveKey(key);
    setViewMode("edit");
  }, []);

  const saveMutation = useMutation({
    mutationFn: async (ctx: Record<string, string>) => {
      await requestJson("/memory", {
        method: "PUT",
        headers: agentHeaders(),
        body: JSON.stringify({ contexts: ctx }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["memory"] });
      qc.invalidateQueries({ queryKey: ["memory-history"] });
      setDraft(null);
      showToast("Mémoire sauvegardée (snapshot automatique créé).");
    },
    onError: (e: Error) => showToast(e.message || "Erreur", false),
  });

  const snapshotMutation = useMutation({
    mutationFn: async () => {
      await requestJson("/memory/snapshot", {
        method: "POST",
        headers: agentHeaders(),
        body: JSON.stringify({ comment: "snapshot manuel" }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["memory-history"] });
      showToast("Snapshot créé.");
    },
    onError: (e: Error) => showToast(e.message || "Erreur snapshot", false),
  });

  const compactMutation = useMutation({
    mutationFn: async () => {
      const { data } = await requestJson("/memory/compact?force=true", {
        method: "POST",
        headers: agentHeaders(),
      });
      return data as { compacted?: boolean; keys?: string[]; reason?: string };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["memory"] });
      qc.invalidateQueries({ queryKey: ["memory-history"] });
      setDraft(null);
      if (data?.compacted) {
        showToast(`Mémoire compactée (${(data.keys || []).join(", ") || "volets"}).`);
      } else {
        showToast(`Rien à compacter (${data?.reason || "ok"}).`);
      }
    },
    onError: (e: Error) => showToast(e.message || "Erreur compaction", false),
  });

  const deleteKeyMutation = useMutation({
    mutationFn: async (key: string) => {
      await requestJson(`/memory/contexts/${encodeURIComponent(key)}`, {
        method: "DELETE",
        headers: agentHeaders(),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["memory"] });
      qc.invalidateQueries({ queryKey: ["memory-history"] });
      setDraft(null);
      showToast("Volet supprimé du stockage (snapshot créé).");
    },
    onError: (e: Error) => showToast(e.message || "Erreur suppression", false),
  });

  const isDirty = draft !== null;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {memory.data?.updated_at ? `Dernière mise à jour : ${formatDate(memory.data.updated_at)}` : ""}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => compactMutation.mutate()}
            disabled={compactMutation.isPending}
            className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {compactMutation.isPending ? "…" : "Compacter"}
          </button>
          <button
            type="button"
            onClick={() => snapshotMutation.mutate()}
            disabled={snapshotMutation.isPending}
            className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {snapshotMutation.isPending ? "…" : "Snapshot manuel"}
          </button>
          {isDirty && (
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              Annuler
            </button>
          )}
          <button
            type="button"
            onClick={() => saveMutation.mutate(contexts)}
            disabled={saveMutation.isPending || !isDirty}
            className="rounded-xl bg-violet-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saveMutation.isPending ? "Sauvegarde…" : "Sauvegarder"}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-100">
        <p className="font-semibold">CIO / coordinateur</p>
        <p className="mt-1 text-violet-800 dark:text-violet-200">{CIO_MEMORY_NOTE}</p>
      </div>

      <label className="block">
        <span className="sr-only">Rechercher dans la mémoire</span>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher dans vos volets (titre ou texte)…"
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm placeholder:text-slate-400 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:ring-violet-900"
        />
      </label>

      {memory.isLoading && <p className="text-sm text-slate-400 dark:text-slate-500">Chargement…</p>}
      {memory.isError && (
        <p className="text-sm text-red-600 dark:text-red-400">
          {memory.error instanceof Error ? memory.error.message : "Erreur chargement mémoire."}
        </p>
      )}

      {!memory.isLoading && !memory.isError && q && visibleKeys.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Aucun volet ne correspond à « {search.trim()} ».</p>
      ) : null}

      {!memory.isLoading && !memory.isError && visibleKeys.length > 0 ? (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          {/* Rail / stepper des volets */}
          <nav
            aria-label="Volets mémoire"
            className="flex shrink-0 gap-1.5 overflow-x-auto pb-1 lg:w-48 lg:flex-col lg:overflow-visible lg:pb-0"
          >
            {visibleKeys.map((key, i) => {
              const filled = Boolean((contexts[key] ?? "").trim());
              const selected = key === activeKey;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => selectKey(key)}
                  aria-current={selected ? "step" : undefined}
                  className={`flex min-h-[44px] shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors lg:w-full ${
                    selected
                      ? "bg-violet-700 text-white"
                      : "border border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                      selected
                        ? "bg-white/20 text-white"
                        : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span className="truncate">{MEMORY_CONTEXT_SHORT[key]}</span>
                  {filled ? (
                    <span
                      className={`ml-auto h-1.5 w-1.5 shrink-0 rounded-full ${
                        selected ? "bg-violet-200" : "bg-violet-500"
                      }`}
                      title="Contenu présent"
                      aria-hidden
                    />
                  ) : null}
                </button>
              );
            })}
          </nav>

          {/* Panneau du volet actif */}
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {MEMORY_CONTEXT_TITLES[activeKey]}
                </h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {activeKey === "global"
                    ? "Priorités des 7 prochains jours et décisions anticipées — utilisées par le CIO et les missions. Effacer puis sauvegarder vide le contenu ; « Supprimer le volet » retire l’entrée du JSON."
                    : `Contexte métier injecté pour l’agent ${MEMORY_CONTEXT_TITLES[activeKey]}.`}
                </p>
                {visibleKeys.length > 1 ? (
                  <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                    Volet {activeIndex + 1} / {visibleKeys.length}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div
                  className="inline-flex rounded-xl border border-slate-200 p-0.5 dark:border-slate-600"
                  role="group"
                  aria-label="Mode d’affichage"
                >
                  <button
                    type="button"
                    onClick={() => setViewMode("edit")}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
                      viewMode === "edit"
                        ? "bg-violet-100 text-violet-800 dark:bg-violet-900/60 dark:text-violet-100"
                        : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                    }`}
                  >
                    Édition
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode("preview")}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
                      viewMode === "preview"
                        ? "bg-violet-100 text-violet-800 dark:bg-violet-900/60 dark:text-violet-100"
                        : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                    }`}
                  >
                    Aperçu
                  </button>
                </div>
                {activeFilled ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (!window.confirm(`Supprimer le volet « ${MEMORY_CONTEXT_TITLES[activeKey]} » du stockage ?`)) return;
                      deleteKeyMutation.mutate(activeKey);
                    }}
                    disabled={deleteKeyMutation.isPending}
                    className="rounded-lg border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
                  >
                    Supprimer le volet
                  </button>
                ) : null}
              </div>
            </div>

            {viewMode === "edit" ? (
              <textarea
                value={activeBody}
                onChange={(e) =>
                  setDraft((prev) => ({ ...(prev ?? contexts), [activeKey]: e.target.value }))
                }
                rows={activeKey === "global" ? 18 : 12}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-mono text-sm leading-relaxed text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-500 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 resize-y min-h-[12rem]"
                placeholder={
                  activeKey === "global"
                    ? "Ex. Activité professionnelle ou associative. Publics : clients, adhérents, partenaires. Cette semaine : relances, bilan, message aux membres."
                    : `Contexte pour ${MEMORY_CONTEXT_TITLES[activeKey]}…`
                }
              />
            ) : activeFilled ? (
              <div className="min-h-[12rem] rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100">
                <AgentMessageMarkdown source={activeBody} className="text-sm" />
              </div>
            ) : (
              <p className="min-h-[12rem] rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
                Volet vide — passez en Édition pour saisir du contenu.
              </p>
            )}

            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  if (!canPrev) return;
                  selectKey(visibleKeys[activeIndex - 1]);
                }}
                disabled={!canPrev}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Précédent
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!canNext) return;
                  selectKey(visibleKeys[activeIndex + 1]);
                }}
                disabled={!canNext}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Suivant
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── Tab: History ──────────────────────────────────────────────────────────────

function HistoryTab({ qc, showToast }: { qc: ReturnType<typeof useQueryClient>; showToast: (m: string, ok?: boolean) => void }) {
  const [loadedSnap, setLoadedSnap] = useState<MemorySnapshot | null>(null);
  const [search, setSearch] = useState("");

  const history = useQuery({
    queryKey: ["memory-history"],
    queryFn: async () => {
      const { data } = await requestJson("/memory/history?limit=30", { headers: agentHeaders() });
      return (data.history ?? []) as MemorySnapshot[];
    },
  });

  const currentMemory = useQuery({
    queryKey: ["memory"],
    queryFn: async () => {
      const { data } = await requestJson("/memory", { headers: agentHeaders() });
      return data as MemoryState;
    },
  });

  const q = search.trim().toLowerCase();
  const filteredHistory = (history.data ?? []).filter((snap) => {
    if (!q) return true;
    const hay = `${snap.id} ${snap.comment || ""} ${snap.preview || ""}`.toLowerCase();
    return hay.includes(q);
  });

  const loadSnapMutation = useMutation({
    mutationFn: async (id: number) => {
      const { data } = await requestJson(`/memory/history/${id}`, { headers: agentHeaders() });
      return data.snapshot as MemorySnapshot;
    },
    onSuccess: (snap) => setLoadedSnap(snap),
  });

  const restoreMutation = useMutation({
    mutationFn: async (id: number) => {
      await requestJson(`/memory/restore/${id}`, {
        method: "POST",
        headers: agentHeaders(),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["memory"] });
      qc.invalidateQueries({ queryKey: ["memory-history"] });
      setLoadedSnap(null);
      showToast("Snapshot restauré avec succès.");
    },
    onError: (e: Error) => showToast(e.message || "Erreur restauration", false),
  });

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="sr-only">Rechercher dans l&apos;historique</span>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher un snapshot (commentaire, aperçu)…"
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm placeholder:text-slate-400 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-200"
        />
      </label>
      {history.isLoading && <p className="text-sm text-slate-400">Chargement…</p>}
      {history.isError && <p className="text-sm text-red-600">Erreur chargement historique.</p>}

      {loadedSnap && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-800">
                Snapshot #{loadedSnap.id} — {formatDate(loadedSnap.created_at)}
              </p>
              {loadedSnap.comment && (
                <p className="text-xs text-slate-500">{loadedSnap.comment}</p>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setLoadedSnap(null)}
                className="text-xs text-slate-400 hover:text-slate-600"
              >
                Fermer
              </button>
              <button
                onClick={() => {
                  if (confirm(`Restaurer snapshot #${loadedSnap.id} ? L'état actuel sera sauvegardé avant.`)) {
                    restoreMutation.mutate(loadedSnap.id);
                  }
                }}
                disabled={restoreMutation.isPending}
                className="rounded-xl bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {restoreMutation.isPending ? "Restauration…" : "Restaurer"}
              </button>
            </div>
          </div>
          <p className="text-xs font-medium text-slate-600">Diff avec l&apos;état actuel :</p>
          <DiffView
            before={currentMemory.data?.contexts ?? {}}
            after={loadedSnap.contexts ?? {}}
          />
        </div>
      )}

      {history.isSuccess && history.data.length === 0 && (
        <p className="text-sm text-slate-400">Aucun snapshot encore. Modifiez et sauvegardez la mémoire pour créer le premier.</p>
      )}
      {history.isSuccess && history.data.length > 0 && filteredHistory.length === 0 ? (
        <p className="text-sm text-slate-500">Aucun snapshot ne correspond à « {search.trim()} ».</p>
      ) : null}

      <ul className="space-y-2">
        {filteredHistory.map((snap) => (
          <li
            key={snap.id}
            className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3"
          >
            <div>
              <p className="text-sm font-medium text-slate-800">
                #{snap.id} — {formatDate(snap.created_at)}
              </p>
              {snap.comment && <p className="text-xs text-slate-500 mt-0.5">{snap.comment}</p>}
              {snap.preview && (
                <p className="mt-1 truncate max-w-xs font-mono text-xs text-slate-400">{snap.preview}…</p>
              )}
            </div>
            <button
              onClick={() => loadSnapMutation.mutate(snap.id)}
              disabled={loadSnapMutation.isPending}
              className="shrink-0 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Voir diff
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Tab: Import / Export ──────────────────────────────────────────────────────

function ImportExportTab({ qc, showToast }: { qc: ReturnType<typeof useQueryClient>; showToast: (m: string, ok?: boolean) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const memory = useQuery({
    queryKey: ["memory"],
    queryFn: async () => {
      const { data } = await requestJson("/memory", { headers: agentHeaders() });
      return data as MemoryState;
    },
  });

  const importMutation = useMutation({
    mutationFn: async (contexts: Record<string, string>) => {
      await requestJson("/memory", {
        method: "PUT",
        headers: agentHeaders(),
        body: JSON.stringify({ contexts }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["memory"] });
      qc.invalidateQueries({ queryKey: ["memory-history"] });
      showToast("Mémoire importée avec succès.");
    },
    onError: (e: Error) => showToast(e.message || "Erreur import", false),
  });

  function handleExport() {
    if (!memory.data) return;
    const blob = new Blob([JSON.stringify({ contexts: memory.data.contexts, exported_at: new Date().toISOString() }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `korymb-memory-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleFile(file: File) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const ctx = parsed.contexts ?? parsed;
      if (typeof ctx !== "object" || Array.isArray(ctx)) throw new Error("Format invalide");
      if (confirm("Importer et écraser la mémoire actuelle ? Un snapshot sera créé automatiquement.")) {
        importMutation.mutate(ctx as Record<string, string>);
      }
    } catch {
      showToast("Fichier JSON invalide.", false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-3">
        <h3 className="font-semibold text-slate-800">Exporter</h3>
        <p className="text-sm text-slate-500">
          Télécharge un snapshot JSON de la mémoire entreprise actuelle.
        </p>
        <button
          onClick={handleExport}
          disabled={memory.isLoading}
          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          Télécharger JSON
        </button>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-3">
        <h3 className="font-semibold text-slate-800">Importer</h3>
        <p className="text-sm text-slate-500">
          Glissez-déposez un fichier JSON exporté précédemment, ou cliquez pour sélectionner.
        </p>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed py-10 transition-colors ${
            dragging ? "border-violet-400 bg-violet-50" : "border-slate-200 hover:border-violet-300 hover:bg-slate-50"
          }`}
        >
          <span className="text-2xl mb-2">📂</span>
          <p className="text-sm text-slate-500">Glisser-déposer ou cliquer</p>
          <p className="text-xs text-slate-400 mt-1">Format : JSON exporté par cette interface</p>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}

// ── Tab: Preview ──────────────────────────────────────────────────────────────

type MemoryPreviewResponse = {
  agent_key?: string;
  prompt?: string;
  agents?: Record<string, string>;
};

function promptFromPreview(data: MemoryPreviewResponse, agentKey: string): { agentKey: string; prompt: string } {
  const fromMap = data.agents?.[agentKey];
  const prompt = String(fromMap ?? data.prompt ?? "");
  return { agentKey: String(data.agent_key || agentKey), prompt };
}

function PreviewTab() {
  const [agentKey, setAgentKey] = useState("coordinateur");
  const [trigger, setTrigger] = useState(0);

  const preview = useQuery({
    queryKey: ["memory-preview", agentKey, trigger],
    queryFn: async () => {
      const { data } = await requestJson(`/memory/preview?agent_key=${encodeURIComponent(agentKey)}`, {
        headers: agentHeaders(),
      });
      return promptFromPreview((data || {}) as MemoryPreviewResponse, agentKey);
    },
    enabled: trigger > 0,
  });

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-500">
        Visualise le prompt système complet tel qu&apos;il sera injecté dans le contexte de l&apos;agent avant une mission.
      </p>
      {agentKey === "coordinateur" ? (
        <p className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-900">{CIO_MEMORY_NOTE}</p>
      ) : null}

      <div className="flex items-end gap-3">
        <div className="flex-1">
          <label className="block text-sm font-medium text-slate-700 mb-1">Agent</label>
          <select
            value={agentKey}
            onChange={(e) => { setAgentKey(e.target.value); setTrigger(0); }}
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
          >
            {AGENTS_FOR_PREVIEW.map((a) => (
              <option key={a.key} value={a.key}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() => setTrigger((n) => n + 1)}
          className="rounded-xl bg-violet-700 px-4 py-2 text-sm font-medium text-white hover:bg-violet-800"
        >
          Générer
        </button>
      </div>

      {preview.isFetching && <p className="text-sm text-slate-400">Assemblage du prompt…</p>}
      {preview.isError && (
        <p className="text-sm text-red-600">
          {preview.error instanceof Error ? preview.error.message : "Erreur lors de l'assemblage du prompt."}
        </p>
      )}

      {preview.isSuccess && preview.data ? (
        preview.data.prompt ? (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-medium text-slate-500">
                Prompt système — {preview.data.agentKey} ({preview.data.prompt.length} caractères)
              </p>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(preview.data.prompt)}
                className="text-xs text-violet-600 hover:underline"
              >
                Copier
              </button>
            </div>
            <pre className="rounded-2xl bg-slate-900 p-5 text-xs text-slate-100 whitespace-pre-wrap overflow-auto max-h-[60vh] leading-relaxed">
              {preview.data.prompt}
            </pre>
          </div>
        ) : (
          <p className="text-sm text-amber-800">Aucun prompt pour cet agent (clé inconnue ou mémoire vide).</p>
        )
      ) : null}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const TABS: { id: TabId; label: string }[] = [
  { id: "edit", label: "Édition" },
  { id: "history", label: "Historique" },
  { id: "import-export", label: "Import / Export" },
  { id: "preview", label: "Prévisualisation" },
];

export default function MemoryConsolePage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabId>("edit");
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const showToast = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void requestJson("/admin/notifications/mark-kinds-read", {
      method: "POST",
      headers: agentHeaders(),
      body: JSON.stringify({ kinds: ["memory_applied"] }),
    })
      .then(() => {
        if (!cancelled) void qc.invalidateQueries({ queryKey: ["director-notifications"] });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [qc]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">Votre activité</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Quelques phrases sur ce que vous faites, pour qui, avec quels mots. L&apos;assistant s&apos;en sert pour
          préparer le travail. Le parcours qui la constitue est{" "}
          <Link href="/administration/contexte" className="font-semibold text-violet-700 underline-offset-2 hover:underline dark:text-violet-300">
            la science de l&apos;entreprise
          </Link>
          . Le détail par rôle est plus bas. Les équipes se gèrent depuis{" "}
          <Link href="/administration/equipes" className="font-semibold text-violet-700 underline-offset-2 hover:underline dark:text-violet-300">
            Équipes
          </Link>
          .
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-700">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`shrink-0 border-b-2 -mb-px px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? "border-violet-600 text-violet-700 dark:border-violet-400 dark:text-violet-300"
                : "border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div>
        {tab === "edit" && <EditTab qc={qc} showToast={showToast} />}
        {tab === "history" && <HistoryTab qc={qc} showToast={showToast} />}
        {tab === "import-export" && <ImportExportTab qc={qc} showToast={showToast} />}
        {tab === "preview" && <PreviewTab />}
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-[max(1rem,var(--safe-bottom))] right-4 z-50 min-h-[44px] max-w-[calc(100vw-2rem)] rounded-xl px-5 py-3 text-sm font-medium text-white shadow-lg ${
            toast.ok ? "bg-emerald-600" : "bg-red-600"
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
