"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import CioArbitrageFreeField from "../CioArbitrageFreeField";
import CioArbitrageQuestionRow from "../CioArbitrageQuestionRow";
import CioPlanHitlPanel from "../CioPlanHitlPanel";
import MissionHitlResolver from "../missions/MissionHitlResolver";
import PlanDiffPanel from "../PlanDiffPanel";
import { agentHeaders, requestJson } from "../../lib/api";
import { CIO_FREE_CONSIGNE_QUESTION, collectCioArbitrageAnswers } from "../../lib/cioArbitrageAnswers";
import {
  useCioAnswerAndResume,
  useHitlResolve,
  useActionResolve,
  useInboxDismiss,
  useLearningResolve,
  useQualityOverride,
  useSchedulerApprove,
  useSchedulerReject,
  useCloseMission,
  useValidateMission,
} from "../../lib/missionActions";
import InboxMetaStrip from "./InboxMetaStrip";

export type InboxActionItem = {
  kind: string;
  job_id?: string;
  output_id?: string;
  suggestion_id?: string;
  ticket_id?: string;
  title?: string;
  mission?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
  job_created_at?: string;
  days_open?: number;
  days_overdue?: number;
  sla_days?: number;
  urgency?: "ok" | "warning" | "critical";
  progress_label?: string;
  priority_score?: number;
  priority_rank?: number;
  questions?: string[];
  hitl_kind?: string;
  action_kind?: string;
  summary?: string;
  preview_url?: string;
  payload?: {
    to?: string;
    subject?: string;
    body?: string;
    tool?: string;
    summary?: string;
    start_at?: string;
    end_at?: string;
    caption?: string;
    content?: string;
    platform?: string;
  };
  gate_preview?: { synthese_attendue?: string; agents?: string[]; sous_taches_count?: number };
  proposal_meta?: {
    why_now?: string;
    estimated_cost_usd?: number;
    launch_mode?: string;
    risk_flags?: string[];
    proposed_by_agent?: string;
    source_kind?: string;
    source_job_id?: string;
    source_label?: string;
  };
  learnings?: string[];
};

type Props = {
  item: InboxActionItem;
  defaultExpanded?: boolean;
  onDismissed?: () => void;
};

