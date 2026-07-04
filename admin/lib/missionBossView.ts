import { stripMarkdownLight } from "./normalizeLooseMarkdown";
import type { BossJobLike } from "@/lib/types";

/** Identifiant job normalisé (64 car. max — ids type delivlib_merge_xxx). */
export const JOB_ID_MAX_LEN = 64;

export function normalizeJobId(id: string | null | undefined): string {
  return String(id || "").trim().slice(0, JOB_ID_MAX_LEN);
}

/** Signature stable pour regrouper les relances identiques. */
export function normalizeMissionSignature(mission: string | null | undefined): string {
  const raw = stripMarkdownLight(String(mission || ""))
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return raw.slice(0, 120);
}

type MissionClusterJob = BossJobLike & { agent?: string | null; mission?: string | null };

function clusterIndex<T extends MissionClusterJob>(rows: T[]): {
  byId: Map<string, T>;
  ids: Set<string>;
} {
  const byId = new Map<string, T>();
  for (const j of rows) {
    const id = normalizeJobId(j.job_id);
    if (id) byId.set(id, j);
  }
  return { byId, ids: new Set(byId.keys()) };
}

/**
 * Clé de regroupement : chaîne parent/enfant, frères (même parent absent de la liste),
 * ou relances identiques (même agent + même brief).
 */
export function missionClusterKey<T extends MissionClusterJob>(job: T, rows: T[]): string {
  const { byId, ids } = clusterIndex(rows);
  const self = normalizeJobId(job.job_id);
  const parent = normalizeJobId(job.parent_job_id);

  if (parent && parent !== self) {
    if (ids.has(parent)) {
      let cur = self;
      let p = parent;
      const seen = new Set<string>();
      while (p && ids.has(p) && !seen.has(p)) {
        seen.add(cur);
        cur = p;
        p = normalizeJobId(byId.get(cur)?.parent_job_id);
      }
      return `root:${cur}`;
    }
    return `parent:${parent}`;
  }

  const sig = normalizeMissionSignature(job.mission);
  const agent = String(job.agent || "coordinateur").trim().toLowerCase();
  return `sig:${agent}:${sig || self}`;
}

/** Regroupe les jobs d'un même dossier / relance et ne garde qu'une carte représentative. */
export function dedupeMissionListJobs<T extends MissionClusterJob>(rows: T[]): T[] {
  if (rows.length <= 1) return rows;

  const groups = new Map<string, T[]>();
  for (const j of rows) {
    const key = missionClusterKey(j, rows);
    const list = groups.get(key) || [];
    list.push(j);
    groups.set(key, list);
  }

  return [...groups.values()].map((group) => sortJobsForBossView(group)[0]);
}

/** @deprecated Utiliser dedupeMissionListJobs — conservé pour compatibilité interne. */
export function filterRootMissionJobs<T extends MissionClusterJob>(rows: T[]): T[] {
  return dedupeMissionListJobs(rows);
}

/** Tous les job_id d'un même cluster (suppression groupée). */
export function collectMissionClusterJobIds<T extends MissionClusterJob>(
  primaryJobId: string,
  allJobs: T[],
): string[] {
  const primary = allJobs.find((j) => normalizeJobId(j.job_id) === normalizeJobId(primaryJobId));
  if (!primary) return [normalizeJobId(primaryJobId)].filter(Boolean);

  const key = missionClusterKey(primary, allJobs);
  const ids = new Set<string>();
  for (const j of allJobs) {
    if (missionClusterKey(j, allJobs) === key) ids.add(normalizeJobId(j.job_id));
  }
  return [...ids];
}

export type { BossJobLike } from "@/lib/types";

export function missionStatusMeta(status?: string | null): { label: string; className: string } {
  const s = String(status || "unknown").toLowerCase();
  if (s === "running" || s === "in_progress")
    return { label: "En cours", className: "bg-amber-100 text-amber-950 ring-1 ring-amber-200" };
  if (s === "completed")
    return { label: "Terminée", className: "bg-emerald-100 text-emerald-950 ring-1 ring-emerald-200" };
  if (s === "cancelled")
    return { label: "Interrompue", className: "bg-orange-100 text-orange-950 ring-1 ring-orange-200" };
  if (s === "pending" || s === "accepted")
    return { label: "En attente", className: "bg-slate-100 text-slate-800 ring-1 ring-slate-200" };
  if (s === "awaiting_validation")
    return { label: "HITL requis", className: "bg-violet-200 text-violet-950 ring-2 ring-violet-400" };
  if (s === "quality_blocked")
    return { label: "Qualité bloquée", className: "bg-rose-200 text-rose-950 ring-2 ring-rose-400" };
  if (s.startsWith("error") || s === "failed")
    return { label: "Erreur", className: "bg-red-100 text-red-950 ring-1 ring-red-200" };
  return { label: status || "—", className: "bg-slate-100 text-slate-800 ring-1 ring-slate-200" };
}

/** Texte brut court pour aperçu dans les listes (hors rendu markdown). */
export function plainTextSnippet(raw: string | null | undefined, max = 130): string {
  if (!raw?.trim()) return "";
  const t = stripMarkdownLight(raw).replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

/**
 * Priorité opérationnelle : à valider → en cours → avec livrable → reste.
 * Stable par job_id décroissant pour les ex aequo.
 */
export function sortJobsForBossView<T extends BossJobLike>(rows: T[]): T[] {
  const score = (j: T) => {
    const closed = j.user_validated_at || j.mission_closed_by_user;
    const canValidate = j.status === "completed" && !closed;
    if (canValidate) return 0;
    if (j.status === "awaiting_validation") return 0.5;
    if (j.status === "running" || j.status === "in_progress") return 1;
    if (String(j.result || "").trim()) return 2;
    if (j.status === "completed") return 3;
    return 4;
  };
  return [...rows].sort((a, b) => {
    const d = score(a) - score(b);
    if (d !== 0) return d;
    const at = String(a.created_at || a.job_id || "");
    const bt = String(b.created_at || b.job_id || "");
    return bt.localeCompare(at);
  });
}
