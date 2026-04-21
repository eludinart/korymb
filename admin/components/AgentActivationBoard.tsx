"use client";

import { useMemo } from "react";
import { normalizeMissionEvents } from "../lib/missionEvents";
import type { MissionJobEvent } from "../lib/types";

// ── Config agents ──────────────────────────────────────────────────────────────

const AGENT_DEFS = [
  { key: "coordinateur",      label: "CIO",              icon: "◆", color: "violet" },
  { key: "commercial",        label: "Commercial",        icon: "◈", color: "blue"   },
  { key: "community_manager", label: "CM",                icon: "◉", color: "pink"   },
  { key: "developpeur",       label: "Développeur",       icon: "◎", color: "emerald"},
  { key: "comptable",         label: "Comptable",         icon: "◇", color: "amber"  },
] as const;

type AgentKey = typeof AGENT_DEFS[number]["key"];
type AgentColor = typeof AGENT_DEFS[number]["color"];

type AgentState = "off" | "queued" | "briefing" | "working" | "tool" | "synthesizing" | "done" | "error";

type AgentStatus = {
  state: AgentState;
  detail: string;
  toolName?: string;
};

// ── Styles par couleur & état ──────────────────────────────────────────────────

const COLOR_MAP: Record<AgentColor, {
  idle: string; active: string; done: string; queued: string; ring: string; dot: string;
}> = {
  violet:  { idle: "border-violet-100 bg-violet-50/40 text-violet-300",  active: "border-violet-400 bg-violet-50 text-violet-900",  done: "border-violet-300 bg-violet-100 text-violet-800",  queued: "border-violet-200 bg-violet-50/60 text-violet-500",  ring: "ring-violet-400",  dot: "bg-violet-500"  },
  blue:    { idle: "border-blue-100 bg-blue-50/40 text-blue-300",         active: "border-blue-400 bg-blue-50 text-blue-900",         done: "border-blue-300 bg-blue-100 text-blue-800",         queued: "border-blue-200 bg-blue-50/60 text-blue-500",         ring: "ring-blue-400",    dot: "bg-blue-500"    },
  pink:    { idle: "border-pink-100 bg-pink-50/40 text-pink-300",         active: "border-pink-400 bg-pink-50 text-pink-900",         done: "border-pink-300 bg-pink-100 text-pink-800",         queued: "border-pink-200 bg-pink-50/60 text-pink-500",         ring: "ring-pink-400",    dot: "bg-pink-500"    },
  emerald: { idle: "border-emerald-100 bg-emerald-50/40 text-emerald-300",active: "border-emerald-400 bg-emerald-50 text-emerald-900",done: "border-emerald-300 bg-emerald-100 text-emerald-800",queued: "border-emerald-200 bg-emerald-50/60 text-emerald-500", ring: "ring-emerald-400", dot: "bg-emerald-500" },
  amber:   { idle: "border-amber-100 bg-amber-50/40 text-amber-300",      active: "border-amber-400 bg-amber-50 text-amber-900",      done: "border-amber-300 bg-amber-100 text-amber-800",      queued: "border-amber-200 bg-amber-50/60 text-amber-500",      ring: "ring-amber-400",   dot: "bg-amber-500"   },
};

function blockClasses(color: AgentColor, state: AgentState, isRunning: boolean): string {
  const c = COLOR_MAP[color];
  const base = "relative flex flex-col gap-0.5 rounded-xl border p-2.5 transition-all duration-300 min-w-0";
  if (state === "off")          return `${base} ${c.idle} opacity-40`;
  if (state === "queued")       return `${base} ${c.queued}`;
  if (state === "done")         return `${base} ${c.done}`;
  if (state === "error")        return `${base} border-red-300 bg-red-50 text-red-800`;
  // working / briefing / tool / synthesizing → active
  const ring = isRunning ? `ring-2 ring-offset-1 ${c.ring} animate-pulse` : "";
  return `${base} ${c.active} shadow-sm ${ring}`;
}

// ── State label ────────────────────────────────────────────────────────────────

function stateLabel(s: AgentState): string {
  switch (s) {
    case "off":          return "En veille";
    case "queued":       return "En attente";
    case "briefing":     return "Briefing…";
    case "working":      return "Au travail";
    case "tool":         return "Outil actif";
    case "synthesizing": return "Synthèse…";
    case "done":         return "Terminé ✓";
    case "error":        return "Erreur";
  }
}

function stateIndicator(s: AgentState): string {
  switch (s) {
    case "off":          return "○";
    case "queued":       return "◌";
    case "briefing":     return "◐";
    case "working":      return "●";
    case "tool":         return "⚡";
    case "synthesizing": return "◑";
    case "done":         return "✓";
    case "error":        return "✕";
  }
}

// ── Communication log ──────────────────────────────────────────────────────────

