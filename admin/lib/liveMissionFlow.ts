import { normalizeMissionEvents } from "./missionEvents";
import type { LiveFlowStep as _LiveFlowStepBase } from "@/lib/types";

export type LiveFlowStep = {
  id: string;
  agentKey: string;
  label: string;
  detail: string;
  kind: "cio" | "agent" | "system";
};

function lab(key: string, map?: Record<string, string>): string {
  const m = map?.[key];
  return m && m.trim() ? m.trim() : key;
}

/**
 * Réduit la liste d’événements mission en une suite de pastilles lisibles de gauche à droite
 * (CIO → sous-agents → CIO synthèse…).
 */
export function buildLiveMissionFlow(events: unknown, agentLabelMap?: Record<string, string>): LiveFlowStep[] {
  const list = normalizeMissionEvents(events);
  const sorted = [...list].sort((a, b) => String(a.ts || "").localeCompare(String(b.ts || "")));
  const raw: LiveFlowStep[] = [];

  for (const ev of sorted) {
    const t = String(ev.type || "");
    const agent = String(ev.agent || "").trim();
    const p = (ev.payload || {}) as Record<string, unknown>;
    const ts = String(ev.ts || "");

    if (t === "mission_start") {
      raw.push({
        id: `${ts}-ms`,
        agentKey: "coordinateur",
        label: "CIO",
        detail: "Démarrage mission",
        kind: "cio",
      });
    }
    if (t === "orchestration_start") {
      raw.push({
        id: `${ts}-orch`,
        agentKey: "coordinateur",
        label: "CIO",
        detail: "Orchestration multi-agents",
        kind: "cio",
      });
    }
    if (t === "plan_parsed") {
      raw.push({
        id: `${ts}-plan`,
        agentKey: "coordinateur",
        label: "CIO",
        detail: "Plan analysé",
        kind: "cio",
      });
    }
    if (t === "delegation") {
      const solo = Boolean(p.solo_cio);
      const to = Array.isArray(p.to) ? (p.to as string[]).filter(Boolean) : [];
      raw.push({
        id: `${ts}-del`,
        agentKey: "coordinateur",
        label: "CIO",
        detail: solo ? "Réponse sans sous-agents" : `Délégation : ${to.map((k) => lab(k, agentLabelMap)).join(", ") || "—"}`,
        kind: "cio",
      });
    }
    if (t === "handoff") {
      const to = String(p.to || "").trim();
      if (to && to !== "coordinateur") {
        raw.push({
          id: `${ts}-ho`,
          agentKey: to,
          label: lab(to, agentLabelMap),
          detail: "Relais reçu",
          kind: "agent",
        });
      }
    }
    if (t === "instruction_delivered" && agent && agent !== "coordinateur") {
      raw.push({
        id: `${ts}-ins`,
        agentKey: agent,
        label: lab(agent, agentLabelMap),
        detail: "Consigne CIO → exécution",
        kind: "agent",
      });
    }
    if (t === "agent_turn_done" && agent && agent !== "coordinateur") {
      raw.push({
        id: `${ts}-atd`,
        agentKey: agent,
        label: lab(agent, agentLabelMap),
        detail: "Tour terminé",
        kind: "agent",
      });
    }
    if (t === "synthesis_start") {
      raw.push({
        id: `${ts}-syn0`,
        agentKey: "coordinateur",
        label: "CIO",
        detail: "Synthèse finale",
        kind: "cio",
      });
    }
    if (t === "synthesis_done") {
      raw.push({
        id: `${ts}-syn1`,
        agentKey: "coordinateur",
        label: "CIO",
        detail: "Synthèse prête",
        kind: "cio",
      });
    }
    if (t === "refinement_round") {
      const phase = String(p.phase || "").trim();
      const r = p.round != null ? `Tour ${p.round}` : "Affinage";
      raw.push({
        id: `${ts}-ref`,
        agentKey: "coordinateur",
        label: "CIO",
        detail: phase ? `${r} · ${phase}` : r,
        kind: "cio",
      });
    }
    if (t === "mission_done") {
      raw.push({ id: `${ts}-md`, agentKey: "system", label: "Fin", detail: "Mission terminée", kind: "system" });
    }
    if (t === "mission_cancelled") {
      raw.push({ id: `${ts}-mc`, agentKey: "system", label: "Stop", detail: "Interrompue", kind: "system" });
    }
    if (t === "error") {
      raw.push({
        id: `${ts}-err`,
        agentKey: "system",
        label: "Erreur",
        detail: String(p.message || "").slice(0, 72),
        kind: "system",
      });
    }
  }

  const out: LiveFlowStep[] = [];
  for (const s of raw) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.agentKey === s.agentKey &&
      prev.label === s.label &&
      prev.detail === s.detail &&
      prev.kind === s.kind
    ) {
      continue;
    }
    out.push(s);
  }
  return out;
}
