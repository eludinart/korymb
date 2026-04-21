/** Ligne équipe renvoyée par GET /jobs/{id} (coordinateur + sous-agents). */
import type { TeamRow } from "@/lib/types";
export type { TeamRow } from "@/lib/types";

export function normalizeTeamRows(team: unknown): TeamRow[] {
  if (!Array.isArray(team)) return [];
  return team.map((item) => {
    if (typeof item === "string") {
      return { key: item, label: item, status: "", detail: "" };
    }
    if (item && typeof item === "object") {
      return item as TeamRow;
    }
    return {};
  });
}

export function teamRowKey(row: TeamRow, index: number): string {
  const base = row.key || row.label || "row";
  return `${String(base)}-${index}`;
}
