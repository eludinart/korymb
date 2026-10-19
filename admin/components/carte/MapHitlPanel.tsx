"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { agentHeaders, requestJson } from "../../lib/api";
import { extractPlanPublicFromHitl } from "../../lib/normalizeHitlBlock";
import { hitlResolve } from "../../lib/missionActions";
import { QK } from "../../lib/queryClient";
import CioPlanReadableSummary from "../missions/CioPlanReadableSummary";

type Props = {
  jobId: string;
  onResolved?: () => void;
};

export default function MapHitlPanel({ jobId, onResolved }: Props) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const hitlQ = useQuery({
    queryKey: ["carte-hitl", jobId],
    enabled: Boolean(jobId),
    queryFn: async () => {
      const { data } = await requestJson(`/jobs/${encodeURIComponent(jobId)}/hitl`, {
        headers: agentHeaders(),
        retries: 1,
        timeoutMs: 15_000,
      });
      return data;
    },
    staleTime: 8_000,
  });

  const plan = extractPlanPublicFromHitl(hitlQ.data);

  const resolve = async (decision: "approve" | "reject") => {
    if (busy) return;
    setBusy(decision);
    setError("");
    try {
      await hitlResolve(jobId, { decision });
      setDone(decision === "approve" ? "Plan validé — l’équipe enchaîne." : "Plan rejeté.");
      void qc.invalidateQueries({ queryKey: QK.operationalMap });
      void qc.invalidateQueries({ queryKey: ["carte-hitl", jobId] });
      onResolved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Décision impossible.");
    } finally {
      setBusy(null);
    }
  };

  if (done) {
    return (
      <section className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3">
        <p className="text-sm font-semibold text-emerald-950">{done}</p>
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-amber-900">Plan à valider</p>
      {hitlQ.isLoading ? <p className="text-xs text-amber-800">Chargement du plan…</p> : null}
      {hitlQ.isError ? (
        <p className="text-xs font-semibold text-red-700">Impossible de charger le plan. Ouvrez Décisions si besoin.</p>
      ) : null}
      <CioPlanReadableSummary plan={plan} />
      {error ? <p className="text-xs font-semibold text-red-700">{error}</p> : null}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!hitlQ.isSuccess || Boolean(busy)}
          onClick={() => void resolve("approve")}
          className="btn-success flex-1 text-sm"
        >
          {busy === "approve" ? "Validation…" : "Valider le plan"}
        </button>
        <button
          type="button"
          disabled={!hitlQ.isSuccess || Boolean(busy)}
          onClick={() => void resolve("reject")}
          className="btn-danger flex-1 text-sm"
        >
          {busy === "reject" ? "…" : "Rejeter"}
        </button>
      </div>
    </section>
  );
}
