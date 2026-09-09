import type { QueryClient } from "@tanstack/react-query";
import { agentHeaders, requestJson } from "./api";
import { missionActionLabel } from "./missionLabel";
import {
  collectMissionClusterJobIds,
  dedupeMissionListJobs,
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
  void qc.invalidateQueries({ queryKey: ["admin-inbox"] });
  void qc.invalidateQueries({ queryKey: ["admin-briefing"] });
  void qc.invalidateQueries({ queryKey: QK.tokens });
  void qc.invalidateQueries({ queryKey: QK.deliverablesLibrary });
}

function missionLikeJobs(jobs: Job[]): Job[] {
  return jobs.filter((j) => String(j.source || "mission") !== "chat");
}

function jobsInCluster(jobs: Job[], clusterKey: string): Job[] {
  const missionJobs = missionLikeJobs(jobs);
  return missionJobs.filter((j) => missionClusterKey(j, missionJobs) === clusterKey);
}

async function fetchJobsCards(): Promise<Job[]> {
  const { data } = await requestJson("/jobs/cards", {
    headers: agentHeaders(),
    retries: 1,
    timeoutMs: 30_000,
  });
  const list = (data as { jobs?: unknown })?.jobs;
  return Array.isArray(list) ? (list as Job[]) : [];
}

/** Jobs visibles du même cluster (UI). La suppression backend couvre toute la base. */
export function collectMissionDeleteJobIds(primaryJobId: string, allJobs: Job[]): string[] {
  return collectMissionClusterJobIds(primaryJobId, allJobs);
}

/**
 * Supprime jusqu'à disparition réelle du cluster (gère backend ancien = 1 job/coup
 * et faux positifs). Vérifie en rechargeant /jobs/cards entre chaque passe.
 */
export async function deleteMissionJobBundle(jobIds: string[], allJobs: Job[] = []): Promise<number> {
  const primary = normalizeJobId(jobIds[0]);
  if (!primary) throw new Error("Identifiant mission manquant.");

  const seed =
    allJobs.find((j) => normalizeJobId(j.job_id) === primary) ||
    ({ job_id: primary, agent: "coordinateur", mission: "" } as Job);
  const missionJobs = missionLikeJobs(allJobs);
  const clusterKey = missionClusterKey(seed, missionJobs.length ? missionJobs : [seed]);

  let total = 0;
  let jobs = allJobs;

  for (let attempt = 0; attempt < 25; attempt++) {
    const batch = jobsInCluster(jobs, clusterKey);
    if (!batch.length) return total;

    const targetId = normalizeJobId(batch[0].job_id);
    const result = await deleteMissionJob(targetId);
    const n = deletedCountFrom(result);
    if (n <= 0) {
      throw new Error(
        "Aucune occurrence supprimée. Redémarrez le backend (start-dev-cursor.ps1) si le problème persiste.",
      );
    }
    total += n;

    jobs = await fetchJobsCards();
    const remaining = jobsInCluster(jobs, clusterKey);
    if (!remaining.length) return total;

    // Backend cluster (plusieurs ids d'un coup) mais reliquat visible → une passe de plus
    if (n > 1 && attempt >= 2) {
      throw new Error(
        `Il reste ${remaining.length} occurrence(s) visible(s) après suppression. Réessayez ou redémarrez le backend.`,
      );
    }
  }

  const left = jobsInCluster(await fetchJobsCards(), clusterKey);
  if (left.length) {
    throw new Error(
      `Impossible de tout effacer (${left.length} occurrence(s) restante(s)). Redémarrez start-dev-cursor.ps1 puis réessayez.`,
    );
  }
  return total;
}

export function confirmDeleteMission(jobId: string, mission?: string | null): boolean {
  if (typeof window === "undefined") return false;
  const label = missionActionLabel(jobId, mission);
  return window.confirm(
    `Supprimer définitivement « ${label} » ?\n\nToutes les relances et continuations associées seront effacées (Missions, Inbox, Briefing, livrables).`,
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

export function dedupeMissionsForList(jobs: Job[]): Job[] {
  return dedupeMissionListJobs(missionLikeJobs(jobs));
}
