"use client";

import { useState } from "react";
import AgentMessageMarkdown from "./AgentMessageMarkdown";
import { normalizeTeamRows } from "../lib/jobTeam";
import { extractCioStrategicQuestions } from "../lib/missionBilan";

type Props = {
  job: {
    result?: string | null;
    status?: string;
    team?: unknown;
    tokens_total?: number;
    cost_usd?: number;
    events_total?: number;
    delivery_warnings?: string[];
    delivery_blocked?: boolean;
    created_at?: string;
  };
  updatedByContinuation?: boolean;
};

const AGENT_COLORS: Record<string, { dot: string; text: string }> = {
  commercial:        { dot: "bg-blue-400",    text: "text-blue-700"    },
  community_manager: { dot: "bg-pink-400",    text: "text-pink-700"    },
  developpeur:       { dot: "bg-emerald-400", text: "text-emerald-700" },
  comptable:         { dot: "bg-amber-400",   text: "text-amber-700"   },
  coordinateur:      { dot: "bg-violet-400",  text: "text-violet-700"  },
};

function agentDot(key?: string) {
  return AGENT_COLORS[key || ""]?.dot ?? "bg-slate-300";
}
function agentText(key?: string) {
  return AGENT_COLORS[key || ""]?.text ?? "text-slate-600";
}

export default function MissionDecisionCard({ job }: Props) {
  const [livrableOpen, setLivrableOpen] = useState(false);

  const result = (job.result || "").trim();
  const cioStrategicQuestions = extractCioStrategicQuestions(result);
  const team = normalizeTeamRows(job.team);
  const subAgents = team.filter((r) => r.key && r.key !== "coordinateur");
  const warnings = job.delivery_warnings ?? [];
  const tokens = Number(job.tokens_total ?? 0);
  const cost = Number(job.cost_usd ?? 0);
  const events = Number(job.events_total ?? 0);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden text-[11px]">

      {/* ── Questions stratégiques CIO ── */}
      {cioStrategicQuestions && (
        <section className="border-t border-violet-100 bg-gradient-to-br from-violet-50/70 to-indigo-50/50 px-4 py-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-600 text-[9px] font-bold text-white">
              CIO
            </span>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-700">
              Le CIO vous ouvre sur la suite
            </p>
          </div>
          <AgentMessageMarkdown
            source={cioStrategicQuestions}
            className="text-[11px] leading-snug [&_ol]:my-1 [&_ol]:space-y-2 [&_li]:text-[11px] [&_li]:leading-relaxed [&_li]:text-violet-900 [&_p]:mb-1 [&_p]:text-[11px] [&_p]:text-violet-900 [&_strong]:text-violet-800"
          />
          <p className="mt-2 text-[9px] text-violet-400">
            Utilisez « Poursuivre avec le CIO » ci-dessous pour répondre à l&apos;une de ces questions.
          </p>
        </section>
      )}

      {/* ── Agents + métriques ── */}
      <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-4 py-2">
        {/* Agents */}
        <div className="flex flex-wrap gap-1">
          {team.length === 0 && (
            <span className="text-[10px] text-slate-400">—</span>
          )}
          {team.map((row, i) => (
            <span
              key={`${row.key}-${i}`}
              className={`flex items-center gap-1 ${agentText(row.key)}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${agentDot(row.key)}`} />
              <span className="text-[10px] font-medium">{row.label || row.key}</span>
            </span>
          ))}
          {subAgents.length === 0 && team.length > 0 && (
            <span className="text-[10px] text-slate-400">CIO seul</span>
          )}
        </div>
        {/* Métriques compactes */}
        <div className="flex shrink-0 gap-3 text-right text-[10px] tabular-nums text-slate-400">
          {tokens > 0 && <span>{tokens.toLocaleString("fr-FR")} tok</span>}
          {cost > 0 && <span>${cost.toFixed(3)}</span>}
          {events > 0 && <span>{events} év.</span>}
        </div>
      </div>

      {/* ── Alertes ── */}
      {warnings.length > 0 && (
        <div className="border-t border-amber-100 bg-amber-50/60 px-4 py-2">
          {warnings.map((w, i) => (
            <p key={i} className="text-[10px] text-amber-800">⚠ {w}</p>
          ))}
        </div>
      )}

      {/* ── Livrable complet (repliable) ── */}
      {result && (
        <div className="border-t border-slate-100">
          <button
            type="button"
            onClick={() => setLivrableOpen((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-2 text-left hover:bg-slate-50/80"
          >
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              Livrable CIO complet
            </span>
            <span className={`text-[10px] text-slate-300 transition-transform ${livrableOpen ? "rotate-180" : ""}`}>
              ▼
            </span>
          </button>
          {livrableOpen && (
            <div className="max-h-72 overflow-y-auto border-t border-slate-100 px-4 pb-3 pt-2">
              <AgentMessageMarkdown
                source={result}
                className="leading-relaxed [&_h1]:text-xs [&_h1]:font-bold [&_h1]:mb-1 [&_h2]:text-[11px] [&_h2]:font-semibold [&_h2]:mb-0.5 [&_h3]:text-[10px] [&_h3]:font-semibold [&_li]:text-[11px] [&_li]:my-0.5 [&_p]:mb-1 [&_p]:text-[11px] [&_ul]:my-1 [&_ol]:my-1"
              />
            </div>
          )}
        </div>
      )}

    </div>
  );
}
