"use client";

import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import AgentMessageMarkdown from "../../components/AgentMessageMarkdown";
import AgentActivationBoard from "../../components/AgentActivationBoard";
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
import CioPlanHitlPanel from "../../components/CioPlanHitlPanel";
import { sortJobsForBossView } from "../../lib/missionBossView";
import { normalizeTeamRows, teamRowKey } from "../../lib/jobTeam";
import { bestPreview } from "../../lib/missionBilan";
import { agentHeaders, requestFallbackJson, requestJson } from "../../lib/api";
import { QK } from "../../lib/queryClient";
import { deliverablesMarkdownFromBossContext } from "../../lib/missionDeliverablesMarkdown";

import type { Job } from "../../lib/types";

async function validateJob(jobId: string) {
  const headers = agentHeaders();
  return requestFallbackJson([
    () => requestJson(`/jobs/${encodeURIComponent(jobId)}/validate-mission`, { method: "POST", headers, expectOk: false }),
    () => requestJson("/run/validate-mission", { method: "POST", headers, body: JSON.stringify({ job_id: jobId }), expectOk: false }),
    () => requestJson("/jobs/validate-mission", { method: "POST", headers, body: JSON.stringify({ job_id: jobId }), expectOk: false }),
    () => requestJson("/run", {
      method: "POST",
      headers,
      body: JSON.stringify({ mission: "", agent: "coordinateur", user_validate_job_id: jobId }),
      expectOk: false,
    }),
  ], "Validation mission");
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
  // Toggle global : le CIO peut-il poser des questions en cours de mission ?
  const [cioQuestionsEnabled, setCioQuestionsEnabled] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("cio_questions_enabled") !== "false";
  });
  const jobs = useQuery({
    queryKey: QK.jobs,
    queryFn: async () => (await requestJson("/jobs", { headers: agentHeaders(), retries: 1 })).data.jobs || [],
    refetchInterval: () => (typeof document !== "undefined" && document.visibilityState === "visible" ? 3000 : false),
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

  const detail = useQuery({
    queryKey: ["job-detail-live", selected],
    enabled: Boolean(selected),
    queryFn: async () =>
      (
        await requestJson(`/jobs/${encodeURIComponent(String(selected))}?log_offset=0&events_offset=0`, {
          headers: agentHeaders(),
          retries: 1,
        })
      ).data,
    refetchInterval: () => {
      if (!selected || typeof document === "undefined" || document.visibilityState !== "visible") return false;
      return cioResumeLiveId ? 1000 : 1500;
    },
  });

  const cioResumeLive = useQuery({
    queryKey: ["mission-cio-resume-live", cioResumeLiveId],
    enabled: Boolean(cioResumeLiveId),
    queryFn: async () =>
      (
        await requestJson(`/jobs/${encodeURIComponent(String(cioResumeLiveId))}?log_offset=0&events_offset=0`, {
          headers: agentHeaders(),
          retries: 1,
        })
      ).data,
    refetchInterval: () =>
      cioResumeLiveId && typeof document !== "undefined" && document.visibilityState === "visible" ? 1500 : false,
  });

  const canResumeCio = Boolean(
    selected &&
      detail.data &&
      String(detail.data.status || "") !== "running" &&
      (String(detail.data.status || "") === "completed" || String(detail.data.status || "").startsWith("error")),
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
      .map((ev) => ({
        questions: (ev.data as Record<string, unknown>)?.questions as string[] ?? [],
        answered: Boolean((ev.data as Record<string, unknown>)?.answered),
        missionPreview: String((ev.data as Record<string, unknown>)?.mission_preview || ""),
      }))
      .filter((q) => q.questions.length > 0);
  }, [detail.data?.events]);

  const pendingCioQuestionCount = useMemo(
    () =>
      cioQuestions.filter((q) => !q.answered).reduce((n, q) => n + (q.questions?.length || 0), 0),
    [cioQuestions],
  );
  const hasPendingCioQuestions = pendingCioQuestionCount > 0;

  /** Actions CIO / questions (carte violette sous le fil dans la colonne gauche). */
  const showDecisionRail = Boolean(
    (cioQuestions.length > 0 && !cioResumeLiveId) || canResumeCio,
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
    void qc.invalidateQueries({ queryKey: QK.jobs });
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
      qc.invalidateQueries({ queryKey: QK.jobs });
      qc.invalidateQueries({ queryKey: QK.tokens });
      qc.invalidateQueries({ queryKey: ["job-detail-live", jobId] });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Missions</h1>
        <p className="text-sm text-slate-500 mt-1 max-w-none leading-relaxed">
          {selected ? (
            <>
              Fil et actions avec le CIO à gauche (grand écran) ; synthèse, livrables et validation à droite.{" "}
              <span className="font-medium text-slate-700">Retour à la liste</span> pour changer de mission.
            </>
          ) : (
            <>
              Choisissez une mission dans la liste : la vue se concentre ensuite sur cette mission seule. Les missions à
              valider et en cours remontent en premier.
            </>
          )}
        </p>
      </div>
      {!selected ? (
      <div className="grid w-full min-w-0 max-w-full gap-4 lg:grid-cols-[minmax(320px,1fr)_minmax(320px,1fr)]">
        <div className="min-w-0 space-y-3">
        {error ? <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p> : null}
        {feedback ? (
          <p className="break-words text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
            {feedback}
          </p>
        ) : null}
        {sortedRows.map((j) => {
          const closed = j.user_validated_at || j.mission_closed_by_user;
          const canValidate = j.status === "completed" && !closed;
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
                    className="w-full shrink-0 bg-violet-900 text-white text-xs px-3 py-1.5 rounded-lg disabled:opacity-40 sm:w-auto"
                  >
                    {busyId === j.job_id ? "Validation…" : "Valider"}
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
        {missionRows.length === 0 ? <p className="text-sm text-slate-400">Aucune mission.</p> : null}
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
      <div className="w-full min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 pb-4">
          <button
            type="button"
            onClick={clearMissionSelection}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
          >
            ← Retour à la liste
          </button>
          {detail.data?.mission?.trim() ? (
            <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700">{detail.data.mission.trim()}</p>
          ) : (
            <p className="text-xs font-mono text-slate-500">#{selected}</p>
          )}
        </div>
        {error ? <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p> : null}
        {feedback ? (
          <p className="break-words text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
            {feedback}
          </p>
        ) : null}

        <div
          className={
            showConversationSidebar
              ? "lg:grid lg:grid-cols-[minmax(340px,1fr)_minmax(340px,1fr)] lg:items-start lg:gap-6 xl:gap-8"
              : ""
          }
        >
          {showConversationSidebar && detail.data ? (
            <aside className="order-first mb-6 flex min-h-0 flex-col gap-3 lg:sticky lg:top-4 lg:order-none lg:mb-0 lg:h-[calc(100vh-5.75rem)] lg:max-h-[calc(100vh-5.75rem)] lg:self-start lg:pr-0.5">
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <SessionCadrageTimeline
                  fillColumn
                  messages={detail.data.mission_thread}
                  title="Fil de cadrage avec le CIO"
                  className="shadow-sm"
                />
              </div>
              {showDecisionRail ? (
                <div className="shrink-0 rounded-2xl border border-violet-200 bg-white shadow-[0_-6px_28px_-6px_rgba(99,102,241,0.18)] ring-1 ring-violet-100/90">
                  {canResumeCio ? (
                    !cioResumeLiveId ? (
                      <form onSubmit={onCioResumeSubmit} className="space-y-2 border-b border-violet-100/80 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <label htmlFor="cio-resume-mission" className="text-xs font-semibold text-slate-900">
                            Consigne pour la suite
                          </label>
                          <Link
                            href={`/chat?parent=${encodeURIComponent(String(selected))}`}
                            className="shrink-0 rounded-lg bg-violet-50 px-2 py-1 text-[10px] font-semibold text-violet-800 hover:bg-violet-100"
                          >
                            Chat
                          </Link>
                        </div>
                        <textarea
                          id="cio-resume-mission"
                          value={cioResumeInput}
                          onChange={(e) => setCioResumeInput(e.target.value)}
                          disabled={cioResumeBusy}
                          rows={3}
                          className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-sm leading-snug text-slate-900 outline-none ring-violet-200 focus:border-violet-400 focus:ring-1 disabled:opacity-50"
                          placeholder="Ex. : affine la synthèse, ajoute une passe commercial…"
                        />
                        <button
                          type="submit"
                          disabled={cioResumeBusy || !cioResumeInput.trim()}
                          className="w-full rounded-xl bg-violet-700 px-3 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-violet-800 disabled:opacity-40"
                        >
                          {cioResumeBusy ? "Envoi…" : "Envoyer au CIO"}
                        </button>
                      </form>
                    ) : (
                      <div className="flex items-center gap-2 border-b border-violet-100/80 p-3">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-violet-500" />
                        <p className="text-xs text-violet-800">
                          Tour en cours — le formulaire revient à la fin du tour.
                        </p>
                      </div>
                    )
                  ) : null}
                  <SimpleAccordion
                    key={`cio-dock-more-${selected}`}
                    title={
                      hasPendingCioQuestions
                        ? `Précisions CIO (${pendingCioQuestionCount})`
                        : "Précisions, questions & options"
                    }
                    hint="Déplier pour questions pendant mission, réglages et rappels"
                    defaultOpen={hasPendingCioQuestions || !canResumeCio}
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

          <div className="min-w-0 space-y-4">
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
            <section className="min-h-[280px] min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          {detail.isLoading ? (
            <p className="text-sm text-slate-400">Chargement du détail mission…</p>
          ) : detail.isError ? (
            <p className="text-sm text-red-700">Impossible de charger le détail mission.</p>
          ) : detail.data ? (
            <div className="space-y-5">
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
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
                    <p className="text-sm font-semibold text-amber-900">Validation requise (HITL)</p>
                    <p className="mt-1 text-xs leading-relaxed text-amber-800">
                      Cette mission attend une décision humaine avant de poursuivre. Ouvrez la file d&apos;approbation
                      pour valider ou rejeter l&apos;élément en attente.
                    </p>
                    <div className="mt-3">
                      <Link
                        href="/administration/approbations"
                        className="inline-flex items-center rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
                      >
                        Ouvrir la file d&apos;approbation
                      </Link>
                    </div>
                  </div>
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

              {/* ── Livrable CIO (atténué pendant la continuation) ──────────── */}
              <div className={cioResumeLiveId ? "opacity-50 transition-opacity" : ""}>
                <CioResultPanel
                  result={detail.data.result}
                  missionTitle={detail.data.mission}
                  jobLine={`#${detail.data.job_id} · ${detail.data.agent} · ${detail.data.status}`}
                />
              </div>

              {selected && detail.data && selectedMissionSynth ? (
                <MissionDeliverablesPanel
                  jobId={selected}
                  resultMarkdown={selectedMissionSynth.deliverablesMarkdown}
                  team={selectedMissionSynth.deliverablesTeam}
                  deliverablesUi={detail.data.deliverables_ui}
                  missionClosed={Boolean(detail.data.user_validated_at || detail.data.mission_closed_by_user)}
                  canValidateMission={
                    String(detail.data.status || "") === "completed" &&
                    !(detail.data.user_validated_at || detail.data.mission_closed_by_user)
                  }
                  validateBusy={busyId === selected}
                  onValidateMission={() => void onValidate(selected)}
                  onSaved={() => void qc.invalidateQueries({ queryKey: ["job-detail-live", selected] })}
                  className={cioResumeLiveId ? "opacity-50 transition-opacity" : ""}
                />
              ) : null}

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
          ) : null}
        </section>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}

export default function MissionsPage() {
  return (
    <Suspense fallback={<div className="space-y-6 p-6 text-slate-500">Chargement missions…</div>}>
      <MissionsContent />
    </Suspense>
  );
}
