"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { requestJson, agentHeaders } from "../../../lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

type ScheduledTask = {
  id: string;
  name: string;
  description: string;
  task_type: "mission" | "veille" | "mission_proposals";
  agent: string;
  mission_template: string;
  params: Record<string, unknown>;
  schedule_type: "interval" | "cron";
  schedule_config: Record<string, unknown>;
  enabled: boolean;
  requires_approval: boolean;
  budget_tokens_per_run: number;
  budget_runs_per_day: number;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
  return String(n);
}

function scheduleLabel(task: ScheduledTask): string {
  const cfg = task.schedule_config || {};
  if (task.schedule_type === "cron") {
    const parts = [
      cfg.day_of_week ? `jours : ${cfg.day_of_week}` : null,
      cfg.hour !== undefined ? `à ${cfg.hour}h${cfg.minute ?? "00"}` : null,
    ].filter(Boolean);
    return parts.length ? `Cron — ${parts.join(", ")}` : "Cron";
  }
  const parts = [
    cfg.weeks ? `${cfg.weeks}sem` : null,
    cfg.days ? `${cfg.days}j` : null,
    cfg.hours ? `${cfg.hours}h` : null,
    cfg.minutes ? `${cfg.minutes}min` : null,
  ].filter(Boolean);
  return parts.length ? `Toutes les ${parts.join(" ")}` : "Intervalle";
}

const TASK_TYPE_LABELS: Record<string, string> = {
  mission: "Mission directe",
  veille: "Veille web",
  mission_proposals: "Propositions d'agents",
};

const TASK_TYPE_COLORS: Record<string, string> = {
  mission: "bg-violet-100 text-violet-800",
  veille: "bg-blue-100 text-blue-800",
  mission_proposals: "bg-amber-100 text-amber-800",
};

function emptyForm() {
  return {
    name: "",
    description: "",
    task_type: "veille" as ScheduledTask["task_type"],
    agent: "coordinateur",
    mission_template: "",
    params_raw: "{}",
    schedule_type: "interval" as ScheduledTask["schedule_type"],
    schedule_config_raw: '{"hours": 24}',
    enabled: true,
    requires_approval: true,
    budget_tokens_per_run: 50000,
    budget_runs_per_day: 3,
  };
}

// ── Task card ─────────────────────────────────────────────────────────────────