export default function InboxActionCard({ item, defaultExpanded = false, onDismissed }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded || item.kind === "action_ticket");
  const [hidden, setHidden] = useState(false);
  const jobId = item.job_id || "";

  const jobAnswersQuery = useQuery({
    queryKey: ["inbox-cio-answers", jobId],
    enabled: expanded && item.kind === "cio_question" && Boolean(jobId),
    queryFn: async () => (await requestJson(`/jobs/${encodeURIComponent(jobId)}`, { headers: agentHeaders() })).data,
  });

  const questionAnswers = useMemo(
    () =>
      collectCioArbitrageAnswers(
        (jobAnswersQuery.data?.events || []) as Array<Record<string, unknown>>,
        (jobAnswersQuery.data?.mission_thread || []) as Array<{ content?: string; source?: string }>,
      ),
    [jobAnswersQuery.data?.events, jobAnswersQuery.data?.mission_thread],
  );

  const hitlQuery = useQuery({
    queryKey: ["inbox-hitl", jobId],
    enabled: expanded && item.kind === "hitl" && Boolean(jobId),
    queryFn: async () => (await requestJson(`/jobs/${encodeURIComponent(jobId)}/hitl`, { headers: agentHeaders() })).data,
  });

  const [cioResumeJobId, setCioResumeJobId] = useState<string | null>(null);

  const hitlResolve = useHitlResolve(jobId);
  const actionResolve = useActionResolve();
  const cioAnswerMut = useCioAnswerAndResume(jobId, {
    onSuccess: (resumeJobId) => {
      setCioResumeJobId(resumeJobId);
      void jobAnswersQuery.refetch();
    },
  });
  const hideFromInbox = () => {
    setHidden(true);
    onDismissed?.();
  };
  const validateMut = useValidateMission(jobId, hideFromInbox);
  const closeMut = useCloseMission(jobId, hideFromInbox);
  const schedApprove = useSchedulerApprove();
  const schedReject = useSchedulerReject();
  const learningMut = useLearningResolve();
  const qualityMut = useQualityOverride(jobId);
  const dismissMut = useInboxDismiss(hideFromInbox);

  const busy =
    hitlResolve.isPending ||
    actionResolve.isPending ||
    cioAnswerMut.isPending ||
    validateMut.isPending ||
    closeMut.isPending ||
    schedApprove.isPending ||
    schedReject.isPending ||
    learningMut.isPending ||
    qualityMut.isPending ||
    dismissMut.isPending;

  const onCioSubmit = async (question: string, answer: string) => {
    if (!answer.trim()) return;
    await cioAnswerMut.mutateAsync({ answer: answer.trim(), question });
  };

  const [rejectReason, setRejectReason] = useState("");

  const kindLabel: Record<string, string> = {
    hitl: "HITL",
    action_ticket: "Envoi",
    cio_question: "Question CIO",
    closure: "Clôture",
    mission_error: "Échec",
    scheduler_output: "Approbation",
    learning_suggestion: "Apprentissage",
    quality: "Qualité",
  };

  const kindBadgeClass: Record<string, string> = {
    hitl: "kind-badge kind-badge--hitl",
    action_ticket: "kind-badge kind-badge--action_ticket",
    cio_question: "kind-badge kind-badge--cio_question",
    closure: "kind-badge kind-badge--closure",
    mission_error: "kind-badge kind-badge--quality",
    scheduler_output: "kind-badge kind-badge--scheduler_output",
    learning_suggestion: "kind-badge kind-badge--learning_suggestion",
    quality: "kind-badge kind-badge--quality",
  };

  const cioQuestions =
    item.kind === "cio_question" ? (item.questions || []).map((q) => String(q).trim()).filter(Boolean) : [];
  const missionContext =
    item.mission ||
    (item.kind === "cio_question" &&
    cioQuestions.length > 0 &&
    item.title &&
    !cioQuestions.includes(item.title)
      ? item.title
      : undefined);

  if (hidden) return null;

  const markClosureDone = () => {
    if (item.kind === "closure" && jobId) {
      validateMut.mutate();
      return;
    }
    if (item.kind === "mission_error" && jobId) {
      closeMut.mutate();
      return;
    }
    void dismissMut.mutateAsync({
      kind: item.kind,
      job_id: item.job_id,
      output_id: item.output_id,
      suggestion_id: item.suggestion_id,
      ticket_id: item.ticket_id,
    });
  };

  const onDismiss = markClosureDone;
  const isClosureKind = item.kind === "closure" || item.kind === "mission_error";
  const doneLabel =
    item.kind === "mission_error"
      ? closeMut.isPending
        ? "Clôture…"
        : "Marquer comme terminé"
      : validateMut.isPending
        ? "Validation…"
        : "Marquer comme terminé";

  return (
    <li className="action-card relative list-none">
      <button
        type="button"
        onClick={onDismiss}
        disabled={busy}
        className="absolute right-3 top-3 z-10 touch-target flex items-center justify-center rounded-full border border-slate-200 bg-white text-lg leading-none text-slate-500 shadow-sm hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
        aria-label={isClosureKind ? "Marquer comme terminé" : "Supprimer cette décision"}
        title={isClosureKind ? "Marquer comme terminé — ne plus afficher" : "Supprimer — ne plus afficher"}
      >
        ×
      </button>
      <div className="flex flex-col gap-3 pr-10 sm:flex-row sm:items-start sm:justify-between sm:pr-12">
        <div className="min-w-0 flex-1">
          <span className={kindBadgeClass[item.kind] || "kind-badge kind-badge--default"}>
            {kindLabel[item.kind] || item.kind}
          </span>
          <InboxMetaStrip item={item} />
          {item.kind === "cio_question" && cioQuestions.length > 0 ? (
            <p className="mt-2 text-xs font-bold uppercase tracking-wide text-amber-700">Le CIO vous demande</p>
          ) : null}
          {cioQuestions.length > 0 ? (
            <ul className="mt-1 space-y-1.5">
              {cioQuestions.map((q, i) => (
                <li key={i} className="action-card-title">
                  {cioQuestions.length > 1 ? (
                    <span className="mr-1 text-amber-700">{i + 1}.</span>
                  ) : null}
                  {q}
                </li>
              ))}
            </ul>
          ) : item.kind === "cio_question" ? (
            <p className="action-card-title mt-1">{item.title || "—"}</p>
          ) : (
            <p className="action-card-title mt-2">{item.title || "—"}</p>
          )}
          {item.kind === "cio_question" && missionContext && cioQuestions.length > 0 ? (
            <p className="mt-2 text-xs font-medium text-slate-500 line-clamp-2">Mission : {missionContext}</p>
          ) : null}
          {item.gate_preview?.synthese_attendue ? (
            <p className="mt-2 text-sm font-semibold text-slate-700 line-clamp-3">{item.gate_preview.synthese_attendue}</p>
          ) : null}
          {item.proposal_meta?.proposed_by_agent ? (
            <p className="mt-2 text-[10px] font-bold uppercase tracking-wide text-violet-700">
              Agent : {item.proposal_meta.proposed_by_agent}
            </p>
          ) : null}
          {item.proposal_meta?.why_now ? (
            <p className="mt-2 text-sm font-bold text-violet-800">{item.proposal_meta.why_now}</p>
          ) : null}
          {item.proposal_meta?.source_label ? (
            <p className="mt-1 text-xs text-slate-600">
              Suite à : {item.proposal_meta.source_label}
              {item.proposal_meta.source_job_id ? (
                <>
                  {" "}
                  <Link
                    href={`/missions?job=${encodeURIComponent(item.proposal_meta.source_job_id)}`}
                    className="font-semibold text-violet-800 underline"
                  >
                    #{item.proposal_meta.source_job_id}
                  </Link>
                </>
              ) : null}
            </p>
          ) : null}
          {item.proposal_meta?.estimated_cost_usd != null ? (
            <p className="mt-1 text-sm font-bold text-amber-800">
              Coût estimé ~ ${item.proposal_meta.estimated_cost_usd.toFixed(3)}
            </p>
          ) : null}
        </div>
        <div className="flex w-full shrink-0 flex-row flex-wrap gap-2 sm:w-auto sm:flex-col">
          {isClosureKind && jobId ? (
            <button
              type="button"
              disabled={busy}
              onClick={markClosureDone}
              className="btn-success flex-1 px-4 text-sm sm:flex-none"
              title="Clôturer la mission et la retirer de l'inbox"
            >
              {doneLabel}
            </button>
          ) : null}
          <button type="button" onClick={() => setExpanded((v) => !v)} className="btn-primary flex-1 px-4 text-sm sm:flex-none">
            {expanded ? "Réduire" : "Agir"}
          </button>
          {jobId ? (
            <Link href={`/missions?job=${encodeURIComponent(jobId)}`} className="btn-link-secondary flex-1 text-center sm:flex-none">
              Mission
            </Link>
          ) : null}
          {!isClosureKind ? (
            <button
              type="button"
              onClick={onDismiss}
              disabled={busy}
              className="touch-target flex-1 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-600 hover:border-red-200 hover:bg-red-50 hover:text-red-800 disabled:opacity-50 sm:flex-none"
              title="Retirer cette décision de votre briefing et inbox"
            >
              {dismissMut.isPending ? "Suppression…" : "Supprimer"}
            </button>
          ) : null}
        </div>
      </div>

      {expanded ? (
        <div className="mt-4 border-t-2 border-violet-100 pt-4">
          {item.kind === "action_ticket" && item.ticket_id ? (
            <div className="space-y-3">
              {item.payload?.to ? (
                <p className="text-sm text-slate-700">
                  <span className="font-semibold">À :</span> {item.payload.to}
                </p>
              ) : null}
              {item.payload?.subject ? (
                <p className="text-sm text-slate-700">
                  <span className="font-semibold">Objet :</span> {item.payload.subject}
                </p>
              ) : null}
              {item.payload?.start_at ? (
                <p className="text-sm text-slate-700">
                  <span className="font-semibold">Créneau :</span> {item.payload.start_at}
                  {item.payload.end_at ? ` → ${item.payload.end_at}` : ""}
                </p>
              ) : null}
              {item.payload?.platform ? (
                <p className="text-sm text-slate-700">
                  <span className="font-semibold">Plateforme :</span> {item.payload.platform}
                </p>
              ) : null}
              {item.preview_url ? (
                <p className="text-sm text-slate-700">
                  <span className="font-semibold">Aperçu :</span>{" "}
                  <a href={item.preview_url} target="_blank" rel="noreferrer" className="text-violet-800 underline">
                    {item.preview_url}
                  </a>
                </p>
              ) : null}
              {item.payload?.body || item.payload?.caption || item.payload?.content ? (
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800">
                  {item.payload.body || item.payload.caption || item.payload.content}
                </pre>
              ) : item.summary ? (
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800">
                  {item.summary}
                </pre>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    actionResolve.mutate(
                      { ticketId: item.ticket_id!, decision: "approve" },
                      { onSuccess: () => setHidden(true) },
                    )
                  }
                  className="btn-success"
                >
                  {actionResolve.isPending
                    ? "Exécution…"
                    : item.action_kind === "calendar"
                      ? "Valider et créer"
                      : item.action_kind === "wordpress" || item.action_kind === "social"
                        ? "Valider et publier"
                        : "Valider et envoyer"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    actionResolve.mutate(
                      { ticketId: item.ticket_id!, decision: "reject" },
                      { onSuccess: () => setHidden(true) },
                    )
                  }
                  className="btn-danger"
                >
                  Rejeter
                </button>
              </div>
            </div>
          ) : null}

          {item.kind === "hitl" && jobId ? (
            <div className="space-y-3">
              {item.hitl_kind === "cio_plan" && hitlQuery.data ? (
                <>
                  <PlanDiffPanel jobId={jobId} compact />
                  <CioPlanHitlPanel jobId={jobId} hitl={hitlQuery.data?.hitl ?? hitlQuery.data} />
                </>
              ) : hitlQuery.data ? (
                <MissionHitlResolver jobId={jobId} hitl={hitlQuery.data} />
              ) : hitlQuery.isLoading ? (
                <p className="text-xs text-slate-500">Chargement HITL…</p>
              ) : null}
            </div>
          ) : null}

          {item.kind === "cio_question" && jobId ? (
            <div className="space-y-3">
              {cioQuestions.length > 0 ? (
                <ol className="space-y-2.5">
                  {cioQuestions.map((q, i) => (
                    <CioArbitrageQuestionRow
                      key={`${i}-${q.slice(0, 40)}`}
                      index={i}
                      question={q}
                      savedAnswer={questionAnswers[q.trim()]}
                      busy={cioAnswerMut.isPending}
                      onSubmit={(answer) => onCioSubmit(q, answer)}
                    />
                  ))}
                </ol>
              ) : null}
              <CioArbitrageFreeField
                savedAnswer={questionAnswers[CIO_FREE_CONSIGNE_QUESTION]}
                busy={cioAnswerMut.isPending}
                onSubmit={(answer) => onCioSubmit(CIO_FREE_CONSIGNE_QUESTION, answer)}
              />
              {cioResumeJobId ? (
                <p className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-900">
                  <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-violet-500 align-middle" />
                  Mission relancée avec votre arbitrage.
                </p>
              ) : null}
              <Link href={`/missions?job=${encodeURIComponent(jobId)}`} className="btn-link-primary text-sm">
                Voir dans le fil de la mission →
              </Link>
            </div>
          ) : null}

          {item.kind === "closure" && jobId ? (
            <div className="space-y-2">
              <p className="text-sm text-slate-600">
                La mission est terminée côté agents. Marquez-la comme terminée pour la retirer de l’inbox.
              </p>
              <button type="button" disabled={busy} onClick={markClosureDone} className="btn-success">
                {doneLabel}
              </button>
            </div>
          ) : null}

          {item.kind === "mission_error" && jobId ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={markClosureDone}
                className="btn-success"
                title="Clôturer cette mission en échec (archivage dirigeant)"
              >
                {doneLabel}
              </button>
              <Link href={`/missions?job=${encodeURIComponent(jobId)}`} className="btn-link-primary text-sm">
                Voir la mission →
              </Link>
            </div>
          ) : null}

          {item.kind === "quality" && jobId ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => qualityMut.mutate("Override dirigeant depuis inbox")}
              className="btn-primary"
            >
              {qualityMut.isPending ? "Override…" : "Override qualité"}
            </button>
          ) : null}

          {item.kind === "scheduler_output" && item.output_id ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => schedApprove.mutate({ outputId: item.output_id!, launchMode: "supervised" })}
                className="btn-success"
              >
                Lancer supervisé
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => schedApprove.mutate({ outputId: item.output_id!, launchMode: "autonomous" })}
                className="btn-primary"
              >
                Lancer autonome
              </button>
              <input
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Motif rejet"
                className="field-input min-w-[140px] flex-1 text-sm"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => schedReject.mutate({ outputId: item.output_id!, reason: rejectReason })}
                className="btn-danger"
              >
                Rejeter
              </button>
            </div>
          ) : null}

          {item.kind === "learning_suggestion" && item.suggestion_id ? (
            <div className="space-y-2">
              {(item.learnings || []).slice(0, 3).map((l, i) => (
                <p key={i} className="text-xs text-slate-600">
                  • {l}
                </p>
              ))}
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => learningMut.mutate({ suggestionId: item.suggestion_id!, decision: "approve" })}
                  className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  Approuver
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => learningMut.mutate({ suggestionId: item.suggestion_id!, decision: "reject" })}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                >
                  Rejeter
                </button>
              </div>
            </div>
          ) : null}

          {[hitlResolve.error, actionResolve.error, cioAnswerMut.error, validateMut.error, closeMut.error, schedApprove.error, schedReject.error, learningMut.error, qualityMut.error, dismissMut.error]
            .filter(Boolean)
            .map((err, i) => (
              <p key={i} className="mt-2 text-xs text-red-700">
                {err instanceof Error ? err.message : String(err)}
              </p>
            ))}
        </div>
      ) : null}
    </li>
  );
}
