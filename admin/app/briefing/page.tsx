"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import RepriseBriefingSection from "../../components/director/RepriseBriefingSection";
import {
  AlertBox,
  LoadingLine,
  PageHeader,
  PageLink,
  PageShell,
  SectionCard,
  StatCard,
} from "../../components/ui/PageChrome";
import {
  BTN_DELETE,
  collectMissionDeleteJobIds,
  confirmDeleteMission,
  deleteMissionJobBundle,
  invalidateAfterMissionDelete,
} from "../../lib/deleteMissionBundle";
import { agentHeaders, requestJson } from "../../lib/api";
import { missionTitleLabel } from "../../lib/missionLabel";
import { QK } from "../../lib/queryClient";

import type { Job } from "../../lib/types";

function isMariaDbTunnelError(message: string) {
  return /mariadb_tunnel_required/i.test(message);
}

export default function BriefingPage() {
  const qc = useQueryClient();
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");

  const briefing = useQuery({
    queryKey: ["admin-briefing"],
    queryFn: async () =>
      (await requestJson("/admin/briefing?period=today", { headers: agentHeaders(), retries: 1, timeoutMs: 60_000 })).data,
    refetchInterval: 120_000,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const jobs = useQuery({
    queryKey: QK.jobsCards,
    queryFn: async () => {
      const { data } = await requestJson("/jobs/cards", { headers: agentHeaders(), retries: 1, timeoutMs: 30_000 });
      return ((data as { jobs?: Job[] })?.jobs || []) as Job[];
    },
    staleTime: 20_000,
  });

  const b = briefing.data;
  const hitlCount = Number(b?.hitl_pending_count ?? 0);
  const inboxTotal = Number(b?.inbox_total ?? 0);
  const jobRows = jobs.data || [];

  const deleteMission = async (jobId: string, mission?: string) => {
    if (!confirmDeleteMission(jobId, mission)) return;
    setDeleteBusyId(jobId);
    setDeleteError("");
    try {
      await deleteMissionJobBundle(collectMissionDeleteJobIds(jobId, jobRows), jobRows);
      invalidateAfterMissionDelete(qc);
      void briefing.refetch();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleteBusyId(null);
    }
  };

  return (
    <PageShell size="wide">
      <PageHeader
        accent="violet"
        badge="Cockpit dirigeant"
        title="Briefing du jour"
        description="Votre journée en un coup d'œil : décisions en attente, budget et missions actives."
        actions={
          <>
            <PageLink href="/inbox">Inbox {inboxTotal > 0 ? `(${inboxTotal})` : ""}</PageLink>
            <PageLink href="/missions" variant="secondary">
              Missions
            </PageLink>
          </>
        }
      />

      {deleteError ? (
        <AlertBox tone="error" title="Suppression impossible">
          {deleteError}
        </AlertBox>
      ) : null}

      {briefing.isLoading ? <LoadingLine /> : null}
      {briefing.isError ? (
        <AlertBox tone="error" title="Briefing indisponible">
          {isMariaDbTunnelError(briefing.error?.message || "") ? (
            <>
              Le tunnel MariaDB est coupé (port 3307). Relancez{" "}
              <span className="font-mono">.\start-dev-cursor.ps1 -MariaDbTunnel</span> ou le script{" "}
              <span className="font-mono">.\scripts\mariadb-vps-tunnel.ps1</span>, puis rechargez cette page.
            </>
          ) : (
            <>Vérifiez que le backend tourne, puis réessayez.</>
          )}
        </AlertBox>
      ) : null}

      <div className="space-y-6">
        <RepriseBriefingSection />

      {b ? (
        <>
          <section className="grid gap-3 sm:grid-cols-3">
            <StatCard label="Actions inbox" value={inboxTotal} tone={inboxTotal > 0 ? "urgent" : "default"} />
            <StatCard
              label="Validations requises"
              value={hitlCount}
              tone={hitlCount > 0 ? "warn" : "ok"}
              hint={hitlCount > 0 ? "Décision requise" : undefined}
            />
            <StatCard
              label="Missions en cours"
              value={(b.missions_running || []).length}
              tone="info"
            />
          </section>

          <SectionCard title="Budget IA" tone={b.budget?.budget_exceeded || b.budget?.alert ? "alert" : "budget"}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-sm font-bold text-slate-700">Aujourd&apos;hui</p>
                <p className="stat-value text-2xl">${Number(b.budget?.cost_today_usd || 0).toFixed(2)}</p>
              </div>
              <div>
                <p className="text-sm font-bold text-slate-700">Cette semaine</p>
                <p className="stat-value text-2xl">${Number(b.budget?.cost_week_usd || 0).toFixed(2)}</p>
              </div>
            </div>
            {b.budget?.budget_exceeded || b.budget?.alert ? (
              <p className="mt-3 rounded-xl bg-amber-100 px-3 py-2 text-sm font-extrabold text-amber-950 ring-2 ring-amber-300">
                Alerte budget — vérifiez la consommation avant de lancer de nouvelles missions.
              </p>
            ) : null}
          </SectionCard>

          <SectionCard title="Missions actives">
            <ul className="space-y-3">
              {(b.missions_running || []).length === 0 ? (
                <li className="text-muted-strong">Aucune mission en cours.</li>
              ) : (
                (b.missions_running || []).map((m: { job_id: string; mission?: string }) => (
                  <li
                    key={m.job_id}
                    className="flex flex-col gap-2 rounded-xl border-2 border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <span className="min-w-0 text-base font-bold text-slate-900">
                      {missionTitleLabel(m.mission, 100) || m.job_id}
                    </span>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Link href={`/missions?job=${encodeURIComponent(m.job_id)}`} className="btn-link-primary">
                        Ouvrir
                      </Link>
                      <button
                        type="button"
                        disabled={deleteBusyId === m.job_id}
                        onClick={() => void deleteMission(m.job_id, m.mission)}
                        className={BTN_DELETE}
                      >
                        {deleteBusyId === m.job_id ? "Suppression…" : "Supprimer"}
                      </button>
                    </div>
                  </li>
                ))
              )}
            </ul>
          </SectionCard>

          <SectionCard
            title={inboxTotal > 0 ? "Décisions en attente" : "Inbox dirigeant"}
            tone={inboxTotal > 0 ? "alert" : "default"}
          >
            {inboxTotal > 0 ? (
              <div className="space-y-3">
                <p className="text-sm font-semibold text-slate-800">
                  {inboxTotal} action{inboxTotal > 1 ? "s" : ""} nécessite{inboxTotal > 1 ? "nt" : ""} votre arbitrage
                  {hitlCount > 0 ? ` (${hitlCount} validation${hitlCount > 1 ? "s" : ""} HITL)` : ""}.
                </p>
                <Link href="/inbox" className="btn-primary inline-flex">
                  Ouvrir l&apos;inbox →
                </Link>
              </div>
            ) : (
              <p className="text-muted-strong">Rien en attente — bonne journée.</p>
            )}
          </SectionCard>
        </>
      ) : null}
      </div>
    </PageShell>
  );
}
