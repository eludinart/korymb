/** Ligne équipe renvoyée par GET /jobs/{id} (coordinateur + sous-agents). */
export type TeamRow = {
  key?: string;
  label?: string;
  status?: string;
  phase?: string;
  detail?: string;
};

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
