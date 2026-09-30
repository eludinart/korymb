/** Surfaces de travail Mode Cerveau — adaptation légère selon le contexte. */

export type WorkSurfaceId = "flow" | "kanban" | "map" | "scenarios";

export type WorkSurfaceOption = {
  id: WorkSurfaceId;
  label: string;
  href: string;
  hint: string;
};

export const WORK_SURFACES: WorkSurfaceOption[] = [
  {
    id: "flow",
    label: "Flux",
    href: "/briefing",
    hint: "Anticiper, décider, demander",
  },
  {
    id: "kanban",
    label: "Kanban",
    href: "/missions?view=kanban",
    hint: "Travaux par colonne de statut",
  },
  {
    id: "map",
    label: "Carte",
    href: "/carte",
    hint: "Vue spatiale équipes / missions",
  },
  {
    id: "scenarios",
    label: "Scénarios",
    href: "/briefing#scenarios",
    hint: "Et si… à 1 / 5 / 10 ans",
  },
];

export type SurfaceContext = {
  runningCount?: number;
  inboxCritical?: number;
  thinkingMode?: string;
};

/** Recommande une surface selon charge + mode de pensée. */
export function recommendWorkSurface(ctx: SurfaceContext): WorkSurfaceId {
  const mode = String(ctx.thinkingMode || "auto").toLowerCase();
  const running = Number(ctx.runningCount || 0);
  const critical = Number(ctx.inboxCritical || 0);

  if (critical > 0) return "flow";
  if (running >= 3) return "kanban";
  if (mode === "artiste" || mode === "philosophe") return "map";
  if (mode === "scientifique") return "scenarios";
  return "flow";
}

export function workSurfaceLabel(id: WorkSurfaceId): string {
  return WORK_SURFACES.find((s) => s.id === id)?.label || id;
}
