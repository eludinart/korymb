/**
 * Progression réelle d'un job (équipe + jalons d'événements).
 * Jamais basée sur le temps écoulé ni une ETA inventée.
 */

export type JobProgressTeamRow = {
  key?: string;
  label?: string;
  status?: string;
  phase?: string;
  detail?: string;
};

export type JobProgressEvent = {
  type?: string;
  agent?: string;
};

export type JobProgressInput = {
  status?: string | null;
  team?: JobProgressTeamRow[] | null;
  events?: JobProgressEvent[] | null;
};

export type JobProgress = {
  /** 0–100, basé uniquement sur l'état pipeline / équipe. */
  percent: number;
  /** Libellé court pour l'UI. */
  label: string;
  /** Source du calcul (debug / accessibilité). */
  source: "status" | "team" | "events";
};

function rowWeight(status: string): number {
  const st = status.trim().toLowerCase();
  if (st === "done" || st === "completed" || st === "ok") return 1;
  if (st === "running" || st === "working" || st === "active") return 0.5;
  if (st === "error" || st === "failed") return 1; // étape terminée (en échec)
  return 0;
}

function teamProgress(team: JobProgressTeamRow[]): JobProgress | null {
  if (!team.length) return null;
  const sum = team.reduce((acc, row) => acc + rowWeight(String(row.status || "")), 0);
  const percent = Math.max(5, Math.min(98, Math.round((100 * sum) / team.length)));
  const running = team.find((r) => {
    const st = String(r.status || "").toLowerCase();
    return st === "running" || st === "working" || st === "active";
  });
  const label = running
    ? String(running.detail || running.label || running.phase || "Travail en cours").slice(0, 80)
    : `${team.filter((r) => rowWeight(String(r.status || "")) >= 1).length}/${team.length} étapes`;
  return { percent, label, source: "team" };
}

const EVENT_FLOORS: Array<{ match: RegExp; floor: number; label: string }> = [
  { match: /^(orchestration_start|mission_start)$/i, floor: 12, label: "Démarrage" },
  { match: /^(plan_parsed|plan_ready|cio_plan)/i, floor: 28, label: "Plan prêt" },
  { match: /^(delegation|instruction_delivered)/i, floor: 42, label: "Délégation" },
  { match: /^(sub_agent_working|agent_turn_start)/i, floor: 55, label: "Agents au travail" },
  { match: /^agent_turn_done/i, floor: 70, label: "Livrable agent" },
  { match: /^synthesis_start/i, floor: 88, label: "Synthèse" },
  { match: /^(synthesis_done|mission_done)/i, floor: 96, label: "Finalisation" },
];

function eventsProgress(events: JobProgressEvent[]): JobProgress | null {
  if (!events.length) return null;
  let floor = 8;
  let label = "En cours";
  let agentDone = 0;
  for (const ev of events) {
    const typ = String(ev.type || "");
    if (/^agent_turn_done/i.test(typ)) agentDone += 1;
    for (const rule of EVENT_FLOORS) {
      if (rule.match.test(typ) && rule.floor >= floor) {
        floor = rule.floor;
        label = rule.label;
      }
    }
  }
  if (agentDone > 0) {
    floor = Math.max(floor, Math.min(85, 60 + 10 * Math.min(agentDone, 3)));
    label = agentDone === 1 ? "1 livrable agent" : `${agentDone} livrables agents`;
  }
  return { percent: floor, label, source: "events" };
}

/** Calcule un % de progression réel (pas d'horloge / pas d'ETA). */
export function computeJobProgress(input: JobProgressInput): JobProgress {
  const status = String(input.status || "").trim().toLowerCase();
  if (status === "completed") {
    return { percent: 100, label: "Terminé", source: "status" };
  }
  if (status.startsWith("error") || status === "cancelled") {
    return { percent: 100, label: status.startsWith("error") ? "Échec" : "Annulé", source: "status" };
  }
  if (status === "awaiting_validation") {
    const fromTeam = teamProgress(Array.isArray(input.team) ? input.team : []);
    return {
      percent: Math.max(fromTeam?.percent ?? 75, 75),
      label: "Validation requise",
      source: fromTeam?.source || "status",
    };
  }
  if (status === "paused") {
    const fromTeam = teamProgress(Array.isArray(input.team) ? input.team : []);
    return {
      percent: fromTeam?.percent ?? 40,
      label: "En pause",
      source: fromTeam?.source || "status",
    };
  }
  if (status === "pending") {
    return { percent: 3, label: "En file", source: "status" };
  }

  const team = Array.isArray(input.team) ? input.team : [];
  const fromTeam = teamProgress(team);
  if (fromTeam) return fromTeam;

  const events = Array.isArray(input.events) ? input.events : [];
  const fromEvents = eventsProgress(events);
  if (fromEvents) return fromEvents;

  if (status === "running") {
    return { percent: 10, label: "Démarrage", source: "status" };
  }
  return { percent: 5, label: "En cours", source: "status" };
}
