"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AgentActivationStrip } from "./AgentActivationBoard";
import ChatAgentMacaron from "./chat/ChatAgentMacaron";
import { agentHeaders, requestJson } from "../lib/api";
import {
  activeJobHref,
  activeJobSourceLabel,
  activeJobSourceTone,
  clipMissionTitle,
  fetchActiveAgentJobs,
  jobLifecycleVisual,
  pickPrimaryActiveJob,
  resolveJobWorkFocus,
  resolveAgentActivity,
  agentActivityDotClass,
  scoreActiveJobPriority,
  type ActiveAgentJob,
} from "../lib/activeAgentWork";
import { adaptivePollInterval } from "../lib/korymbEvents";
import {
  canPauseJob,
  canRelaunchOrphan,
  canResumeJob,
  canStopJob,
  cancelActiveJob,
  cleanupOrphanJobs,
  deleteJob,
  jobControlErrorMessage,
  pauseActiveJob,
  resumeActiveJob,
  restartStoppedJob,
} from "../lib/jobControl";
import { QK } from "../lib/queryClient";

const COLLAPSED_LS = "korymb_activity_bar_collapsed";

const SOURCE_STYLES: Record<ReturnType<typeof activeJobSourceTone>, string> = {
  chat: "bg-violet-100 text-violet-900 ring-violet-200",
  mission: "bg-sky-100 text-sky-900 ring-sky-200",
  hitl: "bg-amber-100 text-amber-950 ring-amber-200",
  auto: "bg-emerald-100 text-emerald-900 ring-emerald-200",
};

function readCollapsedPreference(): boolean | null {
  try {
    const raw = localStorage.getItem(COLLAPSED_LS);
    if (raw === "true") return true;
    if (raw === "false") return false;
  } catch {
    /* ignore */
  }
  return null;
}

function JobControlButtons({
  job,
  busy,
  onAction,
  onRelaunch,
}: {
  job: ActiveAgentJob;
  busy: boolean;
  onAction: (action: "pause" | "resume" | "cancel", job: ActiveAgentJob) => void;
  onRelaunch?: (job: ActiveAgentJob) => void;
}) {
  const showPause = canPauseJob(job);
  const showResume = canResumeJob(job);
  const showRelaunch = canRelaunchOrphan(job);
  const showStop = canStopJob(job);
  if (!showPause && !showResume && !showRelaunch && !showStop) return null;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
      {showResume ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => onAction("resume", job)}
          className="rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-bold text-emerald-900 hover:bg-emerald-100 disabled:opacity-40"
          title="Reprendre l'exécution"
        >
          {busy ? "…" : "Reprendre"}
        </button>
      ) : showRelaunch && onRelaunch ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => onRelaunch(job)}
          className="rounded-lg border border-violet-300 bg-violet-50 px-2.5 py-1.5 text-[11px] font-bold text-violet-900 hover:bg-violet-100 disabled:opacity-40"
          title="Relancer ce processus (nouvelle exécution)"
        >
          {busy ? "…" : "Relancer"}
        </button>
      ) : showPause ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => onAction("pause", job)}
          className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] font-bold text-amber-950 hover:bg-amber-100 disabled:opacity-40"
          title="Mettre en pause à la prochaine étape"
        >
          {busy ? "…" : "Pause"}
        </button>
      ) : null}
      {showStop ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => onAction("cancel", job)}
          className="rounded-lg border border-red-300 bg-red-50 px-2.5 py-1.5 text-[11px] font-bold text-red-900 hover:bg-red-100 disabled:opacity-40"
          title={job.execution_live === false ? "Nettoyer ce processus fantôme" : "Arrêter définitivement ce processus"}
        >
          {busy ? "…" : job.execution_live === false ? "Nettoyer" : "Arrêter"}
        </button>
      ) : null}
    </div>
  );
}

