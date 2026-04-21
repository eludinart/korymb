"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import MissionStatusBadge from "../../components/MissionStatusBadge";
import { useQuery } from "@tanstack/react-query";
import { agentHeaders, requestJson } from "../../lib/api";
import { plainTextSnippet, sortJobsForBossView } from "../../lib/missionBossView";
import { normalizeTeamRows, type TeamRow } from "../../lib/jobTeam";
import { QK } from "../../lib/queryClient";

type AgentCard = { key: string; label: string; role?: string };

type JobRow = {
  job_id: string;
  mission?: string;
  status?: string;
  agent?: string;
  team?: unknown;
  created_at?: string;
  result?: string | null;
  user_validated_at?: string | null;
  mission_closed_by_user?: boolean;
};

const AGENT_ICONS: Record<string, string> = {
  commercial: "💼",
  community_manager: "📣",
  developpeur: "💻",
  comptable: "📚",
  coordinateur: "🧭",
};

function agentIcon(key: string): string {
  return AGENT_ICONS[key] || "🤖";
}

function agentInvolvement(job: JobRow, agentKey: string): { primary: boolean; teamRow?: TeamRow } {
  const primary = (job.agent || "coordinateur").trim() === agentKey;
  const teamRow = normalizeTeamRows(job.team).find((r) => (r.key || "").trim() === agentKey);
  return { primary, teamRow };
}

function jobTouchesAgent(job: JobRow, agentKey: string): boolean {
  const { primary, teamRow } = agentInvolvement(job, agentKey);
  return primary || Boolean(teamRow);
}

function sortJobsForAgentPanel(jobs: JobRow[], agentKey: string): JobRow[] {
  const filtered = jobs.filter((j) => jobTouchesAgent(j, agentKey));
  return filtered.sort((a, b) => {
    const ar = a.status === "running" ? 0 : 1;
    const br = b.status === "running" ? 0 : 1;
    if (ar !== br) return ar - br;
    return String(b.created_at || "").localeCompare(String(a.created_at || ""));
  });
}

function jobStatusLabelFr(status: string | undefined): string {
  const s = (status || "").toLowerCase();
  const map: Record<string, string> = {
    running: "en cours",
    completed: "terminée",
    accepted: "acceptée",
    pending: "en attente",
    failed: "échec",
    error: "erreur",
  };
  return map[s] || (status || "—");
}

function formatAgentKeySubtitle(key: string): string {
  return key.replace(/_/g, " ");
}

const visibleInterval = (ms: number) =>
  typeof document !== "undefined" && document.visibilityState === "visible" ? ms : false;

