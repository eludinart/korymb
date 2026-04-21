"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { requestJson, agentHeaders } from "../../../lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

type MissionTemplate = {
  id: string;
  name: string;
  description: string;
  agent: string;
  mission_text: string;
  variables: string[];
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type AgentDef = { key: string; label: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

const VAR_RE = /\{\{(\w+)\}\}/g;

function extractVariables(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  VAR_RE.lastIndex = 0;
  while ((m = VAR_RE.exec(text)) !== null) {
    if (!seen.has(m[1])) {
      found.push(m[1]);
      seen.add(m[1]);
    }
  }
  return found;
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

const AGENT_COLORS: Record<string, string> = {
  coordinateur: "bg-violet-100 text-violet-800",
  commercial: "bg-blue-100 text-blue-800",
  community_manager: "bg-pink-100 text-pink-800",
  developpeur: "bg-emerald-100 text-emerald-800",
  comptable: "bg-amber-100 text-amber-800",
};

function agentBadge(key: string) {
  return AGENT_COLORS[key] ?? "bg-slate-100 text-slate-700";
}

// ── Empty form state ──────────────────────────────────────────────────────────

function emptyForm() {
  return {
    name: "",
    description: "",
    agent: "coordinateur",
    mission_text: "",
    variables: [] as string[],
    config: {},
  };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TemplateCard({
  tmpl,
  onEdit,
  onLaunch,
  onDelete,
}: {
  tmpl: MissionTemplate;
  onEdit: () => void;
  onLaunch: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-slate-900 truncate">{tmpl.name}</h3>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${agentBadge(tmpl.agent)}`}>
              {tmpl.agent}
            </span>
          </div>
          {tmpl.description && (
            <p className="mt-1 text-sm text-slate-500 line-clamp-2">{tmpl.description}</p>
          )}
        </div>
      </div>

      {tmpl.variables.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {tmpl.variables.map((v) => (
            <span key={v} className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600">
              {`{{${v}}}`}
            </span>
          ))}
        </div>
      )}

      <p className="mt-3 text-xs text-slate-400">Modifié le {formatDate(tmpl.updated_at)}</p>

      <div className="mt-4 flex gap-2 border-t border-slate-100 pt-4">
        <button
          onClick={onLaunch}
          className="flex-1 rounded-xl bg-violet-700 px-3 py-2 text-sm font-medium text-white hover:bg-violet-800 transition-colors"
        >
          Lancer
        </button>
        <button
          onClick={onEdit}
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
        >
          Éditer
        </button>
        <button
          onClick={onDelete}
          className="rounded-xl border border-red-100 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
        >
          Supprimer
        </button>
      </div>
    </div>
  );
}

// ── Edit / Create drawer ──────────────────────────────────────────────────────

function TemplateDrawer({
  open,
  initial,
  agents,
  onClose,
  onSave,
  saving,
}: {
  open: boolean;
  initial: ReturnType<typeof emptyForm> & { id?: string };
  agents: AgentDef[];
  onClose: () => void;
  onSave: (form: ReturnType<typeof emptyForm> & { id?: string }) => void;
  saving: boolean;
}) {
  const [form, setForm] = useState(initial);

  useEffect(() => {
    setForm(initial);
  }, [initial, open]);

  const detectedVars = extractVariables(form.mission_text);

  function handleMissionChange(text: string) {
    const vars = extractVariables(text);
    setForm((f) => ({ ...f, mission_text: text, variables: vars }));
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="flex w-full max-w-xl flex-col bg-white shadow-2xl overflow-y-auto">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">
            {form.id ? "Modifier le template" : "Nouveau template"}
          </h2>
        </div>

        <div className="flex-1 space-y-5 px-6 py-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Nom *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              placeholder="Rapport hebdomadaire commercial"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              placeholder="Description courte pour la bibliothèque"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Agent</label>
            <select
              value={form.agent}
              onChange={(e) => setForm((f) => ({ ...f, agent: e.target.value }))}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            >
              {agents.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.label} ({a.key})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Texte de la mission *{" "}
              <span className="font-normal text-slate-400">— utilisez {"{{"} variable {"}}"}  pour les placeholders</span>
            </label>
            <textarea
              value={form.mission_text}
              onChange={(e) => handleMissionChange(e.target.value)}
              rows={10}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 resize-y"
              placeholder={"Génère le rapport commercial de la semaine {{semaine}} pour le client {{client}}."}
            />
          </div>

          {detectedVars.length > 0 && (
            <div className="rounded-xl bg-violet-50 p-4">
              <p className="text-xs font-medium text-violet-800 mb-2">Variables détectées :</p>
              <div className="flex flex-wrap gap-2">
                {detectedVars.map((v) => (
                  <span key={v} className="rounded-md bg-white border border-violet-200 px-2 py-1 font-mono text-xs text-violet-700">
                    {`{{${v}}}`}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 flex justify-end gap-3 px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Annuler
          </button>
          <button
            onClick={() => onSave(form)}
            disabled={saving || !form.name.trim() || !form.mission_text.trim()}
            className="rounded-xl bg-violet-700 px-4 py-2 text-sm font-medium text-white hover:bg-violet-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Sauvegarde…" : "Sauvegarder"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Launch modal ──────────────────────────────────────────────────────────────

function LaunchModal({
  tmpl,
  onClose,
  onLaunch,
  launching,
}: {
  tmpl: MissionTemplate;
  onClose: () => void;
  onLaunch: (vars: Record<string, string>) => void;
  launching: boolean;
}) {
  const [vars, setVars] = useState<Record<string, string>>(() =>
    Object.fromEntries(tmpl.variables.map((v) => [v, ""]))
  );

  const preview = tmpl.mission_text.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Lancer — {tmpl.name}</h2>
          <p className="mt-0.5 text-sm text-slate-500">Agent : {tmpl.agent}</p>
        </div>

        <div className="space-y-4 px-6 py-5">
          {tmpl.variables.length > 0 ? (
            <>
              <p className="text-sm font-medium text-slate-700">Remplissez les variables :</p>
              {tmpl.variables.map((v) => (
                <div key={v}>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    <span className="font-mono text-violet-700">{`{{${v}}}`}</span>
                  </label>
                  <input
                    type="text"
                    value={vars[v] ?? ""}
                    onChange={(e) => setVars((prev) => ({ ...prev, [v]: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                  />
                </div>
              ))}
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-600">
                  Aperçu de la mission
                </summary>
                <pre className="mt-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-600 whitespace-pre-wrap overflow-auto max-h-40">
                  {preview}
                </pre>
              </details>
            </>
          ) : (
            <div>
              <p className="text-sm text-slate-600 mb-2">Aucune variable — mission prête à lancer :</p>
              <pre className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600 whitespace-pre-wrap overflow-auto max-h-40">
                {tmpl.mission_text}
              </pre>
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 flex justify-end gap-3 px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Annuler
          </button>
          <button
            onClick={() => onLaunch(vars)}
            disabled={launching}
            className="rounded-xl bg-violet-700 px-4 py-2 text-sm font-medium text-white hover:bg-violet-800 disabled:opacity-50"
          >
            {launching ? "Lancement…" : "Lancer la mission"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TemplatesPage() {
  const router = useRouter();
  const qc = useQueryClient();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<MissionTemplate | null>(null);
  const [launchTarget, setLaunchTarget] = useState<MissionTemplate | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  const templates = useQuery({
    queryKey: ["templates"],
    queryFn: async () => {
      const { data } = await requestJson("/templates", { headers: agentHeaders() });
      return (data.templates ?? []) as MissionTemplate[];
    },
  });

  const agents = useQuery({
    queryKey: ["agents"],
    queryFn: async () => {
      const { data } = await requestJson("/agents");
      return (data.agents ?? []) as AgentDef[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (form: ReturnType<typeof emptyForm> & { id?: string }) => {
      const body = {
        name: form.name,
        description: form.description,
        agent: form.agent,
        mission_text: form.mission_text,
        variables: form.variables,
        config: form.config,
      };
      if (form.id) {
        await requestJson(`/templates/${form.id}`, {
          method: "PUT",
          headers: agentHeaders(),
          body: JSON.stringify(body),
        });
      } else {
        await requestJson("/templates", {
          method: "POST",
          headers: agentHeaders(),
          body: JSON.stringify(body),
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["templates"] });
      setDrawerOpen(false);
      setEditTarget(null);
      showToast("Template sauvegardé.");
    },
    onError: (e: Error) => showToast(e.message || "Erreur sauvegarde", false),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await requestJson(`/templates/${id}`, { method: "DELETE", headers: agentHeaders() });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["templates"] });
      showToast("Template supprimé.");
    },
    onError: (e: Error) => showToast(e.message || "Erreur suppression", false),
  });

  const launchMutation = useMutation({
    mutationFn: async ({ id, variables }: { id: string; variables: Record<string, string> }) => {
      const { data } = await requestJson(`/templates/${id}/launch`, {
        method: "POST",
        headers: agentHeaders(),
        body: JSON.stringify({ variables }),
      });
      return data as { job_id: string };
    },
    onSuccess: (data) => {
      setLaunchTarget(null);
      showToast(`Mission lancée — job ${data.job_id}`);
      setTimeout(() => router.push("/missions"), 1200);
    },
    onError: (e: Error) => showToast(e.message || "Erreur lancement", false),
  });

  const openCreate = () => {
    setEditTarget(null);
    setDrawerOpen(true);
  };

  const openEdit = (tmpl: MissionTemplate) => {
    setEditTarget(tmpl);
    setDrawerOpen(true);
  };

  const drawerInitial = editTarget
    ? {
        id: editTarget.id,
        name: editTarget.name,
        description: editTarget.description,
        agent: editTarget.agent,
        mission_text: editTarget.mission_text,
        variables: editTarget.variables,
        config: editTarget.config,
      }
    : emptyForm();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Templates de missions</h1>
          <p className="mt-1 text-sm text-slate-500">
            Créez des missions récurrentes avec des variables dynamiques{" "}
            <span className="font-mono text-violet-700">{`{{placeholder}}`}</span> et lancez-les en un clic.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="shrink-0 rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-violet-800"
        >
          + Nouveau template
        </button>
      </div>

      {/* State */}
      {templates.isLoading && <p className="text-sm text-slate-400">Chargement…</p>}
      {templates.isError && (
        <p className="text-sm text-red-700">Impossible de charger les templates.</p>
      )}

      {/* Grid */}
      {templates.isSuccess && (
        <>
          {templates.data.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-slate-200 py-16 text-center">
              <p className="text-slate-400">Aucun template pour l'instant.</p>
              <button
                onClick={openCreate}
                className="mt-4 rounded-xl bg-violet-700 px-4 py-2 text-sm font-medium text-white hover:bg-violet-800"
              >
                Créer le premier template
              </button>
            </div>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {templates.data.map((tmpl) => (
                <li key={tmpl.id}>
                  <TemplateCard
                    tmpl={tmpl}
                    onEdit={() => openEdit(tmpl)}
                    onLaunch={() => setLaunchTarget(tmpl)}
                    onDelete={() => {
                      if (confirm(`Supprimer "${tmpl.name}" ?`)) {
                        deleteMutation.mutate(tmpl.id);
                      }
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* Drawer */}
      <TemplateDrawer
        open={drawerOpen}
        initial={drawerInitial}
        agents={agents.data ?? [{ key: "coordinateur", label: "Coordinateur" }]}
        onClose={() => { setDrawerOpen(false); setEditTarget(null); }}
        onSave={(form) => saveMutation.mutate(form)}
        saving={saveMutation.isPending}
      />

      {/* Launch modal */}
      {launchTarget && (
        <LaunchModal
          tmpl={launchTarget}
          onClose={() => setLaunchTarget(null)}
          onLaunch={(vars) => launchMutation.mutate({ id: launchTarget.id, variables: vars })}
          launching={launchMutation.isPending}
        />
      )}

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
