"use client";

import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import AgentMessageMarkdown from "../../components/AgentMessageMarkdown";
import AgentActivationBoard from "../../components/AgentActivationBoard";
import AgentMindMap from "../../components/AgentMindMap";
import CioResultPanel from "../../components/CioResultPanel";
import MissionDecisionCard from "../../components/MissionDecisionCard";
import CollapsibleMissionSection from "../../components/CollapsibleMissionSection";
import SimpleAccordion from "../../components/SimpleAccordion";
import MissionEventTimeline from "../../components/MissionEventTimeline";
import MissionMetricsRow from "../../components/MissionMetricsRow";
import MissionStatusBadge from "../../components/MissionStatusBadge";
import SessionCadrageTimeline from "../../components/SessionCadrageTimeline";
import { sortJobsForBossView } from "../../lib/missionBossView";
import { normalizeTeamRows, teamRowKey } from "../../lib/jobTeam";
import { agentHeaders, requestFallbackJson, requestJson } from "../../lib/api";
import { QK } from "../../lib/queryClient";

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
  const searchParams = useSearchParams();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [cioResumeInput, setCioResumeInput] = useState("");
  const [cioResumeBusy, setCioResumeBusy] = useState(false);
  const [cioResumeLiveId, setCioResumeLiveId] = useState<string | null>(null);
  const jobs = useQuery({
    queryKey: QK.jobs,
    queryFn: async () => (await requestJson("/jobs", { headers: agentHeaders(), retries: 1 })).data.jobs || [],
    refetchInterval: () => (typeof document !== "undefined" && document.visibilityState === "visible" ? 3000 : false),
  });

  const rows = useMemo(() => (jobs.data || []) as Job[], [jobs.data]);
  const sortedRows = useMemo(() => sortJobsForBossView(rows), [rows]);
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
  }, [selected]);

  const cioResumeLiveDone = useMemo(() => {
    if (!cioResumeLive.data || !cioResumeLiveId) return false;
    const st = String(cioResumeLive.data.status || "");
    return st === "completed" || st.startsWith("error");
  }, [cioResumeLive.data, cioResumeLiveId]);

  useEffect(() => {
    if (!cioResumeLiveDone || !cioResumeLiveId) return;
    setCioResumeLiveId(null);
    void qc.invalidateQueries({ queryKey: ["job-detail-live", selected] });
    void qc.invalidateQueries({ queryKey: QK.jobs });
    void qc.invalidateQueries({ queryKey: QK.tokens });
  }, [cioResumeLiveDone, cioResumeLiveId, qc, selected]);

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
        }),
      });
      setCioResumeInput("");
      if (data?.status === "accepted" && data?.job_id) {
        setCioResumeLiveId(String(data.job_id));
        setFeedback(
          "Suite CIO en cours sur cette mission : le livrable et le fil de cadrage ci-dessus se mettront à jour à la fin du tour.",
        );
      } else {
        setError("Réponse chat inattendue (pas de job_id).");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCioResumeBusy(false);
    }
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
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Missions</h1>
        <p className="text-sm text-slate-500 mt-1 max-w-3xl leading-relaxed">
          Vue pilotage : à droite, la <span className="font-medium text-slate-700">synthèse & livrable</span> du CIO
          d&apos;abord, puis le détail par rôle (repliable), le fil de cadrage et les événements. Les missions à valider et
          en cours remontent en premier dans la liste.
        </p>
      </div>
      <div className="grid w-full min-w-0 max-w-full gap-4 lg:grid-cols-[minmax(280px,1fr)_minmax(0,1.15fr)]">
        <div className="min-w-0 space-y-3">
        {error ? <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p> : null}
        {feedback ? (
          <p className="break-words text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
            {feedback}
          </p>
        ) : null}
        {selected && detail.data ? (
          <AgentActivationBoard
            events={detail.data.events}
            jobStatus={String(detail.data.status || "")}
          />
        ) : null}
        {sortedRows.map((j) => {
          const closed = j.user_validated_at || j.mission_closed_by_user;
          const canValidate = j.status === "completed" && !closed;
          const resultPreview = String(j.result || "").trim();
          return (
            <div
              key={j.job_id}
              className={`min-w-0 bg-white border rounded-2xl p-4 cursor-pointer transition-shadow ${
                selected === j.job_id ? "border-violet-500 shadow-md ring-1 ring-violet-100" : "border-slate-200 hover:border-slate-300"
              }`}
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
                  {selected === j.job_id && detail.data ? (
                    <MissionDecisionCard
                      job={{
                        result: detail.data.result,
                        status: detail.data.status,
                        team: detail.data.team,
                        tokens_total: Number(detail.data.tokens_total ?? 0),
                        cost_usd: Number(detail.data.cost_usd ?? 0),
                        events_total: Number(detail.data.events_total ?? 0),
                        delivery_warnings: (detail.data.delivery_warnings as string[] | undefined) ?? [],
                        delivery_blocked: Boolean(detail.data.delivery_blocked),
                        created_at: detail.data.created_at as string | undefined,
                      }}
                    />
                  ) : resultPreview ? (
                    <div className="max-h-32 min-h-0 overflow-y-auto rounded-lg border border-slate-100 bg-white p-2 text-left">
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Aperçu livrable</p>
                      <AgentMessageMarkdown
                        source={resultPreview.length > 8000 ? `${resultPreview.slice(0, 8000)}\n\n…` : resultPreview}
                        className="text-[11px] [&_h1]:mb-1 [&_h1]:text-[11px] [&_h2]:mb-1 [&_h2]:text-[11px] [&_h3]:text-[11px] [&_li]:text-[10px] [&_p]:mb-1 [&_p]:text-[11px] [&_ul]:my-1"
                      />
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400">Pas encore de synthèse textuelle.</p>
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
        {rows.length === 0 ? <p className="text-sm text-slate-400">Aucune mission.</p> : null}
        </div>
        <section className="min-h-[280px] min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          {!selected ? (
            <div className="space-y-4">
              <AgentMindMap />
              <p className="text-xs text-slate-400 leading-relaxed">
                Sélectionne une mission à gauche pour voir la{" "}
                <span className="font-medium text-slate-600">synthèse & livrable</span> du CIO, le détail par rôle et les événements.
              </p>
            </div>
          ) : detail.isLoading ? (
            <p className="text-sm text-slate-400">Chargement du détail mission…</p>
          ) : detail.isError ? (
            <p className="text-sm text-red-700">Impossible de charger le détail mission.</p>
          ) : detail.data ? (
            <div className="space-y-5">
              <CioResultPanel
                result={detail.data.result}
                missionTitle={detail.data.mission}
                jobLine={`#${detail.data.job_id} · ${detail.data.agent} · ${detail.data.status}`}
              />
              <MissionMetricsRow
                status={detail.data.status}
                tokensTotal={Number(detail.data.tokens_total || 0)}
                costUsd={Number(detail.data.cost_usd || 0)}
                eventsTotal={Number(detail.data.events_total || 0)}
                logTotal={Number(detail.data.log_total || 0)}
              />
              <SessionCadrageTimeline
                messages={detail.data.mission_thread}
                title="Fil de cadrage avec le CIO (contexte)"
                maxHeightClass="max-h-[min(24rem,48vh)]"
              />
              {canResumeCio ? (
                <div className="rounded-2xl border border-violet-200 bg-violet-50/60 p-4 shadow-sm">
                  <h3 className="text-sm font-semibold text-slate-900">Poursuivre avec le CIO sur cette mission</h3>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600">
                    Vous restez sur <span className="font-medium text-slate-800">la même mission</span> : la suite est
                    enregistrée dans le fil de cadrage et le livrable est mis à jour ici après exécution. Aucune nouvelle
                    mission n&apos;apparaît dans la liste (pas d&apos;historique « mission » parallèle).
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Link
                      href={`/chat?parent=${encodeURIComponent(String(selected))}`}
                      className="text-xs font-medium text-violet-800 underline hover:text-violet-950"
                    >
                      Ouvrir dans Chat (même dossier)
                    </Link>
                  </div>
                  <form onSubmit={onCioResumeSubmit} className="mt-4 space-y-3">
                    <textarea
                      value={cioResumeInput}
                      onChange={(e) => setCioResumeInput(e.target.value)}
                      disabled={cioResumeBusy || Boolean(cioResumeLiveId)}
                      rows={4}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm disabled:opacity-50"
                      placeholder="Ex. : affine la synthèse sur le volet X, ajoute une passe commercial pour…"
                    />
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="submit"
                        disabled={cioResumeBusy || Boolean(cioResumeLiveId) || !cioResumeInput.trim()}
                        className="rounded-xl bg-violet-700 px-4 py-2 text-sm font-medium text-white hover:bg-violet-800 disabled:opacity-40"
                      >
                        {cioResumeBusy ? "Envoi…" : cioResumeLiveId ? "Orchestration en cours…" : "Envoyer au CIO"}
                      </button>
                    </div>
                  </form>
                  {cioResumeLiveId ? (
                    <p className="mt-4 rounded-xl border border-violet-100 bg-white px-3 py-2 text-xs leading-relaxed text-slate-600">
                      Orchestration du CIO en cours sur ce dossier… Les messages et le livrable ci-dessus se rafraîchissent
                      automatiquement à la fin du tour.
                      {cioResumeLive.isError ? (
                        <span className="mt-1 block text-red-700">Impossible de suivre l&apos;état du tour en direct.</span>
                      ) : null}
                    </p>
                  ) : null}
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
                hint="Équipe, journaux et volumétrie (les métriques sont déjà visibles au-dessus)"
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
  );
}

export default function MissionsPage() {
  return (
    <Suspense fallback={<div className="space-y-6 p-6 text-slate-500">Chargement missions…</div>}>
      <MissionsContent />
    </Suspense>
  );
}