export default function DashboardPage() {
  const [agentPanelKey, setAgentPanelKey] = useState<string | null>(null);
  const jobs = useQuery({
    queryKey: QK.jobs,
    queryFn: async () => (await requestJson("/jobs", { headers: agentHeaders() })).data.jobs || [],
    refetchInterval: () => visibleInterval(3000),
  });
  const agents = useQuery({
    queryKey: QK.agents,
    queryFn: async () => (await requestJson("/agents", { retries: 1 })).data.agents || [],
    refetchInterval: () => visibleInterval(30000),
  });

  const jobRows = useMemo(() => (jobs.data || []) as JobRow[], [jobs.data]);
  const recentJobs = useMemo(() => sortJobsForBossView(jobRows).slice(0, 8), [jobRows]);

  const agentStatuses = useMemo(() => {
    const list = (agents.data || []) as AgentCard[];
    const jr = (jobs.data || []) as JobRow[];
    const runningJobs = jr.filter((j) => j.status === "running");
    return list.map((a) => {
      const mine = runningJobs.filter((j) => jobTouchesAgent(j, a.key));
      return { agent: a, runningForAgent: mine };
    });
  }, [agents.data, jobs.data]);

  const agentPanel = useMemo(() => {
    if (!agentPanelKey) return null;
    const list = (agents.data || []) as AgentCard[];
    const agent = list.find((x) => x.key === agentPanelKey);
    if (!agent) return null;
    const jr = (jobs.data || []) as JobRow[];
    const sorted = sortJobsForAgentPanel(jr, agentPanelKey);
    const maxShown = 25;
    return {
      agent,
      jobsForAgent: sorted.slice(0, maxShown),
      moreCount: Math.max(0, sorted.length - maxShown),
    };
  }, [agentPanelKey, agents.data, jobs.data]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard metier</h1>
        <p className="text-sm text-slate-500 mt-1">Vue d&apos;ensemble opérationnelle unifiée (phase 1 Next).</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Link href="/mission/nouvelle" className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-medium">
          Nouvelle mission
        </Link>
        <Link href="/mission/guided" className="bg-violet-900 text-white px-4 py-2 rounded-lg text-sm font-medium">
          Mission guidee
        </Link>
        <Link href="/configuration" className="border border-slate-300 bg-white px-4 py-2 rounded-lg text-sm font-medium">
          Configuration
        </Link>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-slate-50/90 p-5">
        <h2 className="text-lg font-bold tracking-tight text-slate-900">État des agents</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Pour chaque rôle : disponible ou en activité. Le bouton <span className="font-medium text-slate-700">Détail</span>{" "}
          affiche l&apos;état d&apos;exécution sur cette page (missions mobilisant le rôle, statut mission, ligne équipe).
          Le suivi complet (fil CIO, logs) reste sur{" "}
          <Link href="/missions" className="font-medium text-violet-800 hover:underline">
            Missions
          </Link>
          .
        </p>
        {agents.isLoading ? <p className="mt-4 text-sm text-slate-400">Chargement des agents…</p> : null}
        {agents.isError ? <p className="mt-4 text-sm text-red-700">Impossible de charger les agents.</p> : null}
        {agents.isSuccess ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {agentStatuses.map(({ agent: a, runningForAgent }, idx) => {
              const busy = runningForAgent.length > 0;
              const panelOpen = agentPanelKey === a.key;
              return (
                <div
                  key={`${a.key}-${idx}`}
                  className={`flex flex-wrap items-center gap-3 rounded-xl border bg-white px-3 py-3 ${
                    panelOpen ? "border-violet-400 ring-1 ring-violet-200" : "border-slate-200"
                  }`}
                >
                  <span className="shrink-0 text-2xl" aria-hidden>
                    {agentIcon(a.key)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900">{a.label}</p>
                    <p className="text-xs lowercase text-slate-500">{formatAgentKeySubtitle(a.key)}</p>
                    {busy ? (
                      <ul className="mt-1.5 space-y-0.5">
                        {runningForAgent.map((j) => (
                          <li key={j.job_id} className="truncate text-xs text-slate-600" title={j.mission}>
                            {j.mission || `Mission #${j.job_id}`}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
                    <span
                      className={`rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                        busy ? "bg-amber-100 text-amber-900" : "bg-indigo-100 text-indigo-900"
                      }`}
                    >
                      {busy ? "En activité" : "Disponible"}
                    </span>
                    <button
                      type="button"
                      aria-expanded={panelOpen}
                      onClick={() => setAgentPanelKey((k) => (k === a.key ? null : a.key))}
                      className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
                        panelOpen
                          ? "border-violet-300 bg-violet-50 text-violet-950"
                          : "border-slate-200 bg-slate-50 text-slate-800 hover:bg-slate-100"
                      }`}
                    >
                      {panelOpen ? "Masquer" : "Détail"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
        {agentPanel ? (
          <div className="mt-4 rounded-xl border border-violet-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-slate-900">Détail — {agentPanel.agent.label}</h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  {agentPanel.agent.role ? `${agentPanel.agent.role} · ` : null}
                  clé <span className="font-mono">{agentPanel.agent.key}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAgentPanelKey(null)}
                className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Fermer
              </button>
            </div>
            {agentPanel.jobsForAgent.length === 0 ? (
              <p className="mt-3 text-sm text-slate-600">
                Aucune mission en base ne mobilise ce rôle pour l&apos;instant (pilote ou ligne d&apos;équipe).
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {agentPanel.jobsForAgent.map((job) => {
                  const inv = agentInvolvement(job, agentPanel.agent.key);
                  const running = job.status === "running";
                  return (
                    <li key={job.job_id} className="rounded-lg border border-slate-200 bg-slate-50/80 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-slate-900">{job.mission || "(sans titre)"}</p>
                          <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                            #{job.job_id} · mission {jobStatusLabelFr(job.status)}
                            {running ? (
                              <span className="ms-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-900">
                                actif
                              </span>
                            ) : null}
                          </p>
                        </div>
                        <Link
                          href={`/missions?job=${encodeURIComponent(job.job_id)}`}
                          className="shrink-0 text-xs font-medium text-violet-800 hover:underline"
                        >
                          Suivi complet →
                        </Link>
                      </div>
                      <div className="mt-2 space-y-1.5 text-xs text-slate-700">
                        {inv.primary ? (
                          <p>
                            <span className="font-semibold text-slate-800">Rôle :</span> agent pilote de la mission
                            (agent principal enregistré).
                          </p>
                        ) : null}
                        {inv.teamRow ? (
                          <div className="rounded-md border border-slate-200 bg-white px-2 py-2">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                              État dans l&apos;équipe (sous-mission)
                            </p>
                            <p className="mt-1">
                              <span className="font-semibold text-slate-800">Statut :</span>{" "}
                              {inv.teamRow.status?.trim() || "—"}
                            </p>
                            {inv.teamRow.phase ? (
                              <p>
                                <span className="font-semibold text-slate-800">Phase :</span> {inv.teamRow.phase}
                              </p>
                            ) : null}
                            {inv.teamRow.detail ? (
                              <p className="mt-1 whitespace-pre-wrap text-slate-600">{inv.teamRow.detail}</p>
                            ) : null}
                          </div>
                        ) : inv.primary ? (
                          <p className="text-slate-600">
                            Pas de ligne d&apos;équipe dédiée à ce rôle : suivre le statut de mission ci-dessus.
                          </p>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {agentPanel.moreCount > 0 ? (
              <p className="mt-2 text-xs text-slate-500">+ {agentPanel.moreCount} autre(s) mission(s) concernant ce rôle (liste tronquée).</p>
            ) : null}
            <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
              Logs, fil de conversation CIO et chronologie multi-agents : page{" "}
              <Link href="/missions" className="font-medium text-violet-800 hover:underline">
                Missions
              </Link>
              .
            </p>
          </div>
        ) : null}
      </section>

      <section className="bg-white border border-slate-200 rounded-2xl p-5">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h2 className="text-sm font-semibold text-slate-900">Activité récente</h2>
          <Link href="/missions" className="text-xs font-medium text-violet-800 hover:underline">
            Toutes les missions
          </Link>
        </div>
        <p className="mb-3 text-xs text-slate-500">
          Tri prioritaire : à traiter / en cours / avec livrable. Aperçu texte de la synthèse quand elle est déjà là.
        </p>
        {jobs.isLoading ? <p className="text-sm text-slate-400">Chargement…</p> : null}
        {jobs.isError ? <p className="text-sm text-red-700">Impossible de charger les missions.</p> : null}
        {jobs.isSuccess && recentJobs.length === 0 ? <p className="text-sm text-slate-500">Aucune mission récente.</p> : null}
        {jobs.isSuccess && recentJobs.length > 0 ? (
          <ul className="divide-y divide-slate-100">
            {recentJobs.map((j) => {
              const snip = plainTextSnippet(j.result);
              return (
                <li key={j.job_id} className="py-3 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <MissionStatusBadge status={j.status} />
                    </div>
                    <p className="text-sm font-medium leading-snug text-slate-900">{j.mission || "(sans titre)"}</p>
                    <p className="text-xs text-slate-500 font-mono">
                      #{j.job_id} · {j.agent || "coordinateur"}
                    </p>
                    {snip ? (
                      <p className="text-xs leading-relaxed text-slate-600 line-clamp-2" title={snip}>
                        {snip}
                      </p>
                    ) : null}
                  </div>
                  <Link
                    href={`/missions?job=${encodeURIComponent(j.job_id)}`}
                    className="shrink-0 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-xs font-medium text-violet-900 hover:bg-violet-100"
                  >
                    Synthèse CIO
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
