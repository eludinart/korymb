"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { agentHeaders, formatHttpApiErrorPayload, requestJson } from "../lib/api";
import { extractPlanPublicFromHitl, normalizeHitlBlock } from "../lib/normalizeHitlBlock";
import { QK } from "../lib/queryClient";
import CioPlanReadableSummary from "./missions/CioPlanReadableSummary";
import PlanDiffPanel from "./PlanDiffPanel";

type HitlBlock = {
  gate?: Record<string, unknown>;
  resolved_at?: string | null;
  comment?: string | null;
  resolution?: Record<string, unknown> | null;
};

type Props = {
  jobId: string;
  hitl: HitlBlock | Record<string, unknown> | null | undefined;
};

export default function CioPlanHitlPanel({ jobId, hitl }: Props) {
  const qc = useQueryClient();
  const normalized = useMemo(() => normalizeHitlBlock(hitl), [hitl]);
  const gate = (normalized?.gate || {}) as Record<string, unknown>;

  const jobPlanQuery = useQuery({
    queryKey: ["cio-plan-hitl-job-plan", jobId],
    enabled: Boolean(jobId),
    queryFn: async () => {
      const { data } = await requestJson(`/jobs/${encodeURIComponent(jobId)}`, { headers: agentHeaders() });
      return (data?.plan || {}) as Record<string, unknown>;
    },
    staleTime: 15_000,
  });

  const planPublic = useMemo(() => {
    const fromHitl = extractPlanPublicFromHitl(hitl);
    if (Object.keys(fromHitl).length) return fromHitl;
    const fromJob = jobPlanQuery.data;
    if (fromJob && typeof fromJob === "object" && Object.keys(fromJob).length) {
      return fromJob;
    }
    return {};
  }, [hitl, jobPlanQuery.data]);

  const planKey = JSON.stringify(planPublic);
  const [draft, setDraft] = useState(() => JSON.stringify(planPublic, null, 2));
  const [feedback, setFeedback] = useState("");
  const [parseErr, setParseErr] = useState("");
  const [showJson, setShowJson] = useState(false);

  useEffect(() => {
    try {
      const o = JSON.parse(planKey) as Record<string, unknown>;
      setDraft(JSON.stringify(o, null, 2));
    } catch {
      setDraft(planKey);
    }
    setParseErr("");
  }, [planKey]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["job-live", jobId] });
    void qc.invalidateQueries({ queryKey: ["job-detail-live", jobId] });
    void qc.invalidateQueries({ queryKey: ["inbox-hitl", jobId] });
    void qc.invalidateQueries({ queryKey: QK.jobsCards });
  };

  const mut = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const { res, data } = await requestJson(`/jobs/${encodeURIComponent(jobId)}/hitl/resolve`, {
        method: "POST",
        headers: agentHeaders(),
        body: JSON.stringify(body),
        expectOk: false,
      });
      if (!res.ok) {
        const msg = formatHttpApiErrorPayload(data) || res.statusText || "Erreur";
        throw new Error(msg);
      }
      return data;
    },
    onSuccess: () => {
      invalidate();
    },
  });

  const busy = mut.isPending;
  const missionLabel = String(gate.mission || "").trim();

  const onApprove = () => {
    setParseErr("");
    mut.mutate({ decision: "approve", comment: feedback, feedback });
  };
  const onReject = () => {
    setParseErr("");
    mut.mutate({ decision: "reject", comment: feedback, feedback });
  };
  const onAmend = () => {
    setParseErr("");
    let amended: Record<string, unknown>;
    try {
      amended = JSON.parse(draft || "{}") as Record<string, unknown>;
    } catch {
      setParseErr("JSON invalide : corrige le plan avant d'envoyer.");
      return;
    }
    if (!amended || typeof amended !== "object" || Object.keys(amended).length === 0) {
      setParseErr("Plan vide.");
      return;
    }
    mut.mutate({ decision: "amend", amended_plan: amended, comment: feedback, feedback });
  };

  return (
    <div className="space-y-3 rounded-xl border-2 border-violet-200 bg-gradient-to-b from-violet-50/80 to-white p-4 shadow-sm">
      <div>
        <p className="text-sm font-semibold text-violet-950">Validation du plan CIO (avant délégation)</p>
        <p className="mt-1 text-xs leading-relaxed text-violet-900/90">
          Le CIO a proposé un plan de délégation. Lisez la synthèse et les sous-tâches ci-dessous, puis approuvez pour
          lancer les sous-agents, modifiez le plan (JSON), ou rejetez pour arrêter la mission.
        </p>
        {missionLabel ? (
          <p className="mt-2 rounded-lg border border-violet-100 bg-white/80 px-2.5 py-1.5 text-xs text-slate-700">
            <span className="font-semibold text-violet-900">Mission :</span> {missionLabel}
          </p>
        ) : null}
      </div>

      <PlanDiffPanel jobId={jobId} compact />

      <section aria-label="Plan CIO lisible">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-violet-800">Plan proposé — lecture</p>
        <CioPlanReadableSummary plan={planPublic} />
      </section>

      <div>
        <button
          type="button"
          onClick={() => setShowJson((v) => !v)}
          className="text-[11px] font-semibold text-violet-800 underline decoration-violet-300 hover:text-violet-950"
        >
          {showJson ? "Masquer le JSON éditable" : "Modifier le plan (JSON avancé)"}
        </button>
        {showJson ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={12}
            className="mt-2 w-full rounded-lg border border-violet-200 bg-white p-2 font-mono text-xs text-slate-800"
            spellCheck={false}
            aria-label="Plan CIO JSON"
          />
        ) : null}
      </div>

      <label className="block text-xs font-medium text-violet-900">
        Note (optionnel)
        <input
          type="text"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          className="mt-1 w-full rounded-lg border border-violet-200 bg-white px-2 py-1.5 text-sm"
          placeholder="Feedback pour l'équipe / le CIO…"
        />
      </label>
      {parseErr ? <p className="text-xs text-red-700">{parseErr}</p> : null}
      {mut.isError ? (
        <p className="text-xs text-red-700">{mut.error instanceof Error ? mut.error.message : String(mut.error)}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void onApprove()}
          className="rounded-lg bg-green-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-800 disabled:opacity-40"
        >
          Approuver le plan
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void onAmend()}
          className="rounded-lg bg-violet-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-900 disabled:opacity-40"
        >
          Envoyer ma version
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void onReject()}
          className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-40"
        >
          Rejeter
        </button>
      </div>
    </div>
  );
}