function TaskCard({
  task,
  onEdit,
  onToggle,
  onRunNow,
  onDelete,
  running,
}: {
  task: ScheduledTask;
  onEdit: (t: ScheduledTask) => void;
  onToggle: (t: ScheduledTask) => void;
  onRunNow: (id: string) => void;
  onDelete: (id: string) => void;
  running: boolean;
}) {
  return (
    <div className={`rounded-2xl border p-5 transition-all ${task.enabled ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50 opacity-70"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TASK_TYPE_COLORS[task.task_type] ?? "bg-slate-100 text-slate-700"}`}>
              {TASK_TYPE_LABELS[task.task_type] ?? task.task_type}
            </span>
            {!task.enabled && (
              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-500">Désactivée</span>
            )}
            {task.requires_approval && (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">Approbation requise</span>
            )}
          </div>
          <p className="mt-1.5 text-sm font-semibold text-slate-900">{task.name}</p>
          {task.description && (
            <p className="mt-0.5 text-xs text-slate-500">{task.description}</p>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => onToggle(task)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              task.enabled
                ? "bg-slate-100 text-slate-700 hover:bg-slate-200"
                : "bg-green-100 text-green-800 hover:bg-green-200"
            }`}
          >
            {task.enabled ? "Désactiver" : "Activer"}
          </button>
          <button
            onClick={() => onEdit(task)}
            className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200"
          >
            Modifier
          </button>
          <button
            onClick={() => onRunNow(task.id)}
            disabled={running}
            className="rounded-lg bg-violet-100 px-3 py-1.5 text-xs font-medium text-violet-800 hover:bg-violet-200 disabled:opacity-50"
          >
            Lancer maintenant
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl bg-slate-50 px-3 py-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Planning</p>
          <p className="mt-0.5 text-xs font-semibold text-slate-700">{scheduleLabel(task)}</p>
        </div>
        <div className="rounded-xl bg-slate-50 px-3 py-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Budget / exéc.</p>
          <p className="mt-0.5 text-xs font-semibold text-slate-700">{fmtTokens(task.budget_tokens_per_run)} tokens</p>
        </div>
        <div className="rounded-xl bg-slate-50 px-3 py-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Max / jour</p>
          <p className="mt-0.5 text-xs font-semibold text-slate-700">{task.budget_runs_per_day} exéc.</p>
        </div>
        <div className="rounded-xl bg-slate-50 px-3 py-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Dernier run</p>
          <p className="mt-0.5 text-xs font-semibold text-slate-700">{fmtDate(task.last_run_at)}</p>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <p className="text-[10px] text-slate-400">
          Agent : <span className="font-medium text-slate-600">{task.agent}</span>
        </p>
        <button
          onClick={() => onDelete(task.id)}
          className="text-[10px] text-red-400 hover:text-red-600"
        >
          Supprimer
        </button>
      </div>
    </div>
  );
}

// ── Form panel ────────────────────────────────────────────────────────────────

function TaskForm({
  initial,
  onSave,
  onCancel,
  saving,
  error,
}: {
  initial: ReturnType<typeof emptyForm> | null;
  onSave: (data: ReturnType<typeof emptyForm>) => void;
  onCancel: () => void;
  saving: boolean;
  error: string;
}) {
  const [form, setForm] = useState(initial ?? emptyForm());
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="rounded-2xl border border-violet-200 bg-violet-50 p-6">
      <h3 className="text-sm font-semibold text-violet-900">
        {initial ? "Modifier la tâche" : "Nouvelle tâche autonome"}
      </h3>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-slate-700">Nom *</label>
          <input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
            placeholder="Ex : Veille bien-être hebdomadaire"
          />
        </div>

        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-slate-700">Description</label>
          <input
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
            placeholder="Ce que fait cette tâche"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700">Type de tâche</label>
          <select
            value={form.task_type}
            onChange={(e) => set("task_type", e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
          >
            <option value="veille">Veille web</option>
            <option value="mission">Mission directe</option>
            <option value="mission_proposals">Propositions d'agents</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700">Agent</label>
          <input
            value={form.agent}
            onChange={(e) => set("agent", e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
            placeholder="coordinateur"
          />
        </div>

        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-slate-700">
            {form.task_type === "veille" ? "Instructions spécifiques (optionnel)" : "Mission template *"}
          </label>
          <textarea
            value={form.mission_template}
            onChange={(e) => set("mission_template", e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
            placeholder={
              form.task_type === "veille"
                ? "Instructions complémentaires pour orienter la synthèse…"
                : "Texte complet de la mission à exécuter automatiquement"
            }
          />
        </div>

        {form.task_type === "veille" && (
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-700">
              Paramètres JSON (topics, rss_feeds, output_type…)
            </label>
            <textarea
              value={form.params_raw}
              onChange={(e) => set("params_raw", e.target.value)}
              rows={4}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-violet-400"
              placeholder={'{\n  "topics": ["bien-être émotionnel", "spiritualité", "tarot"],\n  "rss_feeds": [],\n  "output_type": "veille_summary"\n}'}
            />
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-slate-700">Type de planning</label>
          <select
            value={form.schedule_type}
            onChange={(e) => set("schedule_type", e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
          >
            <option value="interval">Intervalle (toutes les N heures)</option>
            <option value="cron">Cron (heure fixe)</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700">
            Config planning JSON
          </label>
          <input
            value={form.schedule_config_raw}
            onChange={(e) => set("schedule_config_raw", e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-violet-400"
            placeholder={form.schedule_type === "cron" ? '{"hour": 8, "minute": 0}' : '{"hours": 24}'}
          />
          <p className="mt-1 text-[10px] text-slate-400">
            {form.schedule_type === "interval"
              ? "Clés : weeks, days, hours, minutes"
              : "Clés : hour, minute, day_of_week (ex: mon-fri)"}
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700">Budget tokens / exéc.</label>
          <input
            type="number"
            value={form.budget_tokens_per_run}
            onChange={(e) => set("budget_tokens_per_run", parseInt(e.target.value) || 50000)}
            min={1000}
            max={2000000}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700">Max exécutions / jour</label>
          <input
            type="number"
            value={form.budget_runs_per_day}
            onChange={(e) => set("budget_runs_per_day", parseInt(e.target.value) || 3)}
            min={1}
            max={48}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
          />
        </div>

        <div className="flex items-center gap-6 sm:col-span-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => set("enabled", e.target.checked)}
              className="h-4 w-4 rounded"
            />
            Activée immédiatement
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.requires_approval}
              onChange={(e) => set("requires_approval", e.target.checked)}
              className="h-4 w-4 rounded"
            />
            Approbation requise avant publication
          </label>
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      )}

      <div className="mt-5 flex gap-3">
        <button
          onClick={() => onSave(form)}
          disabled={saving || !form.name.trim()}
          className="rounded-xl bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
        <button
          onClick={onCancel}
          className="rounded-xl border border-slate-200 px-5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Annuler
        </button>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AutonomieAdminPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editTask, setEditTask] = useState<ScheduledTask | null>(null);
  const [formError, setFormError] = useState("");
  const [runningId, setRunningId] = useState<string | null>(null);

  const tasks = useQuery({
    queryKey: ["scheduler-tasks"],
    queryFn: async () => {
      const { data } = await requestJson("/scheduler/tasks", { headers: agentHeaders() });
      return (data.tasks || []) as ScheduledTask[];
    },
    refetchInterval: 15000,
  });

  const saveMut = useMutation({
    mutationFn: async ({ form, id }: { form: ReturnType<typeof emptyForm>; id?: string }) => {
      let params: Record<string, unknown> = {};
      try { params = JSON.parse(form.params_raw || "{}"); } catch { /* ignore */ }
      let schedule_config: Record<string, unknown> = {};
      try { schedule_config = JSON.parse(form.schedule_config_raw || "{}"); } catch { /* ignore */ }

      const body = {
        name: form.name.trim(),
        description: form.description,
        task_type: form.task_type,
        agent: form.agent,
        mission_template: form.mission_template,
        params,
        schedule_type: form.schedule_type,
        schedule_config,
        enabled: form.enabled,
        requires_approval: form.requires_approval,
        budget_tokens_per_run: form.budget_tokens_per_run,
        budget_runs_per_day: form.budget_runs_per_day,
      };

      if (id) {
        return requestJson(`/scheduler/tasks/${id}`, { method: "PUT", headers: agentHeaders(), body: JSON.stringify(body) });
      }
      return requestJson("/scheduler/tasks", { method: "POST", headers: agentHeaders(), body: JSON.stringify(body) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scheduler-tasks"] });
      setShowForm(false);
      setEditTask(null);
      setFormError("");
    },
    onError: (err: Error) => setFormError(String(err.message || err)),
  });

  const toggleMut = useMutation({
    mutationFn: async (task: ScheduledTask) =>
      requestJson(`/scheduler/tasks/${task.id}`, {
        method: "PUT",
        headers: agentHeaders(),
        body: JSON.stringify({ enabled: !task.enabled }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scheduler-tasks"] }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) =>
      requestJson(`/scheduler/tasks/${id}`, { method: "DELETE", headers: agentHeaders() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scheduler-tasks"] }),
  });

  const runNow = async (id: string) => {
    setRunningId(id);
    try {
      await requestJson(`/scheduler/tasks/${id}/run-now`, { method: "POST", headers: agentHeaders() });
    } finally {
      setRunningId(null);
    }
  };

  const handleSave = (form: ReturnType<typeof emptyForm>) => {
    setFormError("");
    try {
      JSON.parse(form.params_raw || "{}");
      JSON.parse(form.schedule_config_raw || "{}");
    } catch {
      setFormError("Le JSON des paramètres ou du planning est invalide.");
      return;
    }
    saveMut.mutate({ form, id: editTask?.id });
  };

  const openEdit = (task: ScheduledTask) => {
    setEditTask(task);
    setShowForm(true);
  };

  const enabledCount = (tasks.data || []).filter((t) => t.enabled).length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Tâches autonomes</h1>
          <p className="mt-1 text-sm text-slate-500">
            Les agents travaillent en arrière-plan selon le planning configuré,
            dans les limites de budget définies.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {tasks.data && (
            <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-medium text-violet-800">
              {enabledCount} actives / {tasks.data.length} total
            </span>
          )}
          <button
            onClick={() => { setEditTask(null); setShowForm(true); setFormError(""); }}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            + Nouvelle tâche
          </button>
        </div>
      </div>

      {/* Panneau info budget */}
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
        <p className="text-sm font-semibold text-amber-900">Garde-fous actifs</p>
        <p className="mt-1 text-xs text-amber-700">
          Chaque tâche est soumise à un plafond de tokens par exécution et un plafond de runs par jour.
          Si un plafond est atteint, l'exécution est annulée silencieusement.
          Les outputs sont déposés en file d'approbation avant toute publication externe.
        </p>
      </div>

      {/* Formulaire */}
      {showForm && (
        <TaskForm
          initial={
            editTask
              ? {
                  name: editTask.name,
                  description: editTask.description,
                  task_type: editTask.task_type,
                  agent: editTask.agent,
                  mission_template: editTask.mission_template,
                  params_raw: JSON.stringify(editTask.params || {}, null, 2),
                  schedule_type: editTask.schedule_type,
                  schedule_config_raw: JSON.stringify(editTask.schedule_config || {}, null, 2),
                  enabled: editTask.enabled,
                  requires_approval: editTask.requires_approval,
                  budget_tokens_per_run: editTask.budget_tokens_per_run,
                  budget_runs_per_day: editTask.budget_runs_per_day,
                }
              : null
          }
          onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditTask(null); setFormError(""); }}
          saving={saveMut.isPending}
          error={formError}
        />
      )}

      {/* Liste des tâches */}
      {tasks.isPending ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
          Chargement…
        </div>
      ) : tasks.isError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          Erreur de chargement des tâches.
        </div>
      ) : (tasks.data || []).length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
          <p className="text-sm font-medium text-slate-500">Aucune tâche autonome configurée</p>
          <p className="mt-1 text-xs text-slate-400">
            Créez votre première tâche pour que les agents commencent à travailler pendant que vous dormez.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {(tasks.data || []).map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onEdit={openEdit}
              onToggle={(t) => toggleMut.mutate(t)}
              onRunNow={runNow}
              onDelete={(id) => { if (confirm("Supprimer cette tâche ?")) deleteMut.mutate(id); }}
              running={runningId === task.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