type CommLine = { from: string; to?: string; text: string; type: string; ts: string };

function str80(v: unknown): string {
  if (!v) return "";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 80 ? `${s.slice(0, 80)}…` : s;
}

function agentShortLabel(key: string): string {
  const found = AGENT_DEFS.find((a) => a.key === key);
  return found?.label ?? key;
}

// ── Events → states ────────────────────────────────────────────────────────────

function deriveAgentStates(events: MissionJobEvent[], jobStatus: string): Record<AgentKey, AgentStatus> {
  const states: Record<string, AgentStatus> = Object.fromEntries(
    AGENT_DEFS.map((a) => [a.key, { state: "off" as AgentState, detail: "" }])
  );

  // CIO is always at minimum "queued" when a mission exists
  states["coordinateur"] = { state: "queued", detail: "Mission reçue" };

  const sorted = [...events].sort((a, b) => String(a.ts || "").localeCompare(String(b.ts || "")));

  for (const ev of sorted) {
    const t = String(ev.type || "");
    const agent = (String(ev.agent || "").trim() || "coordinateur") as AgentKey;
    const p = (ev.payload || {}) as Record<string, unknown>;

    if (t === "mission_start" || t === "orchestration_start") {
      states["coordinateur"] = { state: "working", detail: "Orchestration" };
    }
    if (t === "plan_parsed") {
      states["coordinateur"] = { state: "working", detail: "Plan analysé" };
    }
    if (t === "delegation") {
      const to = Array.isArray(p.to) ? (p.to as string[]) : [];
      states["coordinateur"] = { state: "working", detail: `Délégation → ${to.map(agentShortLabel).join(", ") || "—"}` };
      for (const k of to) {
        if (k in states) states[k] = { state: "queued", detail: "En attente consigne" };
      }
    }
    if (t === "instruction_delivered") {
      if (agent in states) states[agent] = { state: "briefing", detail: str80(p.summary_fr) || "Consigne reçue" };
    }
    if (t === "sub_agent_working") {
      if (agent in states) states[agent] = { state: "working", detail: str80(p.summary_fr) || str80(p.phase) || "Travail" };
    }
    if (t === "agent_turn_start") {
      if (agent in states) states[agent] = { state: "working", detail: str80(p.task_preview) || "Tour LLM" };
    }
    if (t === "tool_call") {
      const toolName = String(p.tool || p.tool_name || p.name || "outil");
      if (agent in states) states[agent] = { state: "tool", detail: toolName, toolName };
    }
    if (t === "agent_turn_done") {
      if (agent in states && states[agent].state !== "off") {
        states[agent] = { state: "done", detail: "Contribution terminée" };
      }
    }
    if (t === "handoff") {
      const to = String(p.to || "").trim();
      if (to && to in states) states[to] = { state: "briefing", detail: "Relais reçu" };
    }
    if (t === "synthesis_start") {
      states["coordinateur"] = { state: "synthesizing", detail: "Synthèse en cours…" };
    }
    if (t === "synthesis_done") {
      states["coordinateur"] = { state: "synthesizing", detail: "Synthèse produite" };
    }
    if (t === "mission_done") {
      states["coordinateur"] = { state: "done", detail: "Mission terminée" };
      for (const k of Object.keys(states)) {
        if (states[k].state !== "off") states[k] = { ...states[k], state: "done" };
      }
    }
    if (t === "mission_cancelled") {
      for (const k of Object.keys(states)) {
        if (states[k].state !== "off") states[k] = { ...states[k], state: "error", detail: "Interrompue" };
      }
    }
    if (t === "error" && agent in states) {
      states[agent] = { state: "error", detail: str80(p.message) || "Erreur" };
    }
    if (t === "refinement_round") {
      states["coordinateur"] = { state: "working", detail: `Affinage tour ${String(p.round ?? "")}` };
    }
  }

  if (jobStatus === "completed") {
    for (const k of Object.keys(states)) {
      if (states[k].state !== "off" && states[k].state !== "error") {
        states[k] = { ...states[k], state: "done" };
      }
    }
    states["coordinateur"] = { state: "done", detail: "Mission terminée" };
  }

  return states as Record<AgentKey, AgentStatus>;
}

