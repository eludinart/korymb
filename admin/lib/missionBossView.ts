import { stripMarkdownLight } from "./normalizeLooseMarkdown";
import type { BossJobLike } from "@/lib/types";

/** Vue « grand pilotage » : tri des missions et libellés de statut homogènes. */

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
    return { label: "En attente HITL", className: "bg-violet-100 text-violet-950 ring-1 ring-violet-300" };
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
    return String(b.job_id || "").localeCompare(String(a.job_id || ""));
  });
}