function ActiveJobCard({
  job,
  busy,
  onAction,
  onRelaunch,
}: {
  job: ActiveAgentJob;
  busy: boolean;
  onAction: (action: "pause" | "resume" | "cancel", job: ActiveAgentJob) => void;
  onRelaunch: (job: ActiveAgentJob) => void;
}) {
  const tone = activeJobSourceTone(job);
  const href = activeJobHref(job);
  const lifecycle = jobLifecycleVisual(job);
  const focus = resolveJobWorkFocus(job);
  const activity = resolveAgentActivity(job);

  return (
    <article className={`rounded-xl border-2 p-3 shadow-sm ring-1 ${lifecycle.cardClass}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ${
                activity.working
                  ? "bg-emerald-100 text-emerald-900 ring-emerald-300"
                  : "bg-slate-100 text-slate-700 ring-slate-300"
              }`}
              title={activity.freshness}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${agentActivityDotClass(activity.state)} ${
                  activity.working ? "animate-pulse" : ""
                }`}
              />
              {activity.label}
            </span>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ${SOURCE_STYLES[tone]}`}
            >
              {activeJobSourceLabel(job)}
            </span>
            <ChatAgentMacaron agentKey={focus.agentKey} label={focus.agentLabel} />
            <span className="font-mono text-[10px] text-slate-400">#{job.job_id}</span>
          </div>
          <p className="text-sm font-semibold leading-snug text-slate-900" title={job.mission || ""}>
            {clipMissionTitle(job.mission)}
          </p>
          <p className="text-xs leading-relaxed text-slate-600">
            <span className="font-medium text-slate-500">{focus.activityHeadline} :</span>{" "}
            {focus.activityDetail || job.last_event_preview || "—"}
          </p>
          <p
            className={`text-[11px] font-medium ${
              activity.working ? "text-emerald-700" : "text-slate-500"
            }`}
          >
            {activity.freshness}
          </p>
          {job.execution_live === false ? (
            <p className="text-[11px] font-medium text-slate-600">
              Processus bloqué en base (plus actif sur le serveur). Utilisez{" "}
              <strong>Nettoyer</strong> ou <strong>Relancer</strong>.
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <JobControlButtons job={job} busy={busy} onAction={onAction} onRelaunch={onRelaunch} />
          <Link
            href={href}
            className="rounded-lg bg-violet-700 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-violet-800"
          >
            Voir
          </Link>
        </div>
      </div>
      <div className="mt-2.5 border-t border-slate-100 pt-2">
        <p className="mb-1 text-[9px] font-bold uppercase tracking-wide text-slate-400">Équipe</p>
        <AgentActivationStrip events={job.events || []} jobStatus={job.status || ""} />
      </div>
    </article>
  );
}

function StoppedJobCard({
  job,
  busy,
  onRestart,
  onDelete,
}: {
  job: ActiveAgentJob;
  busy: boolean;
  onRestart: (job: ActiveAgentJob) => void;
  onDelete: (job: ActiveAgentJob) => void;
}) {
  const href = activeJobHref(job);
  return (
    <article className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-slate-300 bg-slate-50/90 p-3 ring-1 ring-slate-200">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-700 ring-1 ring-slate-300">
            <span className="h-1.5 w-1.5 rounded-full bg-slate-500" />
            Arrêté
          </span>
          <span className="font-mono text-[10px] text-slate-400">#{job.job_id}</span>
        </div>
        <p className="text-sm font-semibold text-slate-800">{clipMissionTitle(job.mission)}</p>
        <p className="text-[11px] text-slate-500">
          Interrompu manuellement — relancez la même consigne, ou supprimez-le définitivement.
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => onRestart(job)}
          className="rounded-lg border border-violet-300 bg-violet-700 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-violet-800 disabled:opacity-40"
        >
          {busy ? "…" : "Relancer"}
        </button>
        <Link
          href={href}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
        >
          Voir
        </Link>
        <button
          type="button"
          disabled={busy}
          onClick={() => onDelete(job)}
          className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-[11px] font-bold text-red-800 hover:bg-red-50 disabled:opacity-40"
          title="Supprimer définitivement de l'historique"
        >
          {busy ? "…" : "Supprimer"}
        </button>
      </div>
    </article>
  );
}

