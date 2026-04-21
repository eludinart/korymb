/**
 * Schéma aligné sur backend/observability.py::make_event
 */
import type { MissionJobEvent } from "@/lib/types";
export type { MissionJobEvent } from "@/lib/types";

const TYPE_LABELS_FR: Record<string, string> = {
  mission_start: "Démarrage mission",
  orchestration_start: "Orchestration CIO",
  plan_parsed: "Plan analysé",
  delegation: "Délégation équipe",
  handoff: "Passage de relais",
  instruction_delivered: "Consigne transmise",
  sub_agent_working: "Agent au travail",
  agent_turn_start: "Tour LLM",
  tool_call: "Appel outil",
  agent_turn_done: "Tour terminé",
  synthesis_start: "Synthèse CIO",
  synthesis_done: "Synthèse terminée",
  mission_done: "Mission terminée",
  mission_cancelled: "Mission interrompue",
  refinement_round: "Boucle d'exécution (affinage)",
  error: "Erreur",
  team_dialogue: "Échange équipe",
  delivery_review: "Revue livraison",
};

export function eventTypeLabelFr(type: string | undefined): string {
  if (!type) return "Événement";
  return TYPE_LABELS_FR[type] || type;
}

export function formatEventTs(ts: string | undefined): string {
  if (!ts) return "—";
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return ts;
    return d.toLocaleString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return ts;
  }
}

function str(v: unknown, max = 220): string {
  if (v == null) return "";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Résumé lisible « qui / quoi » pour la timeline UI. */
export function summarizeMissionEvent(ev: MissionJobEvent): string {
  const p = ev.payload || {};
  const typ = String(ev.type || "");

  if (typ === "delegation") {
    const solo = Boolean(p.solo_cio);
    const to = Array.isArray(p.to) ? (p.to as string[]).join(", ") : "";
    return solo ? "CIO seul (aucun sous-agent délégué)." : `Sous-agents : ${to || "—"}.`;
  }
  if (typ === "handoff") {
    return str(p.summary_fr, 280) || `De ${String(p.from || "?")} → ${String(p.to || "?")}`;
  }
  if (typ === "team_dialogue") {
    return str(p.line_fr, 400) || str(p.phase, 80);
  }
  if (typ === "instruction_delivered") {
    return str(p.summary_fr, 280) || str(p.instruction_excerpt, 200);
  }
  if (typ === "sub_agent_working") {
    return str(p.summary_fr, 280) || String(p.phase || "travail");
  }
  if (typ === "agent_turn_start") {
    return str(p.task_preview, 240);
  }
  if (typ === "tool_call") {
    const name = String(p.tool || p.tool_name || p.name || "outil");
    const inp = p.input != null ? str(p.input, 140) : "";
    const out = p.output_preview != null ? str(p.output_preview, 120) : "";
    const ok = p.ok === false ? " (échec)" : "";
    const bits = [inp && `entrée: ${inp}`, out && `sortie: ${out}`].filter(Boolean);
    return bits.length ? `${name}${ok} — ${bits.join(" · ")}` : `${name}${ok}`;
  }
  if (typ === "plan_parsed") {
    const plan = p.plan as Record<string, unknown> | undefined;
    const agents = plan?.agents;
    if (Array.isArray(agents)) return `Agents plan : ${agents.join(", ")}`;
    return "Plan enregistré.";
  }
  if (typ === "refinement_round") {
    const round = p.round != null ? `Tour ${p.round}` : "Boucle d'exécution";
    const phase = p.phase ? ` · ${p.phase}` : "";
    const prev =
      str(p.critique_preview, 180) ||
      str(p.summary_fr, 180) ||
      str(p.output_preview, 180);
    return prev ? `${round}${phase} — ${prev}` : `${round}${phase}`;
  }
  if (typ === "synthesis_start" || typ === "synthesis_done") {
    return str(p.summary_fr, 200) || (typ === "synthesis_done" ? "Synthèse produite." : "Synthèse en cours…");
  }
  if (typ === "mission_done") {
    return str(p.summary_fr, 200) || "Livrable finalisé.";
  }
  if (typ === "mission_cancelled") {
    return "Arrêt demandé par l'utilisateur.";
  }
  if (typ === "error") {
    return str(p.message, 400);
  }
  if (typ === "orchestration_start" || typ === "mission_start") {
    return str(p.summary_fr, 200) || str(p.mission_preview, 200) || "Démarrage.";
  }
  const raw = JSON.stringify(p);
  return raw.length > 2 && raw !== "{}" ? str(p, 300) : "";
}

export function normalizeMissionEvents(raw: unknown): MissionJobEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x) => x && typeof x === "object") as MissionJobEvent[];
}
