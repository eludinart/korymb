/**
 * Types et helpers pour le bandeau d'activité agents (jobs en cours).
 */
import { summarizeMissionEvent } from "./missionEvents";
import type { MissionJobEvent } from "./types";

export type ActiveAgentJob = {
  job_id: string;
  mission?: string;
  status?: string;
  source?: string;
  agent?: string;
  team?: Array<{ key?: string; label?: string; status?: string; phase?: string; detail?: string }>;
  parent_job_id?: string | null;
  chat_session_id?: string | null;
  created_at?: string;
  tokens_in?: number;
  tokens_out?: number;
  events?: MissionJobEvent[];
  events_total?: number;
  last_event_type?: string | null;
  last_event_agent?: string | null;
  last_event_preview?: string | null;
  pause_requested?: boolean;
  cancel_requested?: boolean;
  /** True si un thread serveur exécute réellement ce job. */
  execution_live?: boolean;
};

export function activeJobSourceLabel(job: ActiveAgentJob): string {
  const src = String(job.source || "mission").toLowerCase();
  const st = String(job.status || "");
  if (st === "awaiting_validation") return "Validation requise";
  if (src === "chat") return job.parent_job_id ? "Chat · suite mission" : "Chat";
  if (src === "scheduler" || src === "autonomous") return "Autonomie";
  return "Mission";
}

export function activeJobSourceTone(job: ActiveAgentJob): "chat" | "mission" | "hitl" | "auto" {
  const st = String(job.status || "");
  if (st === "awaiting_validation") return "hitl";
  const src = String(job.source || "mission").toLowerCase();
  if (src === "chat") return "chat";
  if (src === "scheduler" || src === "autonomous") return "auto";
  return "mission";
}

export function activeJobHref(job: ActiveAgentJob): string {
  const jid = job.job_id;
  const src = String(job.source || "").toLowerCase();
  if (src === "chat") {
    const q = new URLSearchParams();
    if (job.chat_session_id) q.set("session", job.chat_session_id);
    q.set("job", jid);
    if (job.parent_job_id) q.set("parent", job.parent_job_id);
    return `/chat?${q.toString()}`;
  }
  return `/missions?job=${encodeURIComponent(jid)}`;
}