function deriveCommsLog(events: MissionJobEvent[]): CommLine[] {
  const COMM_TYPES = new Set(["team_dialogue", "handoff", "instruction_delivered", "delegation"]);
  const sorted = [...events]
    .sort((a, b) => String(a.ts || "").localeCompare(String(b.ts || "")))
    .filter((ev) => COMM_TYPES.has(String(ev.type || "")));

  const lines: CommLine[] = [];
  for (const ev of sorted) {
    const t = String(ev.type || "");
    const p = (ev.payload || {}) as Record<string, unknown>;
    const agent = String(ev.agent || "coordinateur");

    if (t === "team_dialogue") {
      const txt = str80(p.line_fr) || str80(p.phase) || "";
      if (txt) lines.push({ from: agent, text: txt, type: t, ts: String(ev.ts || "") });
    }
    if (t === "handoff") {
      const txt = str80(p.summary_fr) || `→ ${String(p.to || "?")}`;
      lines.push({ from: String(p.from || agent), to: String(p.to || ""), text: txt, type: t, ts: String(ev.ts || "") });
    }
    if (t === "instruction_delivered") {
      const txt = str80(p.summary_fr) || str80(p.instruction_excerpt) || "Consigne transmise";
      lines.push({ from: "coordinateur", to: agent, text: txt, type: t, ts: String(ev.ts || "") });
    }
    if (t === "delegation") {
      const to = Array.isArray(p.to) ? (p.to as string[]).map(agentShortLabel).join(", ") : "—";
      if (to && to !== "—") {
        lines.push({ from: "coordinateur", text: `Délègue à : ${to}`, type: t, ts: String(ev.ts || "") });
      }
    }
  }
  return lines.slice(-5);
}

// ── Props ──────────────────────────────────────────────────────────────────────

type Props = {
  events: unknown;
  jobStatus?: string;
  className?: string;
};

// ── Component ──────────────────────────────────────────────────────────────────

export default function AgentActivationBoard({ events, jobStatus = "", className = "" }: Props) {
  const evList = useMemo(() => normalizeMissionEvents(events), [events]);
  const isRunning = jobStatus === "running";

  const agentStates = useMemo(() => deriveAgentStates(evList, jobStatus), [evList, jobStatus]);
  const comms = useMemo(() => deriveCommsLog(evList), [evList]);

  const activeCount = AGENT_DEFS.filter((a) => {
    const s = agentStates[a.key]?.state;
    return s && s !== "off";
  }).length;

  return (
    <div className={`rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Équipe agentique
          </span>
          {activeCount > 0 && (
            <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
              isRunning ? "bg-violet-100 text-violet-700 animate-pulse" : "bg-slate-100 text-slate-600"
            }`}>
              {isRunning ? "● EN COURS" : `${activeCount} mobilisé${activeCount > 1 ? "s" : ""}`}
            </span>
          )}
        </div>
        {isRunning && (
          <span className="flex h-2 w-2 rounded-full bg-violet-500 shadow-[0_0_6px_2px_rgba(124,58,237,0.4)] animate-pulse" />
        )}
      </div>

      {/* Agent grid */}
      <div className="grid grid-cols-5 gap-1.5 p-2.5">
        {AGENT_DEFS.map((ag) => {
          const status = agentStates[ag.key] ?? { state: "off" as AgentState, detail: "" };
          const cls = blockClasses(ag.color, status.state, isRunning);
          return (
            <div key={ag.key} className={cls} title={`${ag.label} — ${stateLabel(status.state)}: ${status.detail}`}>
              {/* Icon + indicator */}
              <div className="flex items-center justify-between gap-1">
                <span className="text-[14px] leading-none">{ag.icon}</span>
                <span className="text-[11px] leading-none font-bold">{stateIndicator(status.state)}</span>
              </div>
              {/* Label */}
              <p className="text-[9px] font-bold uppercase tracking-wide truncate leading-tight mt-0.5">
                {ag.label}
              </p>
              {/* Status */}
              <p className="text-[8px] leading-tight truncate text-slate-500 font-medium">
                {stateLabel(status.state)}
              </p>
              {/* Detail */}
              {status.state !== "off" && status.detail && (
                <p className="text-[8px] leading-tight line-clamp-2 text-slate-600 mt-0.5">
                  {status.detail}
                </p>
              )}
              {/* Tool pill */}
              {status.state === "tool" && status.toolName && (
                <span className="mt-0.5 inline-block rounded bg-amber-100 px-1 text-[7px] font-bold text-amber-700 truncate">
                  ⚡ {status.toolName}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Communication log */}
      {comms.length > 0 && (
        <div className="border-t border-slate-100 px-3 py-2">
          <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-wide text-slate-400">
            Communication récente
          </p>
          <ol className="space-y-1">
            {comms.map((line, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[10px]">
                <span className="shrink-0 rounded bg-slate-100 px-1 py-0.5 font-semibold text-slate-600 text-[9px] leading-tight">
                  {agentShortLabel(line.from)}
                  {line.to ? ` → ${agentShortLabel(line.to)}` : ""}
                </span>
                <span className="text-slate-600 leading-snug line-clamp-1">{line.text}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {comms.length === 0 && evList.length === 0 && (
        <div className="px-3 pb-3 text-[10px] text-slate-400 italic">
          En attente des premiers événements d&apos;orchestration…
        </div>
      )}
    </div>
  );
}
