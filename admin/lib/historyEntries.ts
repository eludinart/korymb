import { stripMarkdownLight } from "./normalizeLooseMarkdown";
import {
  collectMissionClusterJobIds,
  dedupeMissionListJobs,
  missionClusterKey,
} from "./missionBossView";

import type { Job } from "./types";

export type HistoryItemType = "chat" | "mission_guidee" | "mission";

export type HistoryEntry = {
  id: string;
  type: HistoryItemType;
  title: string;
  quickInfo: string;
  displayJobId: string;
  jobIds: string[];
};

export function detectHistoryItemType(job: Job): HistoryItemType {
  const source = String((job as Job & { source?: string }).source || "").toLowerCase();
  if (source.startsWith("chat")) return "chat";
  if (source === "mission_session") return "mission_guidee";
  return "mission";
}

export function historyTypeLabel(kind: HistoryItemType): string {
  if (kind === "chat") return "Chat";
  if (kind === "mission_guidee") return "Mission guidée";
  return "Mission";
}

function firstUserMessageFromThread(thread: unknown): string {
  if (!Array.isArray(thread)) return "";
  for (const item of thread) {
    if (!item || typeof item !== "object") continue;
    const row = item as { role?: unknown; content?: unknown };
    if (String(row.role || "") !== "user") continue;
    const content = String(row.content || "").trim();
    if (content) return content;
  }
  return "";
}

function compact(text: string, max = 110): string {
  const clean = stripMarkdownLight(text || "");
  if (!clean) return "";
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** Regroupe jobs en entrées d'archives (missions, guidées, conversations chat). */
export function buildHistoryEntries(jobs: Job[]): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  const chatGroups = new Map<string, Job[]>();
  const missionLike = jobs.filter((j) => detectHistoryItemType(j) !== "chat");
  const missionReps = dedupeMissionListJobs(missionLike);

  for (const j of missionReps) {
    const type = detectHistoryItemType(j);
    const clusterIds = collectMissionClusterJobIds(j.job_id, missionLike);
    const title = compact(j.mission || "", 85) || "(sans titre)";
    const quickInfo =
      type === "mission_guidee"
        ? compact(`Issue d'une session de cadrage · ${j.status || "—"}`, 85)
        : compact(`Agent ${j.agent || "coordinateur"} · ${j.status || "—"}`, 75);
    const source = String((j as Job & { source?: string }).source || "");
    const testHint =
      source === "test" || /^pytest\d*$/i.test(j.job_id) || j.job_id.startsWith("cioans") ? " · test auto" : "";
    const relaunchHint = clusterIds.length > 1 ? ` · ${clusterIds.length} relances` : "";
    out.push({
      id: `cluster:${missionClusterKey(j, missionLike)}`,
      type,
      title,
      quickInfo: quickInfo + testHint + relaunchHint,
      displayJobId: j.job_id,
      jobIds: clusterIds,
    });
  }

  for (const j of jobs) {
    if (detectHistoryItemType(j) !== "chat") continue;
    const chatSessionId = String(j.chat_session_id || "").trim() || j.job_id;
    const key = `chat:${chatSessionId}`;
    const list = chatGroups.get(key) || [];
    list.push(j);
    chatGroups.set(key, list);
  }

  for (const [groupKey, grouped] of chatGroups.entries()) {
    const latest = grouped[0];
    const title =
      compact(firstUserMessageFromThread((latest as Job & { mission_thread?: unknown[] }).mission_thread), 85) ||
      compact(latest.mission || "", 85) ||
      "Conversation";
    out.push({
      id: groupKey,
      type: "chat",
      title,
      quickInfo: compact(
        `${grouped.length} échange(s) · Agent ${latest.agent || "coordinateur"} · ${latest.status || "—"}`,
        95,
      ),
      displayJobId: latest.job_id,
      jobIds: grouped.map((g) => g.job_id),
    });
  }

  return out.sort((a, b) => {
    const ja = jobs.find((j) => j.job_id === a.displayJobId);
    const jb = jobs.find((j) => j.job_id === b.displayJobId);
    return String(jb?.created_at || "").localeCompare(String(ja?.created_at || ""));
  });
}

/** Entrées d'historique missions + guidées (hors conversations chat). */
export function buildMissionHistoryEntries(jobs: Job[]): HistoryEntry[] {
  return buildHistoryEntries(jobs).filter((e) => e.type !== "chat");
}
