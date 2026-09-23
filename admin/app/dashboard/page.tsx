"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import AgentDeleteDialog from "../../components/admin/AgentDeleteDialog";
import FleetDeleteDialog from "../../components/admin/FleetDeleteDialog";
import { formatHttpApiErrorPayload, agentHeaders, requestJson } from "../../lib/api";
import type { AuthMeResponse } from "../../lib/authSession";
import {
  BTN_DELETE,
  collectMissionDeleteJobIds,
  confirmDeleteMission,
  deleteMissionJobBundle,
  invalidateAfterMissionDelete,
} from "../../lib/deleteMissionBundle";
import { schedulerReject } from "../../lib/missionActions";
import { normalizeTeamRows, type TeamRow } from "../../lib/jobTeam";
import { QK } from "../../lib/queryClient";
import { activeFleetGroups, type FleetGroupOption } from "../../components/missions/MissionFleetSelect";
import { PageHeader, PageLink, PageShell } from "../../components/ui/PageChrome";
import { ENTERPRISE_GROUP_ID, IDENTITY_CARD, identityFromGroupId } from "../../lib/agentGroupUi";

import type { AgentCard, Job, JobRow } from "../../lib/types";

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

type AgentStatusRow = { agent: AgentCard; runningForAgent: JobRow[] };

type FleetSection = {
  id: string;
  label: string;
  kind: "orchestra" | "project";
  leadKey: string;
  isSystem: boolean;
  rows: AgentStatusRow[];
};

type AgentAdminActions = {
  ficheHref: string;
  onRemove?: () => void;
  removeBusy?: boolean;
  removeDisabled?: boolean;
  removeTitle?: string;
  onDelete?: () => void;
};

function groupAgentsByFleet(
  statuses: AgentStatusRow[],
  groups: FleetGroupOption[],
): { sections: FleetSection[]; unassigned: AgentStatusRow[] } {
  const byKey = new Map(statuses.map((row) => [row.agent.key, row]));
  const assigned = new Set<string>();
  const sections: FleetSection[] = [];
  for (const group of activeFleetGroups(groups)) {
    const lead = (group.lead_agent_key || "").trim();
    const keys: string[] = [];
    if (lead) keys.push(lead);
    for (const raw of group.member_keys || []) {
      const key = (raw || "").trim();
      if (key && !keys.includes(key)) keys.push(key);
    }
    const rows = keys.map((key) => byKey.get(key)).filter((row): row is AgentStatusRow => Boolean(row));
    if (!rows.length) continue;
    for (const row of rows) assigned.add(row.agent.key);
    sections.push({
      id: group.id,
      label: (group.label || "").trim() || group.id,
      kind: identityFromGroupId(group.id),
      leadKey: lead,
      isSystem: Boolean(group.is_system) || group.id === ENTERPRISE_GROUP_ID,
      rows,
    });
  }
  return { sections, unassigned: statuses.filter((row) => !assigned.has(row.agent.key)) };
}

function fleetActivityLabel(rows: AgentStatusRow[]): string {
  const count = rows.length;
  const busy = rows.filter((row) => row.runningForAgent.length > 0).length;
  const agents = `${count} agent${count > 1 ? "s" : ""}`;
  if (busy === 0) return `${agents} · tous disponibles`;
  if (busy === count) return `${agents} · en activité`;
  return `${agents} · ${busy} en activité`;
}