export function clipMissionTitle(mission: string | undefined, max = 72): string {
  const t = (mission || "").replace(/\s+/g, " ").trim();
  if (!t) return "Travail en cours…";
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function statusLabelFr(status: string | undefined): string {
  switch (status) {
    case "running":
      return "En cours";
    case "pending":
      return "En file";
    case "awaiting_validation":
      return "À valider";
    case "paused":
      return "En pause";
    case "cancelled":
      return "Arrêté";
    default:
      return status || "—";
  }
}

/** Styles visuels selon l'état du processus (bandeau d'activité). */
export type JobLifecycleVisual = {
  label: string;
  badgeClass: string;
  cardClass: string;
  dotClass: string;
  animateDot: boolean;
};

export function jobLifecycleVisual(job: ActiveAgentJob): JobLifecycleVisual {
  if (job.cancel_requested) {
    return {
      label: "Arrêt en cours…",
      badgeClass: "bg-red-100 text-red-950 ring-red-300",
      cardClass: "border-red-300 bg-red-50/70 ring-red-100",
      dotClass: "bg-red-500",
      animateDot: true,
    };
  }
  if (job.execution_live === false && (job.status === "running" || job.status === "pending")) {
    return {
      label: "Fantôme",
      badgeClass: "bg-slate-200 text-slate-800 ring-slate-300",
      cardClass: "border-slate-300 bg-slate-50/90 ring-slate-200",
      dotClass: "bg-slate-500",
      animateDot: false,
    };
  }
  if (job.status === "paused" || job.pause_requested) {
    return {
      label: "En pause",
      badgeClass: "bg-amber-100 text-amber-950 ring-amber-300",
      cardClass: "border-amber-300 bg-amber-50/80 ring-amber-200",
      dotClass: "bg-amber-500",
      animateDot: false,
    };
  }
  if (job.status === "awaiting_validation") {
    return {
      label: "À valider",
      badgeClass: "bg-orange-100 text-orange-950 ring-orange-200",
      cardClass: "border-orange-200 bg-orange-50/50 ring-orange-100",
      dotClass: "bg-orange-500",
      animateDot: false,
    };
  }
  if (job.status === "pending") {
    return {
      label: "En file",
      badgeClass: "bg-slate-100 text-slate-700 ring-slate-200",
      cardClass: "border-slate-200 bg-slate-50/80 ring-slate-100",
      dotClass: "bg-slate-400",
      animateDot: false,
    };
  }
  return {
    label: "En cours",
    badgeClass: "bg-violet-100 text-violet-900 ring-violet-200",
    cardClass: "border-violet-200/80 bg-white ring-violet-100/60",
    dotClass: "bg-violet-500",
    animateDot: true,
  };
}

export type ActiveJobsSnapshot = {
  jobs: ActiveAgentJob[];
  recentlyStopped: ActiveAgentJob[];
  orphanCount?: number;
};

const ACTIVE_JOB_STATUSES = new Set(["running", "pending", "awaiting_validation", "paused"]);

const AGENT_SHORT: Record<string, string> = {
  coordinateur: "CIO",
  commercial: "COM.",
  community_manager: "CM",
  developpeur: "DEV.",
  comptable: "COMPTA.",
};

const CREATING_TOOL_RE =
  /upload_google_drive|google_doc|google_sheet|spreadsheet|create_.*drive|export.*drive/i;

export type JobWorkIntensity = "creating" | "working" | "waiting" | "queued";

export type JobWorkFocus = {
  agentKey: string;
  agentLabel: string;
  activityHeadline: string;
  activityDetail: string;
  intensity: JobWorkIntensity;
};

function agentShortLabel(key: string, fallback?: string): string {
  const k = key.trim().toLowerCase();
  if (AGENT_SHORT[k]) return AGENT_SHORT[k];
  if (fallback?.trim()) return fallback.trim();
  return k.replace(/_/g, " ").slice(0, 12) || "Agent";
}

function statusRank(status: string | undefined): number {
  switch (status) {
    case "running":
      return 300;
    case "paused":
      return 200;
    case "pending":
      return 120;
    case "awaiting_validation":
      return 80;
    default:
      return 0;
  }
}

function eventRank(type: string | undefined): number {
  switch (type) {
    case "tool_call":
      return 90;
    case "sub_agent_working":
      return 80;
    case "agent_turn_start":
      return 70;
    case "synthesis_start":
      return 55;
    case "delegation":
    case "orchestration_start":
    case "plan_parsed":
      return 40;
    case "instruction_delivered":
      return 30;
    default:
      return 0;
  }
}

/** Score « travail réel » pour prioriser le job affiché en bandeau replié. */
export function scoreActiveJobPriority(job: ActiveAgentJob): number {
  let score = statusRank(job.status);
  score += eventRank(job.last_event_type || undefined);
  const lastType = String(job.last_event_type || "");
  if (lastType === "tool_call") {
    const preview = String(job.last_event_preview || "");
    if (CREATING_TOOL_RE.test(preview)) score += 40;
    else score += 20;
  }
  if (job.status === "running" && (job.tokens_out || 0) > 0) score += 5;
  const team = job.team || [];
  for (const row of team) {
    const st = String(row.status || "").toLowerCase();
    const phase = String(row.phase || "").toLowerCase();
    if (st === "working" || phase === "tool" || phase === "delegate") score += 25;
  }
  return score;
}

export function pickPrimaryActiveJob(jobs: ActiveAgentJob[]): ActiveAgentJob | null {
  if (!jobs.length) return null;
  return (
    [...jobs].sort((a, b) => {
      const liveA = a.execution_live === false ? 0 : 1;
      const liveB = b.execution_live === false ? 0 : 1;
      if (liveB !== liveA) return liveB - liveA;
      return scoreActiveJobPriority(b) - scoreActiveJobPriority(a);
    })[0] ?? null
  );
}

function toolCreatesDeliverable(toolHint: string): boolean {
  return CREATING_TOOL_RE.test(toolHint);
}

function resolveWorkingAgentKey(job: ActiveAgentJob): string {
  const lastAgent = String(job.last_event_agent || "").trim().toLowerCase();
  if (lastAgent && lastAgent !== "dirigeant") return lastAgent;

  const team = job.team || [];
  for (const row of team) {
    const key = String(row.key || "").trim().toLowerCase();
    const st = String(row.status || "").toLowerCase();
    const phase = String(row.phase || "").toLowerCase();
    if (!key || key === "dirigeant") continue;
    if (st === "working" || phase === "tool" || phase === "delegate" || phase === "synth") return key;
  }

  return String(job.agent || "coordinateur").trim().toLowerCase() || "coordinateur";
}

/** Agent + activité réelle pour le bandeau replié. */
export function resolveJobWorkFocus(job: ActiveAgentJob): JobWorkFocus {
  const agentKey = resolveWorkingAgentKey(job);
  const teamRow = (job.team || []).find((r) => String(r.key || "").toLowerCase() === agentKey);
  const agentLabel = agentShortLabel(agentKey, teamRow?.label);
  const lastType = String(job.last_event_type || "");
  const events = job.events || [];
  const lastEv = events.length ? events[events.length - 1] : null;
  const preview =
    String(job.last_event_preview || "").trim() ||
    (lastEv ? summarizeMissionEvent(lastEv) : "") ||
    String(job.last_event_type || "").trim();
  const status = String(job.status || "");

  if (status === "awaiting_validation") {
    return {
      agentKey,
      agentLabel,
      activityHeadline: "Validation attendue",
      activityDetail: "Votre arbitrage bloque la suite",
      intensity: "waiting",
    };
  }

  if (status === "pending") {
    return {
      agentKey,
      agentLabel,
      activityHeadline: "En file d'attente",
      activityDetail: preview || "Démarrage imminent",
      intensity: "queued",
    };
  }

  if (lastType === "tool_call") {
    const creating = toolCreatesDeliverable(preview);
    return {
      agentKey,
      agentLabel,
      activityHeadline: creating ? "Production livrable" : "Recherche / outil actif",
      activityDetail: preview || "Appel outil",
      intensity: creating ? "creating" : "working",
    };
  }

  if (lastType === "sub_agent_working" || lastType === "agent_turn_start") {
    return {
      agentKey,
      agentLabel,
      activityHeadline: "Travail en cours",
      activityDetail: preview || teamRow?.detail || "Tour agent",
      intensity: "working",
    };
  }

  if (lastType === "synthesis_start" || lastType === "synthesis_done") {
    return {
      agentKey: "coordinateur",
      agentLabel: "CIO",
      activityHeadline: lastType === "synthesis_start" ? "Synthèse en cours" : "Synthèse terminée",
      activityDetail: preview || "Rédaction pour le dirigeant",
      intensity: "working",
    };
  }

  if (status === "running") {
    return {
      agentKey,
      agentLabel,
      activityHeadline: "Orchestration active",
      activityDetail: preview || teamRow?.detail || "Mission en arrière-plan",
      intensity: "working",
    };
  }

  return {
    agentKey,
    agentLabel,
    activityHeadline: statusLabelFr(status),
    activityDetail: preview,
    intensity: "queued",
  };
}

/**
 * Distingue « un agent calcule en ce moment » de « le processus est ouvert mais personne ne travaille ».
 *
 * - working   : un agent (LLM/outil) tourne réellement, activité récente
 * - between   : en cours mais entre deux étapes / génération longue (toléré)
 * - stalled   : marqué « en cours » mais aucune activité depuis longtemps (probablement bloqué)
 * - waiting   : ouvert, en attente de VOTRE arbitrage (aucun agent ne travaille)
 * - paused    : suspendu par vous
 * - queued    : en file, pas encore démarré
 * - stopped   : fantôme (plus aucun thread serveur)
 */
export type AgentActivityState = "working" | "between" | "stalled" | "waiting" | "paused" | "queued" | "stopped";

export type AgentActivity = {
  state: AgentActivityState;
  /** true uniquement si un agent calcule réellement maintenant. */
  working: boolean;
  label: string;
  /** Ancienneté du dernier événement, en secondes (si connue). */
  ageSeconds?: number;
  freshness: string;
};

const ACTIVE_WORK_EVENTS = new Set([
  "tool_call",
  "agent_turn_start",
  "sub_agent_working",
  "synthesis_start",
  "orchestration_start",
  "delegation",
  "instruction_delivered",
  "handoff",
  "refinement_round",
  "mission_start",
  "plan_parsed",
  "team_dialogue",
]);

/** Au-delà, un job « en cours » sans nouvel événement est considéré possiblement bloqué. */
const WORKING_WINDOW_SECONDS = 150;

function lastEventTimestamp(job: ActiveAgentJob): number | undefined {
  const events = job.events || [];
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ts = events[i]?.ts;
    if (ts) {
      const ms = new Date(ts).getTime();
      if (!Number.isNaN(ms)) return ms;
    }
  }
  return undefined;
}

