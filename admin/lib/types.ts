/**
 * admin/lib/types.ts — Types canoniques centralisés KORYMB Admin.
 *
 * Source de vérité pour Agent, Job, Memory, Mission et les nouvelles
 * capacités de la triade agentique (TriadMode, MissionConfig, CriticVerdict).
 *
 * Remplace les types dupliqués dans les pages et composants.
 */

// ── Agents ───────────────────────────────────────────────────────────────────

export type Agent = {
  key: string;
  label: string;
  role?: string;
  tools?: string[];
  is_manager?: boolean;
  builtin?: boolean;
  system?: string;
};

// ── Jobs ─────────────────────────────────────────────────────────────────────

/** Mode d'orchestration de la mission */
export type TriadMode = "triad" | "cio" | "single";

/** Configuration de lancement persistée sur le job */
export type MissionConfig = {
  recursive_refinement_enabled?: boolean;
  recursive_max_rounds?: number;
  require_user_validation?: boolean;
  /** Mode d'orchestration : 'cio' (défaut), 'triad' (Architect/Executor/Critic), 'single' */
  mode?: TriadMode;
};

/** Job complet (GET /jobs/{id}) */
export type Job = {
  job_id: string;
  mission?: string;
  status?: string;
  agent?: string;
  result?: string | null;
  tokens_total?: number;
  cost_usd?: number;
  events_total?: number;
  log_total?: number;
  events?: unknown[];
  mission_thread?: unknown[];
  team?: unknown;
  logs?: string[];
  mission_config?: MissionConfig;
  user_validated_at?: string | null;
  mission_closed_by_user?: boolean;
  created_at?: string;
  updated_at?: string;
  parent_job_id?: string | null;
};

/** Ligne Job légère (liste /jobs) */
export type JobRow = {
  job_id: string;
  mission?: string;
  status?: string;
  agent?: string;
  team?: unknown;
  created_at?: string;
  result?: string | null;
  tokens_total?: number;
  cost_usd?: number;
  events_count?: number;
  delivery_warnings?: string[];
  delivery_blocked?: boolean;
  user_validated_at?: string | null;
  mission_closed_by_user?: boolean;
  mission_config?: MissionConfig;
};

/** Shape minimal pour le tri boss-view */
export type BossJobLike = {
  job_id: string;
  status?: string;
  user_validated_at?: string | null;
  result?: string | null;
};

// ── Triade agentique ──────────────────────────────────────────────────────────

/** Verdict du Critique (Avocat du Diable) */
export type CriticVerdict = {
  rejected: boolean;
  alignment_score?: number;
  critique?: string;
  feedback?: string;
  approved_sections?: string[];
};

/** Résultat de la triade pour un job en mode "triad" */
export type TriadTrace = {
  architect_plan?: string;
  executor_result?: string;
  critic_verdict?: CriticVerdict;
  retries?: number;
};

// ── HITL (Human-In-The-Loop) ─────────────────────────────────────────────────

export type HitlGatePayload = {
  job_id: string;
  mission: string;
  result_preview: string;
  reviewer: string;
};

export type HitlStatus = {
  job_id: string;
  status?: string;
  hitl?: {
    gate?: HitlGatePayload;
    resolved_at?: string | null;
    comment?: string | null;
  } | null;
};

export type HitlValidateRequest = {
  approved: boolean;
  comment?: string;
};

// ── Events mission ────────────────────────────────────────────────────────────

export type MissionJobEvent = {
  v?: number;
  ts?: string;
  type?: string;
  agent?: string | null;
  payload?: Record<string, unknown>;
};

// ── Live flow ─────────────────────────────────────────────────────────────────

export type LiveFlowStep = {
  id: string;
  type: string;
  agent?: string | null;
  label?: string;
  ts?: string;
  detail?: string;
  status?: "running" | "done" | "error" | "pending";
};

// ── Memory ────────────────────────────────────────────────────────────────────

export type MemoryPayload = {
  contexts?: Record<string, string>;
  recent_missions?: unknown[];
  updated_at?: string | null;
};

export type MemoryContextKey =
  | "global"
  | "commercial"
  | "community_manager"
  | "developpeur"
  | "comptable"
  | string;

// ── Team / agents dans un job ─────────────────────────────────────────────────

export type TeamRow = {
  key?: string;
  label?: string;
  status?: string;
  phase?: string;
  detail?: string;
  tokens_in?: number;
  tokens_out?: number;
};

// ── Dashboard ─────────────────────────────────────────────────────────────────

export type AgentCard = {
  key: string;
  label: string;
  role?: string;
};

// ── Knowledge Graph (entités KORYMB) ─────────────────────────────────────────

export type KnowledgeEntity = {
  entity_id?: number;
  name: string;
  entity_type: "person" | "org" | "project" | string;
  attributes?: Record<string, string>;
  relations?: Record<string, string | string[]>;
  updated_at?: string;
};