function AgentStatusCard({
  row,
  lead,
  panelOpen,
  onToggle,
  admin,
}: {
  row: AgentStatusRow;
  lead: boolean;
  panelOpen: boolean;
  onToggle: () => void;
  admin?: AgentAdminActions | null;
}) {
  const { agent: a, runningForAgent } = row;
  const busy = runningForAgent.length > 0;
  return (
    <div
      className={`flex flex-wrap items-center gap-3 rounded-xl border bg-white px-3 py-3 ${
        panelOpen ? "border-violet-400 ring-1 ring-violet-200" : lead ? "border-amber-200" : "border-slate-200"
      }`}
    >
      <span className="shrink-0 text-2xl" aria-hidden>
        {agentIcon(a.key)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900">
          {a.label}
          {lead ? (
            <span className="ms-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900">
              Lead
            </span>
          ) : null}
        </p>
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
          onClick={onToggle}
          className={`min-h-[44px] rounded-lg border px-3 py-2.5 text-xs font-medium ${
            panelOpen
              ? "border-violet-300 bg-violet-50 text-violet-950"
              : "border-slate-200 bg-slate-50 text-slate-800 hover:bg-slate-100"
          }`}
        >
          {panelOpen ? "Masquer" : "Détail"}
        </button>
      </div>
      {admin ? (
        <div className="flex basis-full flex-wrap gap-x-3 gap-y-1 border-t border-slate-100 pt-2">
          <Link href={admin.ficheHref} className="text-xs font-medium text-violet-800 hover:underline">
            Fiche
          </Link>
          {admin.onRemove ? (
            <button
              type="button"
              disabled={admin.removeBusy || admin.removeDisabled}
              title={admin.removeTitle}
              onClick={admin.onRemove}
              className="text-xs font-medium text-slate-700 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline"
            >
              {admin.removeBusy ? "Retrait…" : "Retirer de la flotte"}
            </button>
          ) : null}
          {admin.onDelete ? (
            <button type="button" onClick={admin.onDelete} className="text-xs font-medium text-red-800 hover:underline">
              Supprimer
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function AgentDetailPanel({
  panel,
  deleteBusyId,
  onClose,
  onDelete,
}: {
  panel: { agent: AgentCard; jobsForAgent: JobRow[]; moreCount: number };
  deleteBusyId: string | null;
  onClose: () => void;
  onDelete: (jobId: string, mission?: string | null) => void;
}) {
  return (
    <div className="mt-4 rounded-xl border border-violet-200 bg-white p-4 shadow-sm sm:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900">Détail — {panel.agent.label}</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {panel.agent.role ? `${panel.agent.role} · ` : null}
            clé <span className="font-mono">{panel.agent.key}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          Fermer
        </button>
      </div>
      {panel.jobsForAgent.length === 0 ? (
        <p className="mt-3 text-sm text-slate-600">
          Aucune mission en base ne mobilise ce rôle pour l&apos;instant (pilote ou ligne d&apos;équipe).
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {panel.jobsForAgent.map((job) => {
            const inv = agentInvolvement(job, panel.agent.key);
            const running = job.status === "running";
            return (
              <li key={job.job_id} className="rounded-lg border border-slate-200 bg-slate-50/80 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900">{job.mission || "(sans titre)"}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {jobStatusLabelFr(job.status)}
                      {running ? (
                        <span className="ms-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-900">
                          actif
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Link
                      href={`/missions?job=${encodeURIComponent(job.job_id)}`}
                      className="text-xs font-medium text-violet-800 hover:underline"
                    >
                      Suivi →
                    </Link>
                    <button
                      type="button"
                      disabled={deleteBusyId === job.job_id}
                      onClick={() => onDelete(job.job_id, job.mission)}
                      className={BTN_DELETE}
                    >
                      {deleteBusyId === job.job_id ? "…" : "Supprimer"}
                    </button>
                  </div>
                </div>
                <div className="mt-2 space-y-1.5 text-xs text-slate-700">
                  {inv.primary ? (
                    <p>
                      <span className="font-semibold text-slate-800">Rôle :</span> agent pilote de la mission (agent
                      principal enregistré).
                    </p>
                  ) : null}
                  {inv.teamRow ? (
                    <div className="rounded-md border border-slate-200 bg-white px-2 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                        État dans l&apos;équipe (sous-mission)
                      </p>
                      <p className="mt-1">
                        <span className="font-semibold text-slate-800">Statut :</span> {inv.teamRow.status?.trim() || "—"}
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
      {panel.moreCount > 0 ? (
        <p className="mt-2 text-xs text-slate-500">
          + {panel.moreCount} autre(s) mission(s) concernant ce rôle (liste tronquée).
        </p>
      ) : null}
      <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
        Logs, fil de conversation CIO et chronologie multi-agents : page{" "}
        <Link href="/missions" className="font-medium text-violet-800 hover:underline">
          Missions
        </Link>
        .
      </p>
    </div>
  );
}

const visibleInterval = (ms: number) =>
  typeof document !== "undefined" && document.visibilityState === "visible" ? ms : false;

type PendingOutputRow = {
  id: string;
  output_type: string;
  title: string;
  target_platform: string;
  created_at: string;
};

const OUTPUT_TYPE_LABELS: Record<string, string> = {
  draft: "Brouillon",
  article: "Article",
  comment: "Commentaire",
  veille_summary: "Synthèse veille",
  mission_proposal: "Proposition de mission",
};

function outputTypeLabel(t: string): string {
  return OUTPUT_TYPE_LABELS[t] || t || "Output";
}

export default function DashboardPage() {
  const qc = useQueryClient();
  const [openAgent, setOpenAgent] = useState<{ key: string; fleetId: string | null } | null>(null);
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);
  const [rejectBusyId, setRejectBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [rosterBusyKey, setRosterBusyKey] = useState<string | null>(null);
  const [deleteFleet, setDeleteFleet] = useState<{ id: string; label: string } | null>(null);
  const [deleteAgent, setDeleteAgent] = useState<{ key: string; label: string } | null>(null);
  const jobs = useQuery({
    queryKey: QK.jobsCards,
    queryFn: async () =>
      (await requestJson("/jobs/cards", { headers: agentHeaders(), retries: 1, timeoutMs: 30_000 })).data.jobs || [],
    staleTime: 20_000,
    refetchInterval: (query) => {
      const base = visibleInterval(20_000);
      if (!base) return false;
      return query.state.fetchStatus === "fetching" ? false : base;
    },
  });
  const agents = useQuery({
    queryKey: QK.agents,
    queryFn: async () => (await requestJson("/agents", { retries: 1 })).data.agents || [],
    refetchInterval: () => visibleInterval(30000),
  });
  const me = useQuery({
    queryKey: ["auth-me"],
    queryFn: async () => {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      if (!res.ok) return null;
      return (await res.json()) as AuthMeResponse;
    },
    staleTime: 60_000,
  });
  const canAdmin = me.data?.role === "admin";

  const groupsQuery = useQuery({
    queryKey: ["agent-groups"],
    queryFn: async () => {
      const { data, res } = await requestJson("/agent-groups", { retries: 1, expectOk: false });
      if (!res.ok) throw new Error(String(data?.detail || `HTTP ${res.status}`));
      const list = (data as { groups?: unknown })?.groups;
      return Array.isArray(list) ? (list as FleetGroupOption[]) : [];
    },
    staleTime: 30_000,
  });

  const pendingApprovals = useQuery({
    queryKey: ["scheduler-outputs", "dashboard-pending"],
    queryFn: async () => {
      const params = new URLSearchParams({ status: "pending", limit: "20" });
      const { data } = await requestJson(`/scheduler/outputs?${params}`, { headers: agentHeaders() });
      return ((data.outputs || []) as PendingOutputRow[]) ?? [];
    },
    refetchInterval: () => visibleInterval(10000),
  });

  const jobRows = useMemo(() => (jobs.data || []) as JobRow[], [jobs.data]);
  const allJobs = useMemo(() => (jobs.data || []) as Job[], [jobs.data]);

  const deleteMission = async (jobId: string, mission?: string | null) => {
    if (!confirmDeleteMission(jobId, mission)) return;
    setDeleteBusyId(jobId);
    setActionError("");
    try {
      await deleteMissionJobBundle(collectMissionDeleteJobIds(jobId, allJobs), allJobs);
      invalidateAfterMissionDelete(qc);
      void pendingApprovals.refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleteBusyId(null);
    }
  };

  const rejectOutput = async (outputId: string, title: string) => {
    if (typeof window !== "undefined" && !window.confirm(`Rejeter « ${title || outputId} » ?`)) return;
    setRejectBusyId(outputId);
    setActionError("");
    try {
      await schedulerReject(outputId, "Rejeté depuis le dashboard métier");
      void pendingApprovals.refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setRejectBusyId(null);
    }
  };

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
    const agentPanelKey = openAgent?.key;
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
  }, [openAgent?.key, agents.data, jobs.data]);

  const fleetGrouping = useMemo(() => {
    if (!groupsQuery.isSuccess) return null;
    return groupAgentsByFleet(agentStatuses, groupsQuery.data || []);
  }, [groupsQuery.isSuccess, groupsQuery.data, agentStatuses]);

  const toggleAgent = (key: string, fleetId: string | null) => {
    setOpenAgent((cur) => (cur?.key === key && cur.fleetId === fleetId ? null : { key, fleetId }));
  };

  const removeFromFleet = async (fleetId: string, fleetLabel: string, agentKey: string, agentLabel: string) => {
    const group = (groupsQuery.data || []).find((g) => g.id === fleetId);
    if (!group) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Retirer « ${agentLabel} » de la flotte « ${fleetLabel} » ?\n\nLa fiche de l'agent est conservée.`)
    ) {
      return;
    }
    setRosterBusyKey(`${fleetId}:${agentKey}`);
    setActionError("");
    try {
      const member_keys = (group.member_keys || []).filter((k) => k !== agentKey);
      const { data, res } = await requestJson(`/admin/agent-groups/${encodeURIComponent(fleetId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_keys }),
        expectOk: false,
      });
      if (!res.ok) throw new Error(formatHttpApiErrorPayload(data) || `HTTP ${res.status}`);
      await qc.invalidateQueries({ queryKey: ["agent-groups"] });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setRosterBusyKey(null);
    }
  };

  const adminForAgent = (row: AgentStatusRow, fleetId: string | null, lead: boolean, fleetLabel: string) => {
    if (!canAdmin) return null;
    const busy = row.runningForAgent.length > 0;
    const custom = row.agent.builtin === false && !row.agent.is_manager;
    const actions: AgentAdminActions = {
      ficheHref: `/administration/agents/${encodeURIComponent(row.agent.key)}`,
    };
    if (fleetId && !lead) {
      actions.onRemove = () => void removeFromFleet(fleetId, fleetLabel, row.agent.key, row.agent.label);
      actions.removeBusy = rosterBusyKey === `${fleetId}:${row.agent.key}`;
      actions.removeDisabled = busy;
      actions.removeTitle = busy ? "En activité : retirez-le une fois la mission terminée." : undefined;
    }
    if (custom) {
      actions.onDelete = () => setDeleteAgent({ key: row.agent.key, label: row.agent.label });
    }
    return actions;
  };

  return (
    <PageShell size="wide" className="space-y-6">
      <PageHeader
        accent="sky"
        badge="Vue métier"
        title="Dashboard métier"
        description="Agents, approbations et activité par rôle — le suivi mission complet est sur Missions."
        actions={
          <>
            <PageLink href="/gestion">Gestion entreprise</PageLink>
            <PageLink href="/missions?create=quick">Nouvelle mission</PageLink>
            <PageLink href="/inbox" variant="secondary">
              Décisions
            </PageLink>
          </>
        }
      />

      {actionError ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{actionError}</p>
      ) : null}

      <section
        className={`rounded-2xl border p-5 ${
          pendingApprovals.isSuccess && (pendingApprovals.data || []).length > 0
            ? "border-amber-300 bg-gradient-to-br from-amber-50 to-white shadow-sm"
            : "border-slate-200 bg-white"
        }`}
        aria-labelledby="dash-approvals-heading"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="dash-approvals-heading" className="text-base font-semibold text-slate-900">
              File d&apos;approbation
            </h2>
            <p className="mt-1 max-w-2xl text-xs text-slate-600">
              Outputs générés par les tâches autonomes ou les réponses sociales en attente de validation avant publication.
            </p>
          </div>
          <Link
            href="/administration/approbations"
            className="min-h-[44px] shrink-0 rounded-lg bg-slate-900 px-3 py-2.5 text-xs font-medium text-white hover:bg-slate-800 active:bg-slate-950"
          >
            Ouvrir la file →
          </Link>
        </div>
        {pendingApprovals.isPending ? (
          <p className="mt-4 text-sm text-slate-400">Chargement des approbations…</p>
        ) : null}
        {pendingApprovals.isError ? (
          <div className="mt-4 space-y-1 text-sm text-red-700">
            <p>Impossible de charger la file d&apos;approbation.</p>
            <p className="text-xs text-slate-600">
              {pendingApprovals.error instanceof Error &&
              /injoignable|8020|fetch failed|503|500|timeout/i.test(pendingApprovals.error.message)
                ? "Le backend (port 8020) ne répond pas : relancez .\\start-dev-cursor.ps1 -MariaDbTunnel puis rechargez."
                : pendingApprovals.error instanceof Error
                  ? pendingApprovals.error.message
                  : null}
            </p>
          </div>
        ) : null}
        {pendingApprovals.isSuccess && (pendingApprovals.data || []).length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50/80 px-4 py-6 text-center text-sm text-slate-500">
            Aucun output en attente d&apos;approbation.
          </p>
        ) : null}
        {pendingApprovals.isSuccess && (pendingApprovals.data || []).length > 0 ? (
          <ul className="mt-4 space-y-2">
            {(pendingApprovals.data || []).slice(0, 6).map((o) => {
              const dateStr = o.created_at
                ? new Date(o.created_at).toLocaleString("fr-FR", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : null;
              return (
                <li
                  key={o.id}
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-100 bg-white/90 px-3 py-2.5"
                >
                  <span className="rounded-md bg-violet-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-900">
                    {outputTypeLabel(o.output_type)}
                  </span>
                  <span className="min-w-0 flex-1 text-sm font-medium text-slate-900 truncate" title={o.title}>
                    {o.title || "(sans titre)"}
                  </span>
                  {o.target_platform ? (
                    <span className="text-[10px] uppercase text-slate-400">{o.target_platform}</span>
                  ) : null}
                  {dateStr ? <span className="text-[11px] text-slate-400">{dateStr}</span> : null}
                  <button
                    type="button"
                    disabled={rejectBusyId === o.id}
                    onClick={() => void rejectOutput(o.id, o.title)}
                    className={BTN_DELETE}
                  >
                    {rejectBusyId === o.id ? "…" : "Rejeter"}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
        {pendingApprovals.isSuccess && (pendingApprovals.data || []).length > 6 ? (
          <p className="mt-2 text-center text-xs text-slate-500">
            + {(pendingApprovals.data || []).length - 6} autre(s) — voir la{" "}
            <Link href="/administration/approbations" className="font-medium text-violet-800 hover:underline">
              page Approbations
            </Link>
            .
          </p>
        ) : null}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-slate-50/90 p-5">
        <h2 className="text-lg font-bold tracking-tight text-slate-900">État des agents</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Les rôles sont regroupés par flotte : disponible ou en activité. Le bouton{" "}
          <span className="font-medium text-slate-700">Détail</span> affiche l&apos;état d&apos;exécution sur cette page.
          La composition, la politique et les fiches se règlent dans{" "}
          <Link href="/administration/equipes" className="font-medium text-violet-800 hover:underline">
            Équipes
          </Link>{" "}
          et les{" "}
          <Link href="/administration/agents" className="font-medium text-violet-800 hover:underline">
            fiches agents
          </Link>
          . Une flotte ou un agent ne se supprime que s&apos;il n&apos;est lié à rien d&apos;actif.
        </p>
        {agents.isLoading || (agents.isSuccess && groupsQuery.isPending) ? (
          <p className="mt-4 text-sm text-slate-400">Chargement des agents…</p>
        ) : null}
        {agents.isError ? <p className="mt-4 text-sm text-red-700">Impossible de charger les agents.</p> : null}
        {groupsQuery.isError ? (
          <p className="mt-4 text-sm text-amber-800">Flottes indisponibles — les agents restent listés à plat.</p>
        ) : null}
        {agents.isSuccess && (fleetGrouping || groupsQuery.isError) ? (
          <div className="mt-4 space-y-4">
            {(fleetGrouping?.sections || []).map((section) => (
              <div
                key={section.id}
                className={`rounded-2xl border-2 p-4 shadow-sm ${IDENTITY_CARD[section.kind]}`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <p
                      className={`text-[10px] font-bold uppercase tracking-wider ${
                        section.kind === "orchestra" ? "text-amber-800" : "text-sky-800"
                      }`}
                    >
                      Flotte
                    </p>
                    <h3 className="text-base font-semibold text-slate-900">{section.label}</h3>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
                    <p className="text-xs text-slate-500">{fleetActivityLabel(section.rows)}</p>
                    {canAdmin ? (
                      <>
                        <Link
                          href={`/administration/equipes?g=${encodeURIComponent(section.id)}`}
                          className="text-xs font-medium text-violet-800 hover:underline"
                        >
                          Modifier la flotte
                        </Link>
                        {section.isSystem ? null : (
                          <button
                            type="button"
                            onClick={() => setDeleteFleet({ id: section.id, label: section.label })}
                            className="text-xs font-medium text-red-800 hover:underline"
                          >
                            Supprimer la flotte
                          </button>
                        )}
                      </>
                    ) : null}
                  </div>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {section.rows.map((row) => {
                    const isLead = row.agent.key === section.leadKey;
                    return (
                    <AgentStatusCard
                      key={`${section.id}-${row.agent.key}`}
                      row={row}
                      lead={isLead}
                      panelOpen={openAgent?.key === row.agent.key && openAgent.fleetId === section.id}
                      onToggle={() => toggleAgent(row.agent.key, section.id)}
                      admin={adminForAgent(row, section.id, isLead, section.label)}
                    />
                    );
                  })}
                  {agentPanel && openAgent?.fleetId === section.id ? (
                    <AgentDetailPanel
                      panel={agentPanel}
                      deleteBusyId={deleteBusyId}
                      onClose={() => setOpenAgent(null)}
                      onDelete={(jobId, mission) => void deleteMission(jobId, mission)}
                    />
                  ) : null}
                </div>
              </div>
            ))}
            {(fleetGrouping ? fleetGrouping.unassigned : agentStatuses).length > 0 ? (
              <div
                className={
                  fleetGrouping && fleetGrouping.sections.length > 0
                    ? "rounded-2xl border border-dashed border-slate-300 bg-white/80 p-4"
                    : ""
                }
              >
                {fleetGrouping && fleetGrouping.sections.length > 0 ? (
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Sans flotte</p>
                      <h3 className="text-base font-semibold text-slate-900">Rôles non rattachés</h3>
                    </div>
                    <p className="text-xs text-slate-500">{fleetActivityLabel(fleetGrouping.unassigned)}</p>
                  </div>
                ) : null}
                <div
                  className={`grid gap-3 sm:grid-cols-2 ${
                    fleetGrouping && fleetGrouping.sections.length > 0 ? "mt-3" : ""
                  }`}
                >
                  {(fleetGrouping ? fleetGrouping.unassigned : agentStatuses).map((row) => (
                    <AgentStatusCard
                      key={`unassigned-${row.agent.key}`}
                      row={row}
                      lead={false}
                      panelOpen={openAgent?.key === row.agent.key && openAgent.fleetId === null}
                      onToggle={() => toggleAgent(row.agent.key, null)}
                      admin={adminForAgent(row, null, false, "")}
                    />
                  ))}
                  {agentPanel && openAgent?.fleetId === null ? (
                    <AgentDetailPanel
                      panel={agentPanel}
                      deleteBusyId={deleteBusyId}
                      onClose={() => setOpenAgent(null)}
                      onDelete={(jobId, mission) => void deleteMission(jobId, mission)}
                    />
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {deleteFleet ? (
        <FleetDeleteDialog
          groupId={deleteFleet.id}
          label={deleteFleet.label}
          onClose={() => setDeleteFleet(null)}
        />
      ) : null}
      {deleteAgent ? (
        <AgentDeleteDialog
          agentKey={deleteAgent.key}
          label={deleteAgent.label}
          onClose={() => setDeleteAgent(null)}
          onDeleted={() => {
            if (openAgent?.key === deleteAgent.key) setOpenAgent(null);
          }}
        />
      ) : null}

      <section className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 p-5 text-center">
        <h2 className="text-base font-semibold text-slate-900">Missions récentes</h2>
        <p className="mx-auto mt-2 max-w-lg text-sm text-slate-600">
          Liste triée, décision rapide et archives : tout est centralisé dans le hub Missions.
        </p>
        <Link href="/missions" className="btn-primary mt-4 inline-flex">
          Ouvrir le hub Missions →
        </Link>
      </section>
    </PageShell>
  );
}