function formatAge(seconds: number): string {
  if (seconds < 5) return "à l'instant";
  if (seconds < 60) return `il y a ${Math.round(seconds)} s`;
  const min = Math.round(seconds / 60);
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  return `il y a ${h} h`;
}

export function resolveAgentActivity(job: ActiveAgentJob, nowMs: number = Date.now()): AgentActivity {
  const status = String(job.status || "");

  if (status === "awaiting_validation") {
    return { state: "waiting", working: false, label: "En attente de vous", freshness: "Aucun agent ne travaille — votre arbitrage est requis" };
  }
  if (status === "paused" || job.pause_requested) {
    return { state: "paused", working: false, label: "En pause", freshness: "Suspendu — reprenez pour relancer les agents" };
  }
  if (status === "pending") {
    return { state: "queued", working: false, label: "En file", freshness: "Pas encore démarré" };
  }
  if (job.execution_live === false) {
    return { state: "stopped", working: false, label: "Inactif", freshness: "Plus aucun agent en exécution (à nettoyer)" };
  }

  // status running, exécution vivante (ou inconnue) → on regarde la fraîcheur réelle de l'activité.
  const lastMs = lastEventTimestamp(job);
  const lastType = String(job.last_event_type || "");
  if (lastMs === undefined) {
    return { state: "working", working: true, label: "Agents au travail", freshness: "Activité en cours" };
  }
  const ageSeconds = Math.max(0, (nowMs - lastMs) / 1000);
  const fresh = formatAge(ageSeconds);

  if (ageSeconds > WORKING_WINDOW_SECONDS) {
    return {
      state: "stalled",
      working: false,
      label: "Ouvert · inactif",
      ageSeconds,
      freshness: `Aucune activité depuis ${fresh.replace("il y a ", "")} — peut-être bloqué`,
    };
  }

  const activeType = !lastType || ACTIVE_WORK_EVENTS.has(lastType);
  return {
    state: activeType ? "working" : "between",
    working: true,
    label: activeType ? "Agents au travail" : "Entre deux étapes",
    ageSeconds,
    freshness: `Dernière activité ${fresh}`,
  };
}

