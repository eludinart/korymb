"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, Suspense } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import RepriseBriefingSection from "../../components/director/RepriseBriefingSection";
import ExecutiveBriefHero from "../../components/director/ExecutiveBriefHero";
import BriefingCommercialPanel, {
  type CommercialMorningSnapshot,
} from "../../components/director/BriefingCommercialPanel";
import BriefingEssential from "../../components/director/BriefingEssential";
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
import { useUiMode } from "../../lib/uiMode";

import type { Job } from "../../lib/types";

function isMariaDbTunnelError(message: string) {
  return /mariadb_tunnel_required/i.test(message);
}

function BriefingPageContent() {
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const showWelcome = searchParams.get("welcome") === "1";
  const packId = searchParams.get("pack");
  const { isEssential, loading: uiLoading } = useUiMode();
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");

  const me = useQuery({
    queryKey: ["auth-me-briefing"],
    queryFn: async () => {
      const r = await fetch("/api/auth/me", { cache: "no-store" });
      if (!r.ok) return null;
      return r.json() as Promise<{
        user?: { name?: string; email?: string; display_name?: string };
        workspace?: { ui_mode?: string };
      }>;
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
    enabled: !isEssential,
  });

  const b = briefing.data as
    | {
        decisions_today?: Array<{ id?: string; kind?: string; title?: string; mission?: string; href?: string }>;
        inbox_total?: number;
        missions_running?: Array<{ job_id: string; mission?: string }>;
        commercial?: CommercialMorningSnapshot | null;
        unconsulted_results?: Array<{
          job_id: string;
          mission?: string;
          status?: string;
          result_surface?: string | null;
        }>;
      }
    | undefined;
  const jobRows = jobs.data || [];
  const userName =
    me.data?.user?.display_name || me.data?.user?.name || me.data?.user?.email?.split("@")[0];

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

  if (uiLoading) {
    return (
      <PageShell size="wide">
        <LoadingLine />
      </PageShell>
    );
  }

  if (isEssential) {
    return (
      <PageShell size="wide">
        {briefing.isLoading ? <LoadingLine /> : null}
        {briefing.isError ? (
          <AlertBox tone="error" title="Accueil indisponible">
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
        <BriefingEssential
          userName={userName}
          showWelcome={showWelcome}
          packId={packId}
          decisions={b?.decisions_today || []}
          inboxTotal={Number(b?.inbox_total || 0)}
          missionsRunning={b?.missions_running || []}
        />
      </PageShell>
    );
  }

  return (
    <PageShell size="wide">
      {showWelcome ? (
        <div className="mb-6 rounded-2xl border-2 border-emerald-200 bg-emerald-50 px-4 py-4 sm:px-6">
          <p className="text-sm font-bold text-emerald-900">Bienvenue dans le cockpit dirigeant</p>
          <p className="mt-1 text-sm text-emerald-800">
            Mode Avancé actif. Pour une interface plus simple : Configuration → Essentiel.
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
            <BriefingCommercialPanel data={b.commercial} />
            <GestionShortcuts />
            <MissionQuickLaunch compact />

            {(b.unconsulted_results || []).length > 0 ? (
              <SectionCard title="Résultats à reprendre">
                <p className="mb-3 text-sm text-slate-600">
                  Missions terminées (ou en attente de validation) dont vous n&apos;avez pas encore ouvert le
                  résultat.
                </p>
                <ul className="space-y-3">
                  {(b.unconsulted_results || []).map((m) => (
                    <li
                      key={m.job_id}
                      className="flex flex-col gap-2 rounded-xl border-2 border-amber-200 bg-amber-50/70 p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="text-base font-bold text-slate-900">
                          {missionTitleLabel(m.mission, 100) || m.job_id}
                        </p>
                        <p className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-amber-800">
                          {String(m.status || "") === "awaiting_validation"
                            ? "Validation en attente"
                            : String(m.status || "").startsWith("error")
                              ? "Échec — à consulter"
                              : "Résultat non consulté"}
                        </p>
                        {m.result_surface ? (
                          <p className="mt-1 line-clamp-2 text-sm text-slate-600">{m.result_surface}</p>
                        ) : null}
                      </div>
                      <Link
                        href={`/missions?job=${encodeURIComponent(m.job_id)}`}
                        className="btn-link-primary shrink-0"
                      >
                        Reprendre →
                      </Link>
                    </li>
                  ))}
                </ul>
              </SectionCard>
            ) : null}

            {(b.missions_running || []).length > 0 ? (
              <SectionCard title="Missions en cours">
                <ul className="space-y-3">
                  {(b.missions_running || []).map((m) => (
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
