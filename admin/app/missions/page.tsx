"use client";

import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import AgentMessageMarkdown from "../../components/AgentMessageMarkdown";
import AgentActivationBoard, { AgentActivationStrip } from "../../components/AgentActivationBoard";
import AgentMindMap from "../../components/AgentMindMap";
import CioResultPanel from "../../components/CioResultPanel";
import CioQuestionsPanel from "../../components/CioQuestionsPanel";
import MissionDecisionCard from "../../components/MissionDecisionCard";
import CollapsibleMissionSection from "../../components/CollapsibleMissionSection";
import SimpleAccordion from "../../components/SimpleAccordion";
import MissionEventTimeline from "../../components/MissionEventTimeline";
import MissionMetricsRow from "../../components/MissionMetricsRow";
import MissionStatusBadge from "../../components/MissionStatusBadge";
import SessionCadrageTimeline from "../../components/SessionCadrageTimeline";
import MissionDeliverablesPanel from "../../components/MissionDeliverablesPanel";
import ExpandableMissionReader from "../../components/ExpandableMissionReader";
import CioPlanHitlPanel from "../../components/CioPlanHitlPanel";
import MissionHitlResolver from "../../components/missions/MissionHitlResolver";
import CioResumePanel from "../../components/missions/CioResumePanel";
import { deliverablesForMissionPanel } from "../../lib/extractTeamDeliverables";
import { sortJobsForBossView } from "../../lib/missionBossView";
import { normalizeTeamRows, teamRowKey } from "../../lib/jobTeam";
import { eventPayload } from "../../lib/missionEvents";
import { bestPreview, extractCioStrategicQuestions } from "../../lib/missionBilan";
import { agentHeaders, requestJson } from "../../lib/api";
import { QK } from "../../lib/queryClient";
import { deliverablesMarkdownFromBossContext } from "../../lib/missionDeliverablesMarkdown";
import { PageHeader, PageShell } from "../../components/ui/PageChrome";
import { threadHasPendingCioTurn, canResumeMissionCio } from "../../lib/missionThreadPending";

import type { Job } from "../../lib/types";

async function fetchJobDetail(jobId: string) {
  const { data } = await requestJson(
    `/jobs/${encodeURIComponent(jobId)}?log_offset=0&events_offset=0`,
    { headers: agentHeaders(), retries: 2, timeoutMs: 60_000 },
  );
  return data;
}

async function validateJob(jobId: string) {
  const headers = agentHeaders();
  return requestJson(`/jobs/${encodeURIComponent(jobId)}/validate-mission`, {
    method: "POST",
    headers,
    expectOk: false,
    timeoutMs: 60_000,
    retries: 1,
  });
}

async function closeMissionJob(jobId: string) {
  const headers = agentHeaders();
  return requestJson(`/jobs/${encodeURIComponent(jobId)}/close-mission`, {
    method: "POST",
    headers,
    expectOk: false,
    timeoutMs: 60_000,
    retries: 1,
  });
}

