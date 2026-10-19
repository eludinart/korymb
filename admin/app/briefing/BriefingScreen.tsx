"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, Suspense } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import BriefingBoard, { type OpsBoard, type ProjectMilestonesBlock } from "../../components/director/BriefingBoard";
import { type CommercialMorningSnapshot } from "../../components/director/BriefingCommercialPanel";
import EnvelopeNotice, { type LlmEnvelope } from "../../components/director/EnvelopeNotice";
import IntentionLaunch from "../../components/missions/IntentionLaunch";
import ScenarioSimulator from "../../components/director/ScenarioSimulator";
import { AlertBox, LoadingLine, PageShell } from "../../components/ui/PageChrome";
import {
  collectMissionDeleteJobIds,
  deleteMissionJobBundle,
  invalidateAfterMissionDelete,
} from "../../lib/deleteMissionBundle";
import { useUndoRibbon } from "../../lib/undoRibbon";
import { agentHeaders, requestJson } from "../../lib/api";
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
  const { isEssential, loading: uiLoading } = useUiMode();
  const { pushUndo } = useUndoRibbon();
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [scenariosOpen, setScenariosOpen] = useState(false);

  useEffect(() => {
    if (window.location.hash === "#scenarios") setScenariosOpen(true);
  }, []);

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
        decisions_today?: Array<{ id?: string; kind?: string; title?: string; mission?: string; href?: string; severity?: string }>;
        inbox_total?: number;
        missions_running?: Array<{ job_id: string; mission?: string }>;
        missions_todo?: Array<{ job_id: string; mission?: string }>;
        executive_summary?: string;
        board?: OpsBoard | null;
        project_milestones?: ProjectMilestonesBlock | null;
        commercial?: CommercialMorningSnapshot | null;
        memory_digest?: { lines?: string[]; pending_count?: number; href?: string } | null;
        day_anticipation?: {
          lines?: string[];
          events?: Array<{ id?: string; title?: string; when_label?: string; href?: string }>;
          href?: string;
        } | null;
        inbox_severity?: { critical?: number; high?: number; medium?: number; low?: number } | null;
        llm_envelope?: LlmEnvelope | null;
        llm_readiness?: { ready?: boolean; blocker?: string | null } | null;
        budget?: { budget_exceeded?: boolean; alert?: boolean } | null;
        recent_errors?: Array<{ job_id?: string; mission?: string; error?: string }>;
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

  const deleteMission = (jobId: string, mission?: string) => {
    const label = (mission || jobId).trim() || jobId;
    pushUndo(`Suppression de ${label}`, undefined, () => {
      void runDeleteMission(jobId);
    });
  };

  const runDeleteMission = async (jobId: string) => {
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

  const tunnelDown = isMariaDbTunnelError(briefing.error?.message || "");

  return (
    <PageShell size="board">
      {showWelcome ? (
        <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-800 dark:bg-emerald-950">
          <p className="text-sm font-bold text-emerald-900 dark:text-emerald-100">
            {isEssential ? "Premiers pas" : "Bienvenue"}
          </p>
          <p className="mt-1 text-sm text-emerald-800 dark:text-emerald-200">
            {isEssential
              ? "Le contexte de l'espace s'écrit une question à la fois. Rien n'est enregistré sans votre accord."
              : "Le tableau ci-dessous classe l'urgent, le travail en cours et les propositions."}
          </p>
          {isEssential ? (
            <ul className="mt-3 space-y-2">
              <li>
                <Link href="/administration/contexte" className="text-sm font-bold text-emerald-950 underline dark:text-emerald-50">
                  Dire ce que vous suivez ici
                </Link>
              </li>
              <li>
                <Link href="/gestion/planning/nouveau" className="text-sm font-bold text-emerald-950 underline dark:text-emerald-50">
                  Ajouter un rendez-vous
                </Link>
              </li>
              <li>
                <Link href="/chat" className="text-sm font-bold text-emerald-950 underline dark:text-emerald-50">
                  Faire une demande
                </Link>
              </li>
            </ul>
          ) : null}
        </div>
      ) : null}

      {deleteError ? (
        <AlertBox tone="error" title="Suppression impossible">
          {deleteError}
        </AlertBox>
      ) : null}

      <EnvelopeNotice envelope={b?.llm_envelope} />
      {briefing.isLoading ? <LoadingLine /> : null}
      {briefing.isError ? (
        <AlertBox tone="error" title="Aujourd'hui indisponible">
          {tunnelDown ? (
            <>
              Le tunnel MariaDB est coupé (port 3307). Relancez{" "}
              <span className="font-mono">.\start-dev-cursor.ps1 -MariaDbTunnel</span>, puis rechargez.
            </>
          ) : (
            <>Vérifiez que le backend tourne, puis réessayez.</>
          )}
        </AlertBox>
      ) : null}

      {b ? (
        <BriefingBoard
          userName={userName}
          summary={b.executive_summary}
          board={b.board}
          milestones={b.project_milestones}
          decisions={b.decisions_today || []}
          running={b.missions_running || []}
          planned={b.missions_todo || []}
          unconsulted={b.unconsulted_results || []}
          dayEvents={b.day_anticipation?.events || []}
          dayLines={b.day_anticipation?.lines || []}
          dayHref={b.day_anticipation?.href}
          signals={{
            recentErrors: b.recent_errors || [],
            followUpsOverdue: Number(b.commercial?.counts?.follow_ups_overdue || 0),
            followUpsDueToday: Number(b.commercial?.counts?.follow_ups_due_today || 0),
            staleQuotes: Number(b.commercial?.counts?.stale_quotes || 0),
            mailNeedsReply: Number(b.commercial?.counts?.email_threads_needs_reply || 0),
            budgetExceeded: Boolean(b.budget?.budget_exceeded),
            budgetAlert: Boolean(b.budget?.alert),
            llmReady: b.llm_readiness?.ready,
            llmBlocker: b.llm_readiness?.blocker,
            envelopeBlocked: Boolean(b.llm_envelope?.blocked),
            envelopePaused: Boolean(b.llm_envelope?.paused),
            envelopeWarn: Boolean(b.llm_envelope?.warn),
            envelopePercent: Number(b.llm_envelope?.percent || 0),
          }}
          inboxTotal={Number(b.inbox_total || 0)}
          memoryPending={Number(b.memory_digest?.pending_count || 0)}
          memoryHref={b.memory_digest?.href}
          onDeleteRunning={isEssential ? undefined : (jobId, mission) => void deleteMission(jobId, mission)}
          deleteBusyId={deleteBusyId}
        />
      ) : null}

      {isEssential ? (
        <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <h2 className="text-sm font-extrabold text-slate-950 dark:text-slate-50">Demander</h2>
          <p className="mt-0.5 mb-3 text-xs text-slate-500">Une phrase suffit. Le résultat revient ici, à valider si besoin.</p>
          <IntentionLaunch compact />
        </section>
      ) : (
        <div className="mt-4" id="scenarios">
          <button
            type="button"
            onClick={() => setScenariosOpen((v) => !v)}
            className="text-sm font-bold text-violet-800 underline-offset-2 hover:underline dark:text-violet-200"
          >
            {scenariosOpen ? "Fermer les scénarios" : "Et si…"}
          </button>
          {scenariosOpen ? (
            <div className="mt-3">
              <ScenarioSimulator />
            </div>
          ) : null}
        </div>
      )}
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