const ACTIVITY_DOT: Record<AgentActivityState, string> = {
  working: "bg-emerald-500",
  between: "bg-violet-500",
  stalled: "bg-slate-400",
  waiting: "bg-amber-500",
  paused: "bg-amber-500",
  queued: "bg-slate-400",
  stopped: "bg-slate-400",
};

export function agentActivityDotClass(state: AgentActivityState): string {
  return ACTIVITY_DOT[state];
}

const INTENSITY_STYLES: Record<JobWorkIntensity, string> = {
  creating: "bg-emerald-600 text-white ring-emerald-300",
  working: "bg-violet-600 text-white ring-violet-300",
  waiting: "bg-amber-500 text-white ring-amber-300",
  queued: "bg-slate-500 text-white ring-slate-300",
};

const INTENSITY_PULSE: Record<JobWorkIntensity, string> = {
  creating: "bg-emerald-400",
  working: "bg-violet-400",
  waiting: "bg-amber-400",
  queued: "bg-slate-400",
};

export function workIntensityDotClass(intensity: JobWorkIntensity): string {
  return INTENSITY_STYLES[intensity];
}

export function workIntensityPulseClass(intensity: JobWorkIntensity): string {
  return INTENSITY_PULSE[intensity];
}

async function enrichPrimaryJobEvents(
  jobs: ActiveAgentJob[],
  requestJson: (
    path: string,
    options?: { headers?: Record<string, string>; retries?: number; timeoutMs?: number; expectOk?: boolean },
  ) => Promise<{ res: Response; data: Record<string, unknown> }>,
  agentHeaders: () => Record<string, string>,
): Promise<ActiveAgentJob[]> {
  const primary = pickPrimaryActiveJob(jobs);
  if (!primary || primary.status !== "running" || (primary.events?.length ?? 0) > 0) {
    return jobs;
  }
  const { res, data } = await requestJson(
    `/jobs/${encodeURIComponent(primary.job_id)}?log_offset=0&events_offset=0`,
    { headers: agentHeaders(), retries: 1, timeoutMs: 12_000, expectOk: false },
  );
  if (!res.ok) return jobs;
  const events = (data.events as MissionJobEvent[]) || [];
  const last = events.length ? events[events.length - 1] : null;
  return jobs.map((j) =>
    j.job_id === primary.job_id
      ? {
          ...j,
          team: (data.team as ActiveAgentJob["team"]) || j.team,
          events: events.slice(-60),
          events_total: events.length,
          last_event_type: last ? String(last.type || "") : j.last_event_type,
          last_event_agent: last ? String(last.agent || "") : j.last_event_agent,
          last_event_preview: last ? summarizeMissionEvent(last).slice(0, 140) : j.last_event_preview,
        }
      : j,
  );
}