function MissionsContent() {
  const qc = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [cioResumeInput, setCioResumeInput] = useState("");
  const [cioResumeBusy, setCioResumeBusy] = useState(false);
  const [cioResumeLiveId, setCioResumeLiveId] = useState<string | null>(null);
  const [cioQuestionBusy, setCioQuestionBusy] = useState(false);
  const [mobileDetailPane, setMobileDetailPane] = useState<"fil" | "resultats">("fil");
  // Toggle global : le CIO peut-il poser des questions en cours de mission ?
  const [cioQuestionsEnabled, setCioQuestionsEnabled] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("cio_questions_enabled") !== "false";
  });
  const jobs = useQuery({
    queryKey: QK.jobsCards,
    queryFn: async () => {
      const { data } = await requestJson("/jobs/cards", { headers: agentHeaders(), retries: 0, timeoutMs: 15_000 });
      const list = (data as { jobs?: unknown })?.jobs;
      return Array.isArray(list) ? (list as Job[]) : [];
    },
    staleTime: 20_000,
    refetchInterval: (query) => {
      if (typeof document === "undefined" || document.visibilityState !== "visible") return false;
      if (query.state.fetchStatus === "fetching") return false;
      return 20_000;
    },
  });

  const rows = useMemo(() => (jobs.data || []) as Job[], [jobs.data]);
  const missionRows = useMemo(
    () => rows.filter((j) => String(j.source || "mission") !== "chat"),
    [rows],
  );
  const sortedRows = useMemo(() => sortJobsForBossView(missionRows), [missionRows]);

  // Pour chaque job parent, retrouver le job enfant le plus récent (continuation terminée)
  const latestChildByParent = useMemo(() => {
    const map = new Map<string, Job>();
    for (const j of rows) {
      const pid = j.parent_job_id;
      if (!pid) continue;
      const existing = map.get(pid);
      if (!existing || (j.created_at ?? "") > (existing.created_at ?? "")) {
        map.set(pid, j);
      }
    }
    return map;
  }, [rows]);
  useEffect(() => {
    const j = searchParams.get("job");
    if (j) setSelected(j);
  }, [searchParams]);

  useEffect(() => {
    setMobileDetailPane("fil");
  }, [selected]);

  const detail = useQuery({
    queryKey: ["job-detail-live", selected],
    enabled: Boolean(selected),
    queryFn: () => fetchJobDetail(String(selected)),
    placeholderData: keepPreviousData,
    retry: 2,
    retryDelay: (attempt) => Math.min(1500 * 2 ** attempt, 8000),
    refetchInterval: (query) => {
      if (!selected || typeof document === "undefined" || document.visibilityState !== "visible") return false;
      if (query.state.fetchStatus === "fetching") return false;
      if (cioResumeLiveId) return 2000;
      const st = String((query.state.data as { status?: string } | undefined)?.status || "");
      if (st === "running" || st === "awaiting_validation") return 3000;
      return 15_000;
    },
  });

  const detailRefreshError = detail.isError
    ? detail.error instanceof Error
      ? detail.error.message
      : String(detail.error ?? "")
    : "";
  const backendLikelyDown =
    /injoignable|8020|fetch failed|ECONNREFUSED|503/i.test(detailRefreshError) ||
    detailRefreshError === "HTTP 500";

  const cioResumeLive = useQuery({
    queryKey: ["mission-cio-resume-live", cioResumeLiveId],
    enabled: Boolean(cioResumeLiveId),
    queryFn: () => fetchJobDetail(String(cioResumeLiveId)),
    placeholderData: keepPreviousData,
    retry: 2,
    refetchInterval: (query) => {
      if (!cioResumeLiveId || typeof document === "undefined" || document.visibilityState !== "visible") return false;
      if (query.state.fetchStatus === "fetching") return false;
      return 2500;
    },
  });

  const selectedJobStatus = String(detail.data?.status || "");
  const missionClosedByUser = Boolean(
    detail.data?.user_validated_at || detail.data?.mission_closed_by_user,
  );
  const hasPendingCioTurn = useMemo(
    () => threadHasPendingCioTurn(detail.data?.mission_thread),
    [detail.data?.mission_thread],
  );
  /** Poursuite chat liée : autorisée en terminé, erreur, en cours, pending, ou fil en attente de réponse CIO. */
  const canResumeCio = Boolean(
    selected &&
      detail.data &&
      canResumeMissionCio(selectedJobStatus, missionClosedByUser, hasPendingCioTurn),
  );
  const missionRunningStuck = canResumeCio && selectedJobStatus === "running" && !cioResumeLiveId;
  const canCloseMission = Boolean(
    selected && detail.data && !missionClosedByUser && !cioResumeLiveId && selectedJobStatus !== "cancelled",
  );

  useEffect(() => {
    setCioResumeLiveId(null);
    setCioResumeInput("");
    setCioResumeBusy(false);
    setCioQuestionBusy(false);
  }, [selected]);

  // Extraire les questions CIO depuis les événements du job sélectionné
  const cioQuestions = useMemo(() => {
    const evts = (detail.data?.events || []) as Array<Record<string, unknown>>;
    return evts
      .filter((ev) => ev.type === "cio_question")
      .map((ev) => {
        const pl = eventPayload(ev);
        const raw = pl.questions;
        const questions = Array.isArray(raw) ? raw.map((q) => String(q).trim()).filter(Boolean) : [];
        return {
          questions,
          answered: Boolean(pl.answered),
          missionPreview: String(pl.mission_preview || ""),
        };
      })
      .filter((q) => q.questions.length > 0);
  }, [detail.data?.events]);

  const pendingCioQuestionCount = useMemo(
    () =>
      cioQuestions.filter((q) => !q.answered).reduce((n, q) => n + (q.questions?.length || 0), 0),
    [cioQuestions],
  );
  const hasPendingCioQuestions = pendingCioQuestionCount > 0;

  /** Actions CIO / questions (carte sous le fil : clôture, précisions, options). */
  const showDecisionRail = Boolean(
    selected &&
      detail.data &&
      !cioResumeLiveId &&
      (canResumeCio || cioQuestions.length > 0 || canCloseMission),
  );
  /** Colonne gauche type chat (fil + actions) dès que le détail mission est chargé. */
  const showConversationSidebar = Boolean(detail.data);

  const onAnswerCioQuestion = async (answer: string) => {
    if (!selected || !answer.trim() || cioQuestionBusy) return;
    setCioQuestionBusy(true);
    setError("");
    try {
      // Injecter directement dans le fil de la mission courante (non-bloquant)
      await requestJson(`/jobs/${encodeURIComponent(selected)}/cio-answer`, {
        method: "POST",
        headers: agentHeaders(),
        timeoutMs: 10000,
        body: JSON.stringify({ answer }),
      });
      // Rafraîchir les événements pour mettre à jour l'état "answered"
      void qc.invalidateQueries({ queryKey: ["job-detail-live", selected] });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCioQuestionBusy(false);
    }
  };

  const cioResumeLiveDone = useMemo(() => {
    if (!cioResumeLive.data || !cioResumeLiveId) return false;
    const st = String(cioResumeLive.data.status || "");
    return st === "completed" || st.startsWith("error");
  }, [cioResumeLive.data, cioResumeLiveId]);

  // Données actives : pendant la continuation → job de continuation ; sinon → job principal
  const activeBoardData = useMemo(
    () => (cioResumeLiveId && cioResumeLive.data ? cioResumeLive.data : (detail.data ?? null)),
    [cioResumeLiveId, cioResumeLive.data, detail.data],
  );

  useEffect(() => {
    if (!cioResumeLiveDone || !cioResumeLiveId) return;
    setCioResumeLiveId(null);
    void qc.invalidateQueries({ queryKey: ["job-detail-live", selected] });
    void qc.invalidateQueries({ queryKey: QK.jobsCards });
    void qc.invalidateQueries({ queryKey: QK.tokens });
  }, [cioResumeLiveDone, cioResumeLiveId, qc, selected]);

  const selectedMissionSynth = useMemo(() => {
    if (!selected || !detail.data) return null;
    const d = detail.data as Job;
    const latestChild = latestChildByParent.get(selected);
    const liveD = (cioResumeLiveId && cioResumeLive.data ? cioResumeLive.data : (latestChild ?? d)) as Job;
    const hasChild = Boolean(latestChild && !cioResumeLiveId);
    const fb = d.latest_chat_followup;
    const fbOk =
      fb &&
      String(fb.status || "") === "completed" &&
      String(fb.result || "").trim().length > 0;
    const liveSt = cioResumeLive.data ? String(cioResumeLive.data.status || "") : "";
    const liveHasResult =
      Boolean(cioResumeLiveId && cioResumeLive.data) &&
      liveSt === "completed" &&
      String((cioResumeLive.data as Job | undefined)?.result || "").trim().length > 0;
    let cardResult = (String(liveD.result || "") || String(d.result || "")) as string;
    let cardTeam = liveD.team ?? d.team;
    let cardTokens = Number(liveD.tokens_total ?? 0);
    let cardCost = Number(liveD.cost_usd ?? 0);
    let cardEvents = Number(liveD.events_total ?? 0);
    if (liveHasResult && cioResumeLive.data) {
      const cr = cioResumeLive.data as Job;
      cardResult = String(cr.result || "");
      cardTeam = cr.team ?? cardTeam;
      cardTokens = Number(cr.tokens_total ?? cardTokens);
      cardCost = Number(cr.cost_usd ?? cardCost);
      cardEvents = Number(cr.events_total ?? cardEvents);
    } else if (fbOk && fb && !cioResumeLiveId) {
      cardResult = String(fb.result || "");
      cardTeam = fb.team ?? cardTeam;
      cardTokens = Number(fb.tokens_total ?? cardTokens);
      cardCost = Number(fb.cost_usd ?? cardCost);
      cardEvents = Number(fb.events_total ?? cardEvents);
    }
    const del = deliverablesMarkdownFromBossContext(
      d,
      latestChild,
      cioResumeLiveId,
      (cioResumeLive.data as Job | undefined) ?? undefined,
    );
    return {
      cardResult,
      cardTeam,
      cardTokens,
      cardCost,
      cardEvents,
      hasChild,
      liveStatus: String(liveD.status || ""),
      deliveryWarnings: (liveD.delivery_warnings as string[] | undefined) ?? [],
      deliveryBlocked: Boolean(liveD.delivery_blocked),
      deliverablesMarkdown: del.markdown,
      deliverablesTeam: del.team,
    };
  }, [selected, detail.data, latestChildByParent, cioResumeLiveId, cioResumeLive.data]);

  const cioSynthReaderBadge = useMemo(() => {
    if (!selectedMissionSynth) return null;
    const n = deliverablesForMissionPanel(
      selectedMissionSynth.deliverablesMarkdown,
      normalizeTeamRows(selectedMissionSynth.deliverablesTeam),
    ).length;
    const parts: string[] = [];
    if (String(selectedMissionSynth.cardResult || "").trim().length > 40) parts.push("Synthèse CIO");
    if (n > 0) parts.push(`${n} livrable${n > 1 ? "s" : ""}`);
    return parts.length ? parts.join(" · ") : null;
  }, [selectedMissionSynth]);

  const onCioResumeSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selected || !cioResumeInput.trim() || cioResumeBusy || cioResumeLiveId) return;
    const msg = cioResumeInput.trim();
    setCioResumeBusy(true);
    setError("");
    try {
      const { data } = await requestJson("/chat", {
        method: "POST",
        headers: agentHeaders(),
        timeoutMs: 20000,
        body: JSON.stringify({
          message: msg,
          agent: "coordinateur",
          history: [],
          linked_job_id: selected,
          mission_config: { cio_questions_enabled: cioQuestionsEnabled },
        }),
      });
      setCioResumeInput("");
      if (data?.status === "accepted" && data?.job_id) {
        setCioResumeLiveId(String(data.job_id));
        setFeedback("");
      } else {
        setError("Réponse chat inattendue (pas de job_id).");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCioResumeBusy(false);
    }
  };

  const clearMissionSelection = () => {
    setSelected(null);
    router.replace("/missions");
  };

  const onValidate = async (jobId: string) => {
    setBusyId(jobId);
    setError("");
    setFeedback("");
    try {
      await validateJob(jobId);
      setFeedback(`Mission #${jobId} validée.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
      qc.invalidateQueries({ queryKey: QK.jobsCards });
      qc.invalidateQueries({ queryKey: QK.tokens });
      qc.invalidateQueries({ queryKey: ["job-detail-live", jobId] });
    }
  };

  const onCloseMission = async (jobId: string) => {
    const ok = window.confirm(
      "Clôturer cette mission ?\n\nVous la considérez terminée : elle ne sera plus modifiable (poursuite CIO désactivée). Les livrables restent consultables.",
    );
    if (!ok) return;
    setBusyId(jobId);
    setError("");
    setFeedback("");
    try {
      await closeMissionJob(jobId);
      setFeedback(`Mission #${jobId} clôturée.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
      qc.invalidateQueries({ queryKey: QK.jobsCards });
      qc.invalidateQueries({ queryKey: QK.tokens });
      qc.invalidateQueries({ queryKey: ["job-detail-live", jobId] });
    }
  };

  return (
    <PageShell size="wide" className="space-y-3">
      {!selected ? (
        <PageHeader
          accent="emerald"
          badge="Suivi opérationnel"
          title="Missions"
          description="Les missions à valider et en cours remontent en premier. Touchez une carte pour le détail complet."
        />
      ) : null}
      {!selected ? (
      <div className="grid w-full min-w-0 max-w-full gap-4 lg:grid-cols-[minmax(320px,1fr)_minmax(320px,1fr)]">
        <div className="min-w-0 space-y-3">
        {error ? <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p> : null}
        {feedback ? (
          <p className="break-words text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
            {feedback}
          </p>
        ) : null}
        {jobs.isPending && !jobs.isError ? <p className="text-sm text-slate-500">Chargement des missions…</p> : null}
        {jobs.isError ? (
          <div className="space-y-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
            <p>
              Impossible de charger la liste des missions
              {jobs.error instanceof Error ? ` : ${jobs.error.message}` : ""}.
            </p>
            <p className="text-xs text-red-600/90">
              Le backend (port 8020) est peut-être bloqué sur MariaDB. Relancez{" "}
              <span className="font-mono">.\start-dev-cursor.ps1 -MariaDbTunnel</span> puis rechargez.
            </p>
            <button
              type="button"
              onClick={() => void jobs.refetch()}
              className="text-xs font-semibold text-red-800 underline hover:text-red-950"
            >
              Réessayer
            </button>
          </div>
        ) : null}
        {sortedRows.map((j) => {
          const closed = j.user_validated_at || j.mission_closed_by_user;
          const st = String(j.status || "");
          const canValidate = st === "completed" && !closed;
          const canCloseFromList = !closed && st !== "cancelled" && !canValidate;
          // Si une continuation a été faite sur ce job, utiliser son résultat pour la preview
          const latestChild = latestChildByParent.get(j.job_id);
          const bestResultSource = latestChild ?? j;
          const rawResult = String(bestResultSource.result || "").trim();
          const previewText = bestPreview(rawResult, 25);
                  return (
            <div
              key={j.job_id}
              className="min-w-0 bg-white border border-slate-200 rounded-2xl p-4 cursor-pointer transition-shadow hover:border-slate-300"
              onClick={() => setSelected(j.job_id)}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
                <div className="min-w-0 w-full flex-1 space-y-2 sm:w-auto">
                  <div className="flex flex-wrap items-center gap-2">
                    <MissionStatusBadge status={j.status} />
                    {canValidate ? (
                      <span className="rounded-md bg-violet-900 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                        À valider
                      </span>
                    ) : null}
                  </div>
                  <div className="max-h-52 min-h-0 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50/95 p-2.5 text-left shadow-inner">
                    {j.mission?.trim() ? (
                      <AgentMessageMarkdown
                        source={j.mission}
                        className="text-xs [&_blockquote]:my-1 [&_blockquote]:py-1 [&_h1]:mb-1 [&_h1]:mt-0 [&_h1]:border-0 [&_h1]:pb-0 [&_h1]:text-[13px] [&_h2]:mb-1 [&_h2]:mt-2 [&_h2]:text-xs [&_h3]:text-[11px] [&_li]:my-0 [&_li]:text-[11px] [&_ol]:my-1 [&_p]:mb-1 [&_p]:text-[11px] [&_ul]:my-1"
                      />
                    ) : (
                      <p className="text-xs font-medium text-slate-500">(mission sans titre)</p>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 font-mono">
                    #{j.job_id} · {j.agent || "coordinateur"}
                  </p>
                  {previewText ? (
                    <SimpleAccordion
                      title="Bilan CIO"
                      defaultOpen={false}
                      className="min-h-0 rounded-lg border border-slate-100 bg-white text-left"
                      triggerClassName="px-2.5 py-2"
                      panelClassName="border-t border-slate-100 px-2.5 pb-2.5 pt-2"
                    >
                      <AgentMessageMarkdown
                        source={previewText}
                        className="text-[11px] [&_h1]:mb-1 [&_h1]:text-[11px] [&_h2]:mb-1 [&_h2]:text-[11px] [&_h3]:text-[11px] [&_li]:text-[10px] [&_li]:my-0.5 [&_p]:mb-1 [&_p]:text-[11px] [&_ul]:my-1"
                      />
                    </SimpleAccordion>
                  ) : (
                    <p className="text-xs text-slate-400">Pas encore de synthèse disponible.</p>
                  )}
                </div>
                {canValidate ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void onValidate(j.job_id);
                    }}
                    disabled={busyId === j.job_id}
                    className="min-h-[44px] w-full shrink-0 rounded-lg bg-violet-900 px-3 py-2.5 text-xs font-semibold text-white disabled:opacity-40 sm:w-auto"
                  >
                    {busyId === j.job_id ? "Validation…" : "Valider"}
                  </button>
                ) : canCloseFromList ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void onCloseMission(j.job_id);
                    }}
                    disabled={busyId === j.job_id}
                    className="min-h-[44px] w-full shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-xs font-semibold text-slate-800 disabled:opacity-40 sm:w-auto"
                  >
                    {busyId === j.job_id ? "Clôture…" : "Clôturer"}
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
        {jobs.isSuccess && missionRows.length === 0 ? (
          <p className="text-sm text-slate-400">Aucune mission.</p>
        ) : null}
        </div>
        <section className="min-h-[280px] min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="space-y-4">
              <AgentMindMap />
              <p className="text-xs text-slate-400 leading-relaxed">
                Cliquez sur une mission à gauche : la page affichera uniquement son détail, avec un bouton pour revenir à
                cette liste.
              </p>
            </div>
        </section>
      </div>
      ) : (
      <div className="w-full min-w-0 space-y-3">
        <div className="space-y-2 border-b border-slate-200 pb-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <button
              type="button"
              onClick={clearMissionSelection}
              className="inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 shadow-sm hover:bg-slate-50 active:bg-slate-100"
            >
              ← Liste
            </button>
            <h1 className="shrink-0 text-lg font-bold tracking-tight text-slate-900">Missions</h1>
            {detail.data?.mission?.trim() ? (
              <p
                className="min-w-0 flex-1 truncate text-xs font-medium leading-snug text-slate-600"
                title={detail.data.mission.trim()}
              >
                {detail.data.mission.trim()}
              </p>
            ) : (
              <p className="font-mono text-[11px] text-slate-500">#{selected}</p>
            )}
          </div>
          {activeBoardData ? (
            <AgentActivationStrip
              events={activeBoardData.events}
              jobStatus={String(activeBoardData.status || "")}
              className="w-full min-w-0"
            />
          ) : null}
        </div>
        {error ? <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p> : null}
        {feedback ? (
          <p className="break-words text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
            {feedback}
          </p>
        ) : null}

        {showConversationSidebar ? (
          <div className="mobile-tab-bar lg:hidden">
            <button
              type="button"
              onClick={() => setMobileDetailPane("fil")}
              className={`mobile-tab ${mobileDetailPane === "fil" ? "mobile-tab-active" : "mobile-tab-inactive"}`}
            >
              Fil CIO
            </button>
            <button
              type="button"
              onClick={() => setMobileDetailPane("resultats")}
              className={`mobile-tab ${mobileDetailPane === "resultats" ? "mobile-tab-active" : "mobile-tab-inactive"}`}
            >
              Synthèse & livrables
            </button>
          </div>
        ) : null}

        <div
          className={
            showConversationSidebar
              ? "lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-stretch lg:gap-6 xl:gap-8 lg:h-[calc(100dvh-10.5rem)] lg:max-h-[calc(100dvh-10.5rem)] lg:min-h-0"
              : ""
          }
        >
          {showConversationSidebar && detail.data ? (
            <aside
              className={`order-first mb-6 flex min-h-[min(72dvh,38rem)] min-w-0 flex-col overflow-y-auto overflow-x-hidden lg:order-none lg:mb-0 lg:h-full lg:max-h-full lg:min-h-0 lg:pr-0.5 ${
                mobileDetailPane === "fil" ? "flex" : "hidden lg:flex"
              }`}
            >
              <div className="relative flex min-h-[14rem] min-w-0 flex-1 flex-col overflow-hidden">
                <SessionCadrageTimeline
                  fillColumn
                  messages={detail.data.mission_thread}
                  missionPlan={detail.data.plan}
                  missionBrief={detail.data.mission}
                  title="Fil de cadrage avec le CIO"
                  className="h-full min-h-0 flex-1 shadow-sm"
                  cioStrategicFollowup={extractCioStrategicQuestions(
                    String(selectedMissionSynth?.cardResult ?? detail.data.result ?? ""),
                  )}
                  footer={
                    canResumeCio ? (
                      <CioResumePanel
                        jobId={String(selected)}
                        jobStatus={selectedJobStatus}
                        missionClosed={missionClosedByUser}
                        hasPendingCioTurn={hasPendingCioTurn}
                        variant="compact"
                        liveJobId={cioResumeLiveId}
                        onLiveJobIdChange={setCioResumeLiveId}
                      />
                    ) : null
                  }
                />
              </div>
              {showDecisionRail ? (
                <div className="mt-2 max-h-[min(36vh,18rem)] shrink-0 overflow-y-auto overflow-x-hidden rounded-2xl border border-violet-200 bg-white shadow-sm ring-1 ring-violet-100/90">
                  {canCloseMission && canResumeCio ? (
                    <div className="border-b border-violet-100 p-3">
                      <button
                        type="button"
                        disabled={busyId === selected}
                        onClick={() => void onCloseMission(String(selected))}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-40"
                      >
                        {busyId === selected ? "Clôture…" : "Clôturer la mission (terminée pour moi)"}
                      </button>
                      <p className="mt-1.5 text-[10px] leading-snug text-slate-500">
                        Enregistre votre clôture dirigeant — la poursuite CIO sera désactivée.
                      </p>
                    </div>
                  ) : missionClosedByUser ? (
                    <div className="border-b border-emerald-100/80 bg-emerald-50/80 px-3 py-3">
                      <p className="text-xs font-semibold text-emerald-900">Mission clôturée</p>
                      <p className="mt-1 text-[11px] text-emerald-800">
                        Consultez la synthèse et les livrables dans la colonne de droite.
                      </p>
                    </div>
                  ) : null}
                  <SimpleAccordion
                    key={`cio-dock-more-${selected}`}
                    title={
                      hasPendingCioQuestions
                        ? `Précisions CIO (${pendingCioQuestionCount})`
                        : "Précisions, questions & options"
                    }
                    hint="Déplier pour questions pendant mission, réglages et rappels"
                    defaultOpen={hasPendingCioQuestions}
                    className="rounded-b-2xl bg-violet-50/30"
                    triggerClassName="w-full rounded-b-2xl px-3 py-2.5 text-left hover:bg-violet-50/80"
                    panelClassName="max-h-[min(42vh,20rem)] space-y-3 overflow-y-auto border-t border-violet-100/90 bg-white/90 px-3 py-3"
                  >
                    <p className="text-[11px] leading-snug text-slate-600">
                      Le fil ci-dessus s&apos;enrichit à chaque échange ; la synthèse et les livrables se mettent à jour
                      dans la colonne de droite après exécution.
                    </p>
                    {canResumeCio && !cioResumeLiveId ? (
                      <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50/90 px-3 py-2">
                        <div className="min-w-0 pr-2">
                          <p className="text-[11px] font-semibold text-slate-800">Questions CIO pendant la mission</p>
                          <p className="text-[10px] text-slate-500">Le CIO peut solliciter des précisions.</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const next = !cioQuestionsEnabled;
                            setCioQuestionsEnabled(next);
                            localStorage.setItem("cio_questions_enabled", String(next));
                          }}
                          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${cioQuestionsEnabled ? "bg-violet-600" : "bg-slate-300"}`}
                          aria-label="Activer ou désactiver les questions CIO en cours de mission"
                        >
                          <span
                            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${cioQuestionsEnabled ? "translate-x-4" : "translate-x-0.5"}`}
                          />
                        </button>
                      </div>
                    ) : null}
                    {cioQuestions.length > 0 && !cioResumeLiveId ? (
                      <CioQuestionsPanel
                        questions={cioQuestions}
                        onAnswer={(a) => onAnswerCioQuestion(a)}
                        busy={cioQuestionBusy}
                      />
                    ) : null}
                    {!(canResumeCio && !cioResumeLiveId) ? (
                      <Link
                        href={`/chat?parent=${encodeURIComponent(String(selected))}`}
                        className="inline-flex text-[11px] font-medium text-violet-800 underline hover:text-violet-950"
                      >
                        Ouvrir la conversation dans Chat (même dossier)
                      </Link>
                    ) : null}
                  </SimpleAccordion>
                </div>
              ) : null}
            </aside>
          ) : null}

          <div
            className={`min-w-0 space-y-4 lg:min-h-0 lg:max-h-full lg:overflow-y-auto lg:pr-1 ${
              showConversationSidebar && mobileDetailPane === "fil" ? "hidden lg:block" : "block"
            }`}
          >
            {showConversationSidebar && mobileDetailPane === "resultats" && showDecisionRail && canResumeCio && !cioResumeLiveId ? (
              <div className="rounded-2xl border border-violet-300 bg-violet-50/90 p-3 shadow-sm lg:hidden">
                <p className="text-xs font-semibold text-violet-950">Discuter avec le CIO</p>
                <p className="mt-1 text-[11px] text-violet-900/90">
                  Le champ de saisie est sur l&apos;onglet <span className="font-semibold">Fil CIO</span>, ou utilisez le
                  formulaire ci‑dessous.
                </p>
                {missionRunningStuck ? (
                  <p className="mt-2 text-[11px] text-amber-900">Mission « en cours » — relancez via une consigne.</p>
                ) : null}
                <form onSubmit={onCioResumeSubmit} className="mt-3 space-y-2">
                  <textarea
                    value={cioResumeInput}
                    onChange={(e) => setCioResumeInput(e.target.value)}
                    disabled={cioResumeBusy}
                    rows={3}
                    className="w-full resize-y rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm disabled:opacity-50"
                    placeholder="Votre message au CIO…"
                    aria-label="Consigne pour le CIO"
                  />
                  <button
                    type="submit"
                    disabled={cioResumeBusy || !cioResumeInput.trim()}
                    className="w-full rounded-xl bg-violet-700 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
                  >
                    {cioResumeBusy ? "Envoi…" : "Envoyer au CIO"}
                  </button>
                  {canCloseMission ? (
                    <button
                      type="button"
                      disabled={busyId === selected}
                      onClick={() => void onCloseMission(String(selected))}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800 disabled:opacity-40"
                    >
                      {busyId === selected ? "Clôture…" : "Clôturer la mission"}
                    </button>
                  ) : null}
                </form>
              </div>
            ) : null}
            {detail.data && selectedMissionSynth ? (
              <MissionDecisionCard
                job={{
                  result: selectedMissionSynth.cardResult,
                  status: selectedMissionSynth.liveStatus,
                  team: selectedMissionSynth.cardTeam,
                  tokens_total: selectedMissionSynth.cardTokens,
                  cost_usd: selectedMissionSynth.cardCost,
                  events_total: selectedMissionSynth.cardEvents,
                  delivery_warnings: selectedMissionSynth.deliveryWarnings,
                  delivery_blocked: selectedMissionSynth.deliveryBlocked,
                  created_at: detail.data.created_at as string | undefined,
                }}
                updatedByContinuation={selectedMissionSynth.hasChild}
              />
            ) : null}
            <section className="min-h-0 min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          {detail.isLoading && !detail.data ? (
            <p className="text-sm text-slate-400">Chargement du détail mission…</p>
          ) : detail.data ? (
            <div className="space-y-5">
              {detail.isError ? (
                <div
                  className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-950"
                  role="status"
                >
                  <p className="font-semibold">Rafraîchissement interrompu</p>
                  <p className="mt-1 text-xs leading-relaxed">
                    {detailRefreshError.includes("timeout") || detailRefreshError.includes("AbortError")
                      ? "La mission est volumineuse et le serveur a mis trop de temps à répondre."
                      : detailRefreshError ||
                        "Le serveur n'a pas répondu. Les données ci-dessous peuvent être légèrement obsolètes."}
                  </p>
                  <button
                    type="button"
                    onClick={() => void detail.refetch()}
                    className="mt-2 text-xs font-semibold text-amber-900 underline hover:text-amber-950"
                  >
                    Réessayer le chargement
                  </button>
                </div>
              ) : null}
              {(() => {
                const detailStatus = String(detail.data.status || "");
                const hitl = (detail.data.hitl || null) as { gate?: { kind?: string } } | null;
                const awaitingHitl = detailStatus === "awaiting_validation";
                const isCioPlanHitl = awaitingHitl && String(hitl?.gate?.kind || "") === "cio_plan" && Boolean(hitl);
                if (!awaitingHitl || cioResumeLiveId) return null;
                if (isCioPlanHitl) {
                  return <CioPlanHitlPanel jobId={String(detail.data.job_id || selected || "")} hitl={hitl} />;
                }
                return (
                  <MissionHitlResolver
                    jobId={String(detail.data.job_id || selected || "")}
                    hitl={hitl}
                  />
                );
              })()}

              {/* ── QUESTIONS CIO (non-bloquantes) — dans le flux principal si pas de rail latéral ───────── */}
              {!showDecisionRail && cioQuestions.length > 0 && !cioResumeLiveId && (
                <CioQuestionsPanel
                  questions={cioQuestions}
                  onAnswer={(a) => onAnswerCioQuestion(a)}
                  busy={cioQuestionBusy}
                />
              )}

              {/* ── PANNEAU LIVE (haut de colonne, visible immédiatement) ─────── */}
              {cioResumeLiveId ? (
                <div className="overflow-hidden rounded-2xl border-2 border-violet-400 bg-white shadow-lg">
                  {/* En-tête animé */}
                  <div className="flex flex-wrap items-center gap-2 bg-violet-600 px-4 py-2.5">
                    <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-white" />
                    <p className="text-sm font-bold text-white">Agents au travail — Tour en cours</p>
                    <span className="ml-auto rounded-full bg-violet-500 px-2 py-0.5 text-[10px] font-semibold text-violet-100">
                      ↻ 1,5 s
                    </span>
                  </div>
                  {cioResumeLive.data ? (
                    <div className="space-y-3 p-4">
                      {/* Métriques temps réel */}
                      <MissionMetricsRow
                        status={String(cioResumeLive.data.status || "")}
                        tokensTotal={Number(cioResumeLive.data.tokens_total || 0)}
                        costUsd={Number(cioResumeLive.data.cost_usd || 0)}
                        eventsTotal={Number(cioResumeLive.data.events_total || 0)}
                        logTotal={Number(cioResumeLive.data.log_total || 0)}
                      />
                      {/* Derniers événements */}
                      {((cioResumeLive.data.events || []) as Array<Record<string, unknown>>).length > 0 ? (
                        <div className="rounded-xl border border-violet-100 bg-violet-50/50 px-3 py-2">
                          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-violet-500">
                            Derniers événements agents
                          </p>
                          <ul className="space-y-1">
                            {((cioResumeLive.data.events || []) as Array<Record<string, unknown>>)
                              .slice(-6)
                              .map((ev, i) => (
                                <li key={i} className="flex min-w-0 gap-1.5 text-[11px]">
                                  <span className="shrink-0 font-semibold text-violet-700">
                                    {String(ev.actor || ev.agent || "—")}
                                  </span>
                                  <span className="text-slate-400">·</span>
                                  <span className="text-slate-600">{String(ev.type || ev.event || "")}</span>
                                  {ev.summary || ev.message ? (
                                    <span className="truncate text-slate-400">
                                      {String(ev.summary || ev.message || "").slice(0, 80)}
                                    </span>
                                  ) : null}
                                </li>
                              ))}
                          </ul>
                        </div>
                      ) : null}
                      {/* Journal en direct */}
                      {((cioResumeLive.data.logs || []) as string[]).length > 0 ? (
                        <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                            Journal en direct
                          </p>
                          <pre className="max-h-28 overflow-auto whitespace-pre-wrap text-[10px] leading-relaxed text-slate-600">
                            {((cioResumeLive.data.logs || []) as string[]).slice(-8).join("\n")}
                          </pre>
                        </div>
                      ) : (
                        <p className="text-center text-xs text-slate-400">En attente de la première réponse agents…</p>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center gap-2 p-6">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-violet-400" />
                      <p className="text-sm text-slate-500">Initialisation du tour…</p>
                    </div>
                  )}
                  {cioResumeLive.isError ? (
                    <p className="px-4 pb-3 text-xs text-red-700">
                      Impossible de suivre l&apos;état du tour en direct.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {/* ── Synthèse CIO + livrables (agrandissable plein écran) ─────── */}
              <div className={cioResumeLiveId ? "opacity-50 transition-opacity" : ""}>
                <ExpandableMissionReader
                  title="Réponse du CIO · synthèse & livrables"
                  hint={detail.data.mission?.trim() || null}
                  badge={cioSynthReaderBadge}
                >
                  <CioResultPanel
                    embedded
                    result={detail.data.result}
                    missionTitle={detail.data.mission}
                    jobLine={`#${detail.data.job_id} · ${detail.data.agent} · ${detail.data.status}`}
                  />
                  {selected && selectedMissionSynth ? (
                    <MissionDeliverablesPanel
                      embedded
                      jobId={selected}
                      resultMarkdown={selectedMissionSynth.deliverablesMarkdown}
                      team={selectedMissionSynth.deliverablesTeam}
                      deliverablesUi={detail.data.deliverables_ui}
                      missionClosed={Boolean(
                        detail.data.user_validated_at || detail.data.mission_closed_by_user,
                      )}
                      canValidateMission={canCloseMission}
                      validateBusy={busyId === selected}
                      onValidateMission={() => void onCloseMission(selected)}
                      validateLabel="Clôturer la mission (terminée pour moi)"
                      onSaved={() => void qc.invalidateQueries({ queryKey: ["job-detail-live", selected] })}
                    />
                  ) : null}
                </ExpandableMissionReader>
              </div>

              <CollapsibleMissionSection
                title="Carte d&apos;activation des agents"
                hint="État des rôles et signaux temps réel — ouvrir si besoin"
                defaultOpen={false}
              >
                {activeBoardData ? (
                  <AgentActivationBoard
                    events={activeBoardData.events}
                    jobStatus={String(activeBoardData.status || "")}
                    className={cioResumeLiveId ? "ring-2 ring-offset-0 ring-violet-300" : ""}
                  />
                ) : (
                  <p className="text-sm text-slate-500">Aucune donnée d&apos;activation pour l&apos;instant.</p>
                )}
              </CollapsibleMissionSection>

              {!cioResumeLiveId ? (
                <CollapsibleMissionSection
                  title="Métriques et coûts (mission principale)"
                  hint="Tokens, coût USD, volumétrie — utile pour le pilotage, pas pour chaque décision métier"
                  defaultOpen={false}
                >
                  <MissionMetricsRow
                    status={String(detail.data.status || "")}
                    tokensTotal={Number(detail.data.tokens_total || 0)}
                    costUsd={Number(detail.data.cost_usd || 0)}
                    eventsTotal={Number(detail.data.events_total || 0)}
                    logTotal={Number(detail.data.log_total || 0)}
                  />
                </CollapsibleMissionSection>
              ) : null}

              {!showDecisionRail && canResumeCio ? (
                <div className="rounded-2xl border border-violet-200 bg-violet-50/60 p-4 shadow-sm">
                  {!cioResumeLiveId ? (
                    <>
                      <h3 className="text-sm font-semibold text-slate-900">Poursuivre avec le CIO sur cette mission</h3>
                      <p className="mt-1 text-xs leading-relaxed text-slate-600">
                        Vous restez sur <span className="font-medium text-slate-800">la même mission</span> : la suite est
                        enregistrée dans le fil de cadrage et le livrable est mis à jour ici après exécution.
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Link
                          href={`/chat?parent=${encodeURIComponent(String(selected))}`}
                          className="text-xs font-medium text-violet-800 underline hover:text-violet-950"
                        >
                          Ouvrir dans Chat (même dossier)
                        </Link>
                      </div>
                      <div className="mt-3 flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2">
                        <div>
                          <p className="text-[11px] font-semibold text-slate-700">Questions CIO en cours de mission</p>
                          <p className="text-[10px] text-slate-400">Le CIO peut vous poser des précisions pendant l&apos;exécution</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const next = !cioQuestionsEnabled;
                            setCioQuestionsEnabled(next);
                            localStorage.setItem("cio_questions_enabled", String(next));
                          }}
                          className={`relative h-5 w-9 rounded-full transition-colors ${cioQuestionsEnabled ? "bg-violet-600" : "bg-slate-200"}`}
                        >
                          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${cioQuestionsEnabled ? "translate-x-4" : "translate-x-0.5"}`} />
                        </button>
                      </div>
                      <form onSubmit={onCioResumeSubmit} className="mt-3 space-y-3">
                        <textarea
                          value={cioResumeInput}
                          onChange={(e) => setCioResumeInput(e.target.value)}
                          disabled={cioResumeBusy}
                          rows={4}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm disabled:opacity-50"
                          placeholder="Ex. : affine la synthèse sur le volet X, ajoute une passe commercial pour…"
                        />
                        <button
                          type="submit"
                          disabled={cioResumeBusy || !cioResumeInput.trim()}
                          className="rounded-xl bg-violet-700 px-4 py-2 text-sm font-medium text-white hover:bg-violet-800 disabled:opacity-40"
                        >
                          {cioResumeBusy ? "Envoi…" : "Envoyer au CIO"}
                        </button>
                      </form>
                    </>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-violet-500" />
                      <p className="text-xs text-violet-800">
                        Tour en cours — le formulaire sera disponible à la fin du tour.
                      </p>
                    </div>
                  )}
                </div>
              ) : null}
              <CollapsibleMissionSection
                title="Évolution entre agents (événements)"
                hint="Qui a fait quoi entre agents — ouvrir pour le détail opérationnel"
                defaultOpen={false}
              >
                <MissionEventTimeline
                  events={detail.data.events}
                  title="Évolution entre agents (événements)"
                  suppressTitle
                  maxHeightClass="max-h-[min(28rem,55vh)]"
                />
              </CollapsibleMissionSection>
              <SimpleAccordion
                key={selected || "none"}
                className="rounded-2xl border border-slate-200 bg-slate-50/80 shadow-sm"
                triggerClassName="cursor-pointer rounded-2xl px-4 py-3 hover:bg-slate-100/80"
                title="Détail d&apos;exécution"
                hint="Équipe, journaux bruts et rappel volumétrique — ouvrir pour le diagnostic technique"
                defaultOpen={false}
                panelClassName="space-y-4 border-t border-slate-200 px-4 py-4"
              >
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Équipe / agents</p>
                    {normalizeTeamRows(detail.data.team).length ? (
                      <ul className="space-y-2 text-sm text-slate-700">
                        {normalizeTeamRows(detail.data.team).map((row, i) => (
                          <li key={teamRowKey(row, i)} className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
                            <span className="font-medium text-slate-800">{row.label || row.key}</span>
                            {row.status ? <span className="text-xs text-violet-700"> · {row.status}</span> : null}
                            {row.phase ? <span className="text-xs text-slate-500"> · {row.phase}</span> : null}
                            {row.detail ? <p className="mt-0.5 text-xs text-slate-600">{row.detail}</p> : null}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-slate-500">Pas de sous-agents sur cette mission.</p>
                    )}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
                      <p className="text-xs uppercase tracking-wide text-slate-400">Événements</p>
                      <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
                        {Number(detail.data.events_total || 0)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
                      <p className="text-xs uppercase tracking-wide text-slate-400">Lignes de log</p>
                      <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
                        {Number(detail.data.log_total || 0)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
                      <p className="text-xs uppercase tracking-wide text-slate-400">Tokens</p>
                      <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
                        {Number(detail.data.tokens_total || 0)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
                      <p className="text-xs uppercase tracking-wide text-slate-400">Coût (USD)</p>
                      <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
                        ${Number(detail.data.cost_usd || 0).toFixed(4)}
                      </p>
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Journal d&apos;exécution</p>
                    <pre className="max-h-72 overflow-auto whitespace-pre-wrap text-xs text-slate-700">
                      {((detail.data.logs || []) as string[]).join("\n") || "(aucune ligne de log pour l&apos;instant)"}
                    </pre>
                  </div>
              </SimpleAccordion>
            </div>
          ) : detail.isError ? (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-red-700">Impossible de charger le détail mission.</p>
              {detailRefreshError ? (
                <p className="text-xs leading-relaxed text-red-600">{detailRefreshError}</p>
              ) : null}
              {backendLikelyDown ? (
                <p className="text-xs leading-relaxed text-slate-600">
                  Le backend Korymb (port <span className="font-mono">8020</span>) ne répond pas. Dans un terminal à la
                  racine du projet :{" "}
                  <span className="font-mono text-[11px]">.\start-dev-cursor.ps1 -MariaDbTunnel</span>
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => void detail.refetch()}
                className="text-xs font-semibold text-violet-800 underline hover:text-violet-950"
              >
                Réessayer
              </button>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Sélectionnez une mission dans la liste.</p>
          )}
        </section>
          </div>
        </div>
      </div>
      )}
    </PageShell>
  );
}

export default function MissionsPage() {
  return (
    <Suspense fallback={<div className="space-y-6 p-6 text-slate-500">Chargement missions…</div>}>
      <MissionsContent />
    </Suspense>
  );
}