function ActivityStateLegend() {
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500">
      <span className="inline-flex items-center gap-1">
        <span className="h-2 w-2 rounded-full bg-violet-500" /> En cours
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="h-2 w-2 rounded-full bg-amber-500" /> En pause → bouton Reprendre
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="h-2 w-2 rounded-full bg-red-500" /> Arrêt en cours…
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="h-2 w-2 rounded-full bg-slate-500" /> Fantôme → Nettoyer / Relancer
      </span>
    </p>
  );
}

/** Strip d'une seule ligne : une pastille compacte par processus, avec son activité réelle en tooltip. */
function CompactProcessChips({ jobs }: { jobs: ActiveAgentJob[] }) {
  const ordered = [...jobs].sort((a, b) => scoreActiveJobPriority(b) - scoreActiveJobPriority(a));
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
      {ordered.map((job) => {
        const focus = resolveJobWorkFocus(job);
        const lifecycle = jobLifecycleVisual(job);
        const activity = resolveAgentActivity(job);
        const href = activeJobHref(job);
        const detail = focus.activityDetail || job.last_event_preview || "";
        const tip = `${clipMissionTitle(job.mission, 90)} — ${activity.label} · ${activity.freshness}${
          detail ? `\n${focus.activityHeadline} : ${detail}` : ""
        }`;
        return (
          <Link
            key={job.job_id}
            href={href}
            title={tip}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] transition hover:brightness-[0.97] ${lifecycle.cardClass}`}
          >
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${agentActivityDotClass(activity.state)} ${
                activity.working ? "animate-pulse" : ""
              }`}
              aria-hidden
            />
            <span className="font-bold uppercase tracking-wide text-violet-900">{focus.agentLabel}</span>
            <span className="max-w-[150px] truncate font-medium text-slate-700">
              {clipMissionTitle(job.mission, 40)}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

export default function AgentWorkActivityBar() {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [controlFeedback, setControlFeedback] = useState("");

  useEffect(() => {
    if (!controlFeedback) return;
    const t = window.setTimeout(() => setControlFeedback(""), 4_500);
    return () => window.clearTimeout(t);
  }, [controlFeedback]);

  useEffect(() => {
    const stored = readCollapsedPreference();
    if (stored !== null) setExpanded(!stored);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_LS, expanded ? "false" : "true");
    } catch {
      /* ignore */
    }
  }, [expanded]);

  const active = useQuery({
    queryKey: QK.jobsActive,
    queryFn: () => fetchActiveAgentJobs(requestJson, agentHeaders),
    refetchInterval: (query) => {
      const list = query.state.data?.jobs ?? [];
      const hasRunning = list.some((j) => j.status === "running" || j.status === "pending");
      const base = hasRunning ? 2_500 : 12_000;
      return adaptivePollInterval(base, base * 2);
    },
    staleTime: 1_500,
  });

  const jobs = active.data?.jobs ?? [];
  const recentlyStopped = active.data?.recentlyStopped ?? [];
  const orphanCount = active.data?.orphanCount ?? jobs.filter((j) => j.execution_live === false).length;
  const runningCount = jobs.filter((j) => j.status === "running").length;
  const pausedCount = jobs.filter((j) => j.status === "paused" || j.pause_requested).length;
  const waitingCount = jobs.filter((j) => j.status === "awaiting_validation").length;
  const workingCount = jobs.filter((j) => resolveAgentActivity(j).working).length;
  const total = jobs.length;
  const primary = pickPrimaryActiveJob(jobs);

  const invalidateActivity = useCallback(() => {
    void qc.invalidateQueries({ queryKey: QK.jobsActive });
    void qc.invalidateQueries({ queryKey: QK.jobsLight });
    void qc.invalidateQueries({ queryKey: QK.jobsCards });
  }, [qc]);

  const handleJobControl = useCallback(
    async (action: "pause" | "resume" | "cancel", job: ActiveAgentJob) => {
      const jid = job.job_id;
      if (!jid || busyJobId) return;
      if (action === "cancel") {
        const label = clipMissionTitle(job.mission, 56);
        const verb = job.execution_live === false ? "Nettoyer" : "Arrêter définitivement";
        if (
          typeof window !== "undefined" &&
          !window.confirm(`${verb} ce processus ?\n\n#${jid} — ${label}`)
        ) {
          return;
        }
      }
      setBusyJobId(jid);
      setControlFeedback("");
      try {
        let msg = "";
        if (action === "pause") {
          const r = await pauseActiveJob(jid);
          msg = String(r.message || "Pause demandée");
        } else if (action === "resume") {
          const r = await resumeActiveJob(jid);
          msg = String(r.message || "Processus repris");
        } else {
          const r = await cancelActiveJob(jid);
          msg = String(r.message || (r.forced ? "Processus fantôme nettoyé" : "Arrêt demandé"));
        }
        setControlFeedback(`${msg} — #${jid}`);
        invalidateActivity();
      } catch (err) {
        setControlFeedback(jobControlErrorMessage(err));
      } finally {
        setBusyJobId(null);
      }
    },
    [busyJobId, invalidateActivity],
  );

  const handleRestart = useCallback(
    async (job: ActiveAgentJob) => {
      const jid = job.job_id;
      if (!jid || busyJobId) return;
      setBusyJobId(jid);
      setControlFeedback("");
      try {
        const data = await restartStoppedJob(jid);
        const newId = String(data.job_id || "");
        setControlFeedback(
          newId
            ? `Processus relancé — nouveau job #${newId} (copie de #${jid})`
            : `Relance demandée pour #${jid}`,
        );
        invalidateActivity();
      } catch (err) {
        setControlFeedback(jobControlErrorMessage(err));
      } finally {
        setBusyJobId(null);
      }
    },
    [busyJobId, invalidateActivity],
  );

  const handleDelete = useCallback(
    async (job: ActiveAgentJob) => {
      const jid = job.job_id;
      if (!jid || busyJobId) return;
      const label = clipMissionTitle(job.mission, 56);
      if (
        typeof window !== "undefined" &&
        !window.confirm(`Supprimer définitivement ce processus de l'historique ?\n\n#${jid} — ${label}`)
      ) {
        return;
      }
      setBusyJobId(jid);
      setControlFeedback("");
      try {
        await deleteJob(jid);
        setControlFeedback(`Processus supprimé — #${jid}`);
        invalidateActivity();
      } catch (err) {
        setControlFeedback(jobControlErrorMessage(err));
      } finally {
        setBusyJobId(null);
      }
    },
    [busyJobId, invalidateActivity],
  );

  const handleCleanupAllOrphans = useCallback(async () => {
    if (busyJobId || orphanCount < 1) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Nettoyer ${orphanCount} processus fantôme(s) bloqués en base ?`)
    ) {
      return;
    }
    setBusyJobId("__cleanup__");
    setControlFeedback("");
    try {
      const data = await cleanupOrphanJobs();
      setControlFeedback(`${data.count ?? 0} processus fantôme(s) nettoyé(s).`);
      invalidateActivity();
    } catch (err) {
      setControlFeedback(jobControlErrorMessage(err));
    } finally {
      setBusyJobId(null);
    }
  }, [busyJobId, orphanCount, invalidateActivity]);

  if (active.isLoading && !active.data) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
        Vérification de l&apos;activité des agents…
      </div>
    );
  }

  if (active.isError) {
    const msg = active.error instanceof Error ? active.error.message : "";
    const maria = /mariadb_tunnel/i.test(msg);
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
        {maria ? (
          <>
            Tunnel MariaDB requis — relancez{" "}
            <code className="font-mono text-[10px]">.\start-dev-cursor.ps1 -MariaDbTunnel</code>.
          </>
        ) : (
          <>Impossible de lire l&apos;activité en cours{msg ? ` : ${msg}` : ""}.</>
        )}
      </div>
    );
  }

  if (total === 0 && recentlyStopped.length === 0) {
    return null;
  }

  return (
    <section
      className="overflow-hidden rounded-2xl border-2 border-violet-300 bg-gradient-to-br from-violet-50 via-white to-sky-50 shadow-md"
      role="status"
      aria-live="polite"
      aria-label="Activité des agents en cours"
    >
      <div className="flex flex-col gap-2 border-b border-violet-200/70 bg-violet-100/50 px-3 py-2 sm:flex-row sm:items-center sm:gap-2 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            {workingCount > 0 ? (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            ) : null}
            <span
              className={`relative inline-flex h-2.5 w-2.5 rounded-full ${workingCount > 0 ? "bg-emerald-500" : "bg-slate-400"}`}
            />
          </span>
          <h2 className="min-w-0 text-sm font-extrabold tracking-tight text-violet-950">
            {workingCount > 0
              ? `${workingCount} agent${workingCount > 1 ? "s" : ""} au travail${
                  total - workingCount > 0 ? ` · ${total - workingCount} en attente` : ""
                }`
              : runningCount > 0
                ? `${runningCount} ouvert${runningCount > 1 ? "s" : ""} · aucun agent actif`
                : pausedCount > 0
                  ? `${pausedCount} en pause`
                  : recentlyStopped.length > 0
                    ? `${recentlyStopped.length} arrêté${recentlyStopped.length > 1 ? "s" : ""}`
                    : `${total} en attente`}
          </h2>
        </div>
        {!expanded && total > 0 ? (
          <div className="min-w-0 sm:flex-1">
            <CompactProcessChips jobs={jobs} />
          </div>
        ) : (
          <div className="hidden min-w-0 flex-1 sm:block" />
        )}
        <div className="flex shrink-0 items-center gap-2">
          {orphanCount > 0 ? (
            <button
              type="button"
              disabled={Boolean(busyJobId)}
              onClick={() => void handleCleanupAllOrphans()}
              className="min-h-9 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-40"
            >
              Nettoyer {orphanCount} fantôme{orphanCount > 1 ? "s" : ""}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="min-h-9 rounded-lg border border-violet-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-violet-900 hover:bg-violet-50"
            aria-expanded={expanded}
          >
            {expanded ? "Réduire" : "Détail"}
          </button>
        </div>
      </div>

      {controlFeedback ? (
        <p
          className="border-b border-violet-100 bg-white/90 px-4 py-2 text-xs font-medium text-violet-950"
          role="status"
          aria-live="polite"
        >
          {controlFeedback}
        </p>
      ) : null}

      {expanded ? (
        <div className="space-y-3 p-3 sm:p-4">
          <ActivityStateLegend />
          <p className="text-xs leading-relaxed text-slate-600">
            <strong>Pause</strong> suspend à la prochaine étape (badge ambre + bouton Reprendre).{" "}
            <strong>Arrêter</strong> interrompt définitivement ; le processus passe en section grise avec{" "}
            <strong>Relancer</strong>.
          </p>
          <div className="grid gap-3 lg:grid-cols-2">
            {[...jobs]
              .sort((a, b) => {
                const primaryId = primary?.job_id;
                if (a.job_id === primaryId) return -1;
                if (b.job_id === primaryId) return 1;
                return 0;
              })
              .map((job) => (
                <ActiveJobCard
                  key={job.job_id}
                  job={job}
                  busy={busyJobId === job.job_id}
                  onAction={handleJobControl}
                  onRelaunch={handleRestart}
                />
              ))}
          </div>
          {recentlyStopped.length > 0 ? (
            <div className="space-y-2 border-t border-slate-200 pt-4">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-600">
                Récemment arrêtés ({recentlyStopped.length})
              </h3>
              <div className="grid gap-2">
                {recentlyStopped.map((job) => (
                  <StoppedJobCard
                    key={job.job_id}
                    job={job}
                    busy={busyJobId === job.job_id}
                    onRestart={handleRestart}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : !primary && recentlyStopped.length > 0 ? (
        <p className="px-4 py-2 text-xs text-slate-600">
          Aucun travail actif — {recentlyStopped.length} processus arrêté{recentlyStopped.length > 1 ? "s" : ""}{" "}
          récent{recentlyStopped.length > 1 ? "s" : ""}. Ouvrez <strong>Détail</strong> pour les relancer.
        </p>
      ) : null}
    </section>
  );
}
