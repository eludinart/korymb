"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, Suspense } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import RepriseBriefingSection from "../../components/director/RepriseBriefingSection";
import ExecutiveBriefHero from "../../components/director/ExecutiveBriefHero";
import MissionQuickLaunch from "../../components/missions/MissionQuickLaunch";
import GestionShortcuts from "../../components/gestion/GestionShortcuts";
import {
  AlertBox,
  LoadingLine,
  PageShell,
  SectionCard,
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

function BriefingPageContent() {
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const showWelcome = searchParams.get("welcome") === "1";
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");

  const me = useQuery({
    queryKey: ["auth-me-briefing"],
    queryFn: async () => {
      const r = await fetch("/api/auth/me", { cache: "no-store" });
      if (!r.ok) return null;
      return r.json() as Promise<{ user?: { name?: string; email?: string } }>;
    },
    staleTime: 300_000,
  });

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
  const jobRows = jobs.data || [];
  const userName = me.data?.user?.name || me.data?.user?.email?.split("@")[0];

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
      {showWelcome ? (
        <div className="mb-6 rounded-2xl border-2 border-emerald-200 bg-emerald-50 px-4 py-4 sm:px-6">
          <p className="text-sm font-bold text-emerald-900">Bienvenue dans votre Korymb</p>
          <p className="mt-1 text-sm text-emerald-800">
            Votre rituel quotidien commence ici : briefing, inbox en 2 minutes, missions en un clic. Utilisez{" "}
            <kbd className="rounded bg-emerald-100 px-1 font-mono text-xs">Ctrl+K</kbd> pour naviguer vite.
          </p>
        </div>
      ) : null}

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
              <span className="font-mono">.\start-dev-cursor.ps1 -MariaDbTunnel</span>, puis rechargez.
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
            <ExecutiveBriefHero data={b} userName={userName} />
            <GestionShortcuts />
            <MissionQuickLaunch compact />

            {(b.missions_running || []).length > 0 ? (
              <SectionCard title="Missions en cours">
                <ul className="space-y-3">
                  {(b.missions_running || []).map((m: { job_id: string; mission?: string }) => (
                    <li
                      key={m.job_id}
                      className="flex flex-col gap-2 rounded-xl border-2 border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <span className="min-w-0 text-base font-bold text-slate-900">
                        {missionTitleLabel(m.mission, 100) || m.job_id}
                      </span>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <Link href={`/missions?job=${encodeURIComponent(m.job_id)}`} className="btn-link-primary">
                          Suivre
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
                  ))}
                </ul>
              </SectionCard>
            ) : null}
          </>
        ) : null}
      </div>
    </PageShell>
  );
}

export default function BriefingPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-500">Chargement du briefing…</div>}>
      <BriefingPageContent />
    </Suspense>
  );
}
