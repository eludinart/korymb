"use client";

import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { requestJson, agentHeaders } from "../../../lib/api";
import { MEMORY_CONTEXT_KEYS, MEMORY_CONTEXT_TITLES } from "../../../lib/agentMemory";

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

  const contexts = draft ?? memory.data?.contexts ?? {};

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

  const isDirty = draft !== null;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          {memory.data?.updated_at ? `Dernière mise à jour : ${formatDate(memory.data.updated_at)}` : ""}
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => snapshotMutation.mutate()}
            disabled={snapshotMutation.isPending}
            className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {snapshotMutation.isPending ? "…" : "📸 Snapshot manuel"}
          </button>
          {isDirty && (
            <button
              onClick={() => setDraft(null)}
              className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50"
            >
              Annuler
            </button>
          )}
          <button
            onClick={() => saveMutation.mutate(contexts)}
            disabled={saveMutation.isPending || !isDirty}
            className="rounded-xl bg-violet-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-violet-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saveMutation.isPending ? "Sauvegarde…" : "Sauvegarder"}
          </button>
        </div>
      </div>

      {memory.isLoading && <p className="text-sm text-slate-400">Chargement…</p>}

      {MEMORY_CONTEXT_KEYS.map((key) => (
        <div key={key}>
          <label className="block text-sm font-semibold text-slate-700 mb-1">
            {MEMORY_CONTEXT_TITLES[key]}
          </label>
          <textarea
            value={contexts[key] ?? ""}
            onChange={(e) =>
              setDraft((prev) => ({ ...(prev ?? contexts), [key]: e.target.value }))
            }
            rows={4}
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 resize-y"
            placeholder={`Contexte pour ${MEMORY_CONTEXT_TITLES[key]}…`}
          />
        </div>
      ))}
    </div>
  );
}

// ── Tab: History ──────────────────────────────────────────────────────────────

function HistoryTab({ qc, showToast }: { qc: ReturnType<typeof useQueryClient>; showToast: (m: string, ok?: boolean) => void }) {
  const [diffTarget, setDiffTarget] = useState<MemorySnapshot | null>(null);
  const [loadedSnap, setLoadedSnap] = useState<MemorySnapshot | null>(null);

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
      setDiffTarget(null);
      setLoadedSnap(null);
      showToast("Snapshot restauré avec succès.");
    },
    onError: (e: Error) => showToast(e.message || "Erreur restauration", false),
  });

  return (
    <div className="space-y-4">
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
          <p className="text-xs font-medium text-slate-600">Diff avec l'état actuel :</p>
          <DiffView
            before={currentMemory.data?.contexts ?? {}}
            after={loadedSnap.contexts ?? {}}
          />
        </div>
      )}

      {history.isSuccess && history.data.length === 0 && (
        <p className="text-sm text-slate-400">Aucun snapshot encore. Modifiez et sauvegardez la mémoire pour créer le premier.</p>
      )}

      <ul className="space-y-2">
        {(history.data ?? []).map((snap) => (
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
    } catch (e) {
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

function PreviewTab() {
  const [agentKey, setAgentKey] = useState("coordinateur");
  const [trigger, setTrigger] = useState(0);

  const preview = useQuery({
    queryKey: ["memory-preview", agentKey, trigger],
    queryFn: async () => {
      const { data } = await requestJson(`/memory/preview?agent_key=${agentKey}`, { headers: agentHeaders() });
      return data as { agent_key: string; prompt: string };
    },
    enabled: trigger > 0,
  });

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-500">
        Visualise le prompt système complet tel qu'il sera injecté dans le contexte de l'agent avant une mission.
      </p>

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
          onClick={() => setTrigger((n) => n + 1)}
          className="rounded-xl bg-violet-700 px-4 py-2 text-sm font-medium text-white hover:bg-violet-800"
        >
          Générer
        </button>
      </div>

      {preview.isFetching && <p className="text-sm text-slate-400">Assemblage du prompt…</p>}
      {preview.isError && (
        <p className="text-sm text-red-600">Erreur lors de l'assemblage du prompt.</p>
      )}

      {preview.isSuccess && preview.data && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium text-slate-500">
              Prompt système — {preview.data.agent_key} ({preview.data.prompt.length} caractères)
            </p>
            <button
              onClick={() => navigator.clipboard.writeText(preview.data?.prompt ?? "")}
              className="text-xs text-violet-600 hover:underline"
            >
              Copier
            </button>
          </div>
          <pre className="rounded-2xl bg-slate-900 p-5 text-xs text-slate-100 whitespace-pre-wrap overflow-auto max-h-[60vh] leading-relaxed">
            {preview.data.prompt}
          </pre>
        </div>
      )}
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Console Mémoire Entreprise</h1>
        <p className="mt-1 text-sm text-slate-500">
          Éditez les contextes agents, consultez l'historique avec diff, importez/exportez des snapshots,
          et prévisualisez le prompt système complet avant une mission.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t.id
                ? "border-violet-600 text-violet-700"
                : "border-transparent text-slate-500 hover:text-slate-800"
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
          className={`fixed bottom-6 right-6 z-50 rounded-xl px-5 py-3 text-sm font-medium text-white shadow-lg ${
            toast.ok ? "bg-emerald-600" : "bg-red-600"
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
