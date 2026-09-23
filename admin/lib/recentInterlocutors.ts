import { ENTERPRISE_GROUP_ID, ENTERPRISE_ROLE_LABEL } from "./agentGroupUi";

/** "assistant" | "coordinateur" | `group:${id}` */
export type RecentInterlocutor = {
  value: string;
  label: string;
  usedAt: number;
};

const STORAGE_KEY = "korymb-recent-interlocutors-v1";
const MAX_RECENTS = 6;

function normalizeValue(value: string): string | null {
  const raw = (value || "").trim();
  if (raw === "assistant" || raw === "coordinateur") return raw;
  if (raw.startsWith("group:")) {
    const id = raw.slice(6).trim();
    if (id && id.length <= 64 && /^[A-Za-z0-9_-]+$/.test(id)) {
      return id === ENTERPRISE_GROUP_ID ? "coordinateur" : `group:${id}`;
    }
  }
  return null;
}

export function fallbackInterlocutorLabel(value: string): string {
  if (value === "assistant") return "Assistant";
  if (value === "coordinateur") return ENTERPRISE_ROLE_LABEL;
  return "Équipe";
}

export function loadRecentInterlocutors(): RecentInterlocutor[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentInterlocutor[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => {
        const value = normalizeValue(String(row?.value || ""));
        if (!value) return null;
        const label = String(row?.label || "").trim().slice(0, 80) || fallbackInterlocutorLabel(value);
        const usedAt = Number(row?.usedAt) || 0;
        return { value, label, usedAt };
      })
      .filter((row): row is RecentInterlocutor => Boolean(row))
      .sort((a, b) => b.usedAt - a.usedAt)
      .slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

export function rememberInterlocutor(value: string, label?: string): RecentInterlocutor[] {
  const clean = normalizeValue(value);
  if (!clean || typeof window === "undefined") return loadRecentInterlocutors();
  const prev = loadRecentInterlocutors();
  const previous = prev.find((row) => row.value === clean);
  const nextLabel = (label || previous?.label || fallbackInterlocutorLabel(clean)).trim().slice(0, 80);
  const next: RecentInterlocutor[] = [
    { value: clean, label: nextLabel, usedAt: Date.now() },
    ...prev.filter((row) => row.value !== clean),
  ].slice(0, MAX_RECENTS);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function interlocutorFromGroupId(groupId: string): string {
  const id = (groupId || "").trim();
  if (!id || id === ENTERPRISE_GROUP_ID) return "coordinateur";
  return `group:${id}`;
}

/** Id de flotte associé à un interlocuteur. L'assistant n'a pas de flotte. */
export function fleetIdFromInterlocutor(value: string): string | null {
  const clean = normalizeValue(value);
  if (!clean || clean === "assistant") return null;
  if (clean === "coordinateur") return ENTERPRISE_GROUP_ID;
  return clean.slice(6);
}

export function recentFleetPicks(): Array<{ id: string; label: string; value: string }> {
  const seen = new Set<string>();
  const out: Array<{ id: string; label: string; value: string }> = [];
  for (const row of loadRecentInterlocutors()) {
    const id = fleetIdFromInterlocutor(row.value);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: row.label, value: row.value });
  }
  return out;
}
