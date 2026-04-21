"use client";

import AgentMessageMarkdown from "./AgentMessageMarkdown";
import { normalizeTeamRows } from "../lib/jobTeam";

type Props = {
  /** Données du job sélectionné (GET /jobs/{id}) */
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
};

const AGENT_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  commercial:        { bg: "bg-blue-50",   text: "text-blue-700",   dot: "bg-blue-500"   },
  community_manager: { bg: "bg-pink-50",   text: "text-pink-700",   dot: "bg-pink-500"   },
  developpeur:       { bg: "bg-emerald-50",text: "text-emerald-700",dot: "bg-emerald-500" },
  comptable:         { bg: "bg-amber-50",  text: "text-amber-700",  dot: "bg-amber-500"  },
  coordinateur:      { bg: "bg-violet-50", text: "text-violet-700", dot: "bg-violet-500" },
};

function agentStyle(key?: string) {
  return AGENT_COLORS[key || ""] ?? { bg: "bg-slate-50", text: "text-slate-600", dot: "bg-slate-400" };
}

function formatDate(iso?: string) {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  } catch {
    return null;
  }
}

export default function MissionDecisionCard({ job }: Props) {
  const result = (job.result || "").trim();
  const team = normalizeTeamRows(job.team);
  const subAgents = team.filter((r) => r.key && r.key !== "coordinateur");
  const warnings = job.delivery_warnings ?? [];
  const tokens = Number(job.tokens_total ?? 0);
  const cost = Number(job.cost_usd ?? 0);
  const events = Number(job.events_total ?? 0);
  const dateStr = formatDate(job.created_at);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Synthèse &amp; décision
        </p>
        {dateStr && (
          <span className="text-[10px] text-slate-400 tabular-nums">{dateStr}</span>
        )}
      </div>

      <div className="divide-y divide-slate-100">

        {/* ── Livrable ── */}
        <section className="px-4 py-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Livrable CIO
          </p>
          {result ? (
            <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2">
              <AgentMessageMarkdown
                source={result}
                className="text-[11px] leading-relaxed [&_h1]:text-xs [&_h1]:font-bold [&_h2]:text-[11px] [&_h2]:font-semibold [&_h3]:text-[10px] [&_h3]:font-semibold [&_li]:text-[11px] [&_p]:mb-1 [&_p]:text-[11px] [&_ul]:my-1 [&_ol]:my-1"
              />
            </div>
          ) : (
            <p className="text-xs italic text-slate-400">
              Aucun livrable textuel produit — vérifiez les journaux d&apos;exécution.
            </p>
          )}
        </section>

        {/* ── Équipe mobilisée ── */}
        {team.length > 0 && (
          <section className="px-4 py-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              Agents mobilisés
            </p>
            <div className="flex flex-wrap gap-1.5">
              {team.map((row, i) => {
                const s = agentStyle(row.key);
                return (
                  <div
                    key={`${row.key}-${i}`}
                    className={`flex items-center gap-1 rounded-lg border px-2 py-1 ${s.bg}`}
                    style={{ borderColor: "transparent" }}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
                    <span className={`text-[11px] font-medium ${s.text}`}>
                      {row.label || row.key}
                    </span>
                    {row.status && row.status !== "done" && (
                      <span className="text-[9px] text-slate-400">· {row.status}</span>
                    )}
                  </div>
                );
              })}
            </div>
            {subAgents.length === 0 && (
              <p className="text-[11px] text-slate-400">CIO seul — aucun sous-agent délégué.</p>
            )}
          </section>
        )}

        {/* ── Alertes livraison ── */}
        {warnings.length > 0 && (
          <section className="px-4 py-3">
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-600">
              ⚠ Points d&apos;attention
            </p>
            <ul className="space-y-1">
              {warnings.map((w, i) => (
                <li key={i} className="flex gap-1.5 text-[11px] text-amber-800">
                  <span className="mt-0.5 shrink-0 text-amber-500">•</span>
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── Métriques ── */}
        <section className="grid grid-cols-3 divide-x divide-slate-100 text-center">
          <div className="px-3 py-2.5">
            <p className="text-[9px] uppercase tracking-wide text-slate-400">Tokens</p>
            <p className="text-sm font-semibold tabular-nums text-slate-700">
              {tokens > 0 ? tokens.toLocaleString("fr-FR") : "—"}
            </p>
          </div>
          <div className="px-3 py-2.5">
            <p className="text-[9px] uppercase tracking-wide text-slate-400">Coût</p>
            <p className="text-sm font-semibold tabular-nums text-slate-700">
              {cost > 0 ? `$${cost.toFixed(4)}` : "—"}
            </p>
          </div>
          <div className="px-3 py-2.5">
            <p className="text-[9px] uppercase tracking-wide text-slate-400">Événements</p>
            <p className="text-sm font-semibold tabular-nums text-slate-700">
              {events > 0 ? events : "—"}
            </p>
          </div>
        </section>

        {/* ── Aide à la décision ── */}
        <section className="bg-violet-50/50 px-4 py-3">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-violet-600">
            Pour décider de la suite
          </p>
          <ul className="space-y-1 text-[11px] text-slate-600">
            {result ? (
              <li className="flex gap-1.5">
                <span className="text-violet-400">✓</span>
                Lisez le livrable ci-dessus — vérifiez qu&apos;il répond à la mission.
              </li>
            ) : (
              <li className="flex gap-1.5">
                <span className="text-amber-400">!</span>
                Aucun livrable : consultez les journaux dans le panneau de détail.
              </li>
            )}
            {subAgents.length > 0 && (
              <li className="flex gap-1.5">
                <span className="text-violet-400">✓</span>
                {subAgents.length} sous-agent{subAgents.length > 1 ? "s" : ""} sollicité{subAgents.length > 1 ? "s" : ""} —
                vérifiez leurs contributions dans « Détail d&apos;exécution ».
              </li>
            )}
            {warnings.length > 0 && (
              <li className="flex gap-1.5">
                <span className="text-amber-400">!</span>
                {warnings.length} alerte{warnings.length > 1 ? "s" : ""} de livraison — à traiter avant validation.
              </li>
            )}
            <li className="flex gap-1.5">
              <span className="text-violet-400">→</span>
              Validez si satisfaisant, ou relancez le CIO avec des instructions précises.
            </li>
          </ul>
        </section>

      </div>
    </div>
  );
}