/** Jobs en cours — `/jobs/active` si disponible, sinon repli sur `/jobs/light`. */
export async function fetchActiveAgentJobs(
  requestJson: (
    path: string,
    options?: { headers?: Record<string, string>; retries?: number; timeoutMs?: number; expectOk?: boolean },
  ) => Promise<{ res: Response; data: Record<string, unknown> }>,
  agentHeaders: () => Record<string, string>,
): Promise<ActiveJobsSnapshot> {
  const opts = { headers: agentHeaders(), retries: 1, timeoutMs: 12_000, expectOk: false };

  const primary = await requestJson("/jobs/active", opts);
  if (primary.res.ok) {
    const jobs = ((primary.data.jobs as ActiveAgentJob[]) || []).filter((j) => j?.job_id);
    const recentlyStopped = ((primary.data.recently_stopped as ActiveAgentJob[]) || []).filter(
      (j) => j?.job_id,
    );
    const orphanCount = Number(primary.data.orphan_count ?? 0);
    return { jobs, recentlyStopped, orphanCount };
  }

  if (primary.res.status === 404 || primary.res.status === 405) {
    const light = await requestJson("/jobs/light?limit=40", opts);
    if (!light.res.ok) {
      const detail = String((light.data as { detail?: string }).detail || "");
      throw new Error(detail || `HTTP ${light.res.status}`);
    }
    const rows = (light.data.jobs as Array<Record<string, unknown>>) || [];
    const mapped = rows
      .filter((j) => ACTIVE_JOB_STATUSES.has(String(j.status || "")))
      .map((j) => ({
        job_id: String(j.job_id || ""),
        mission: String(j.mission || ""),
        status: String(j.status || ""),
        source: String(j.source || "mission"),
        agent: String(j.agent || ""),
        created_at: String(j.created_at || ""),
        tokens_in: Number(j.tokens_in || 0),
        tokens_out: Number(j.tokens_out || 0),
        events: [],
      }));
    const jobs = await enrichPrimaryJobEvents(mapped, requestJson, agentHeaders);
    return { jobs, recentlyStopped: [] };
  }

  const detail = String((primary.data as { detail?: string }).detail || "");
  throw new Error(detail || `HTTP ${primary.res.status}`);
}
