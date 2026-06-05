"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { agentHeaders, formatHttpApiErrorPayload, requestJson } from "../../lib/api";
import { QK } from "../../lib/queryClient";

type HitlGate = { gate?: { kind?: string; result_preview?: string } } | null;

type Props = {
  jobId: string;
  hitl: HitlGate;
  onResolved?: () => void;
};

export default function MissionHitlResolver({ jobId, hitl, onResolved }: Props) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [comment, setComment] = useState("");

  async function resolve(decision: "approve" | "reject" | "amend", amendedPlan?: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const { res, data } = await requestJson(`/jobs/${encodeURIComponent(jobId)}/hitl/resolve`, {
        method: "POST",
        headers: agentHeaders(),
        body: JSON.stringify({
          decision,
          comment,
          amended_plan: amendedPlan,
        }),
        expectOk: false,
      });
      if (!res.ok) {
        throw new Error(formatHttpApiErrorPayload(data) || `HTTP ${res.status}`);
      }
      await qc.invalidateQueries({ queryKey: QK.jobsCards });
      await qc.invalidateQueries({ queryKey: ["job-detail-live", jobId] });
      onResolved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const kind = String(hitl?.gate?.kind || "generic");

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
      <p className="text-sm font-semibold text-amber-900">Validation requise (HITL)</p>
      <p className="mt-1 text-xs text-amber-800">
        Type : <span className="font-mono">{kind}</span> — décidez sans quitter Missions.
      </p>
      {hitl?.gate?.result_preview ? (
        <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-white/80 p-2 text-xs text-amber-950 whitespace-pre-wrap">
          {String(hitl.gate.result_preview).slice(0, 2000)}
        </pre>
      ) : null}
      <textarea
        className="mt-3 w-full rounded-lg border border-amber-200 bg-white p-2 text-sm"
        rows={2}
        placeholder="Commentaire dirigeant (optionnel)"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      {error ? <p className="mt-2 text-xs text-red-700">{error}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => resolve("approve")}
          className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          Approuver
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => resolve("reject")}
          className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-50 disabled:opacity-50"
        >
          Rejeter
        </button>
      </div>
    </div>
  );
}
