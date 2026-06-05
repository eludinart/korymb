"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import CioPlanHitlPanel from "../CioPlanHitlPanel";
import MissionHitlResolver from "../missions/MissionHitlResolver";
import PlanDiffPanel from "../PlanDiffPanel";
import CioAnswerResult from "../missions/CioAnswerResult";
import { agentHeaders, requestJson } from "../../lib/api";
import {
  useCioAnswer,
  useHitlResolve,
  useLearningResolve,
  useQualityOverride,
  useSchedulerApprove,
  useSchedulerReject,
  useValidateMission,
} from "../../lib/missionActions";

export type InboxActionItem = {
  kind: string;
  job_id?: string;
  output_id?: string;
  suggestion_id?: string;
  title?: string;
  mission?: string;
  status?: string;
  updated_at?: string;
  questions?: string[];
  hitl_kind?: string;
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
};

export default function InboxActionCard({ item, defaultExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [cioInput, setCioInput] = useState("");
  const [cioAnswerResult, setCioAnswerResult] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const jobId = item.job_id || "";

  const hitlQuery = useQuery({
    queryKey: ["inbox-hitl", jobId],
    enabled: expanded && item.kind === "hitl" && Boolean(jobId),
    queryFn: async () => (await requestJson(`/jobs/${encodeURIComponent(jobId)}/hitl`, { headers: agentHeaders() })).data,
  });

  const hitlResolve = useHitlResolve(jobId);
  const cioAnswerMut = useCioAnswer(jobId);
  const validateMut = useValidateMission(jobId);
  const schedApprove = useSchedulerApprove();
  const schedReject = useSchedulerReject();
  const learningMut = useLearningResolve();
  const qualityMut = useQualityOverride(jobId);

  const busy =
    hitlResolve.isPending ||
    cioAnswerMut.isPending ||
    validateMut.isPending ||
    schedApprove.isPending ||
    schedReject.isPending ||
    learningMut.isPending ||
    qualityMut.isPending;

  const onCioSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!cioInput.trim()) return;
    const text = cioInput.trim();
    await cioAnswerMut.mutateAsync(text);
    setCioAnswerResult(text);
    setCioInput("");
  };

  const kindLabel: Record<string, string> = {
    hitl: "HITL",
    cio_question: "Question CIO",
    closure: "Clôture",
    scheduler_output: "Approbation",
    learning_suggestion: "Apprentissage",
    quality: "Qualité",
  };

  const kindBadgeClass: Record<string, string> = {
    hitl: "kind-badge kind-badge--hitl",
    cio_question: "kind-badge kind-badge--cio_question",
    closure: "kind-badge kind-badge--closure",
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

  return (
    <li className="action-card list-none">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <span className={kindBadgeClass[item.kind] || "kind-badge kind-badge--default"}>
            {kindLabel[item.kind] || item.kind}
          </span>
          {item.kind === "cio_question" && cioAnswerResult ? (
            <div className="mt-2">
              <CioAnswerResult answer={cioAnswerResult} compact />
            </div>
          ) : null}
          {item.kind === "cio_question" && !cioAnswerResult ? (
            <p className="mt-2 text-xs font-bold uppercase tracking-wide text-amber-700">Le CIO vous demande</p>
          ) : null}
          {cioQuestions.length > 0 && !cioAnswerResult ? (
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
        <div className="flex shrink-0 flex-row flex-wrap gap-2 sm:flex-col">
          <button type="button" onClick={() => setExpanded((v) => !v)} className="btn-primary px-4 py-2.5 text-sm">
            {expanded ? "Réduire" : "Agir maintenant"}
          </button>
          {jobId ? (
            <Link href={`/missions?job=${encodeURIComponent(jobId)}`} className="btn-link-secondary text-center">
              Ouvrir mission
            </Link>
          ) : null}
        </div>
      </div>

      {expanded ? (
        <div className="mt-4 border-t-2 border-violet-100 pt-4">
          {item.kind === "hitl" && jobId ? (
            <div className="space-y-3">
              {item.hitl_kind === "cio_plan" && hitlQuery.data ? (
                <>
                  <PlanDiffPanel jobId={jobId} compact />
                  <CioPlanHitlPanel jobId={jobId} hitl={hitlQuery.data} />
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
              {cioQuestions.length > 0 && !cioAnswerResult ? (
                <ul className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                  {cioQuestions.map((q, i) => (
                    <li key={i} className="flex gap-2 text-sm font-semibold text-slate-800">
                      <span className="shrink-0 text-amber-700">{i + 1}.</span>
                      <span>{q}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {cioAnswerResult ? <CioAnswerResult answer={cioAnswerResult} /> : null}
              {!cioAnswerResult ? (
                <form onSubmit={(e) => void onCioSubmit(e)} className="flex gap-2">
                  <input
                    value={cioInput}
                    onChange={(e) => setCioInput(e.target.value)}
                    placeholder="Votre réponse au CIO…"
                    disabled={busy}
                    className="field-input min-w-0 flex-1"
                  />
                  <button type="submit" disabled={busy || !cioInput.trim()} className="btn-amber shrink-0">
                    {cioAnswerMut.isPending ? "Envoi…" : "Envoyer"}
                  </button>
                </form>
              ) : (
                <Link href={`/missions?job=${encodeURIComponent(jobId)}`} className="btn-link-primary text-sm">
                  Voir dans le fil de la mission →
                </Link>
              )}
            </div>
          ) : null}

          {item.kind === "closure" && jobId ? (
            <button type="button" disabled={busy} onClick={() => validateMut.mutate()} className="btn-success">
              {validateMut.isPending ? "Validation…" : "Valider mission"}
            </button>
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

          {[hitlResolve.error, cioAnswerMut.error, validateMut.error, schedApprove.error, schedReject.error, learningMut.error, qualityMut.error]
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
