import type { QueryClient } from "@tanstack/react-query";
import { missionActionLabel } from "./missionLabel";
import {
  collectMissionClusterJobIds,
  missionClusterKey,
  normalizeJobId,
} from "./missionBossView";
import { deleteMissionJob, deletedCountFrom } from "./deleteMissionJob";
import { QK } from "./queryClient";

import type { Job } from "./types";

export { normalizeJobId } from "./missionBossView";

/** Classe Tailwind commune pour les boutons « Supprimer » (cible tactile ≥ 44px). */
export const BTN_DELETE =
  "touch-target inline-flex items-center justify-center rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800 hover:bg-red-100 disabled:opacity-40";

export function invalidateAfterMissionDelete(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: QK.jobsCards });
  void qc.invalidateQueries({ queryKey: QK.jobsLight });
  void qc.invalidateQueries({ queryKey: QK.jobsActive });
  void qc.invalidateQueries({ queryKey: QK.operationalMap });
  void qc.invalidateQueries({ queryKey: ["admin-inbox"] });
  void qc.invalidateQueries({ queryKey: ["admin-briefing"] });
  void qc.invalidateQueries({ queryKey: QK.tokens });
  void qc.invalidateQueries({ queryKey: QK.deliverablesLibrary });
}

function isChatJob(job: Job | undefined): boolean {
  return String(job?.source || "").toLowerCase().startsWith("chat");
}

function missionLikeJobs(jobs: Job[]): Job[] {
  return jobs.filter((j) => !isChatJob(j));
}

function jobsInCluster(jobs: Job[], clusterKey: string): Job[] {
  const missionJobs = missionLikeJobs(jobs);
  return missionJobs.filter((j) => missionClusterKey(j, missionJobs) === clusterKey);
}

/** Jobs visibles du même cluster mission (hors conversations chat). */
export function collectMissionDeleteJobIds(primaryJobId: string, allJobs: Job[]): string[] {
  return collectMissionClusterJobIds(primaryJobId, missionLikeJobs(allJobs));
}

/** Supprime les jobs demandés. Un chat n'entraîne que sa session, pas les autres prompts identiques. */
export async function deleteMissionJobBundle(jobIds: string[], allJobs: Job[] = []): Promise<number> {
  const requested = [...new Set(jobIds.map((id) => normalizeJobId(id)).filter(Boolean))];
  if (!requested.length) throw new Error("Identifiant manquant.");

  const targets = new Set<string>(requested);
  const missionPool = missionLikeJobs(allJobs);

  for (const id of requested) {
    const job = allJobs.find((j) => normalizeJobId(j.job_id) === id);
    if (isChatJob(job)) {
      const session = String(job?.chat_session_id || "").trim();
      if (session) {
        for (const other of allJobs) {
          if (!isChatJob(other)) continue;
          if (String(other.chat_session_id || "").trim() !== session) continue;
          const oid = normalizeJobId(other.job_id);
          if (oid) targets.add(oid);
        }
      }
      continue;
    }
    if (!missionPool.length) continue;
    for (const cid of collectMissionClusterJobIds(id, missionPool)) {
      const nid = normalizeJobId(cid);
      if (nid) targets.add(nid);
    }
  }

  let total = 0;
  const alreadyGone = new Set<string>();
  for (const id of targets) {
    if (!id || alreadyGone.has(id)) continue;
    try {
      const result = await deleteMissionJob(id);
      total += deletedCountFrom(result);
      alreadyGone.add(id);
      if (result.deleted) alreadyGone.add(normalizeJobId(result.deleted));
      for (const did of result.deleted_ids || []) {
        const nid = normalizeJobId(did);
        if (nid) alreadyGone.add(nid);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/introuvable/i.test(msg)) {
        alreadyGone.add(id);
        continue;
      }
      throw err;
    }
  }

  if (total <= 0) {
    throw new Error(
      "Aucune occurrence supprimée. Redémarrez le backend (start-dev-cursor.ps1) si le problème persiste.",
    );
  }
  return total;
}

export function confirmDeleteMission(jobId: string, mission?: string | null): boolean {
  if (typeof window === "undefined") return false;
  const label = missionActionLabel(jobId, mission);
  return window.confirm(
    `Supprimer définitivement « ${label} » ?\n\nToutes les relances et continuations associées seront effacées (Missions, Décisions, Briefing, livrables).`,
  );
}

/** Après suppression : la liste dédupliquée ne doit plus contenir ce cluster. */
export function clusterStillVisible(allJobs: Job[], primaryJobId: string): boolean {
  const primary = normalizeJobId(primaryJobId);
  const seed = allJobs.find((j) => normalizeJobId(j.job_id) === primary);
  if (!seed) return false;
  const missionJobs = missionLikeJobs(allJobs);
  const key = missionClusterKey(seed, missionJobs);
  return jobsInCluster(allJobs, key).length > 0;
}
