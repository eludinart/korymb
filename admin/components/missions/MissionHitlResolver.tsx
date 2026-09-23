"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { agentHeaders, formatHttpApiErrorPayload, requestJson } from "../../lib/api";
import { normalizeHitlBlock } from "../../lib/normalizeHitlBlock";
import { QK } from "../../lib/queryClient";
import { useLockedAction } from "../../lib/useLockedAction";

type HitlGate = { gate?: { kind?: string; result_preview?: string } } | null;

type Props = {
  jobId: string;
  hitl: HitlGate;
  onResolved?: () => void;
};

export default function MissionHitlResolver({ jobId, hitl, onResolved }: Props) {
  const qc = useQueryClient();
  const lock = useLockedAction();
  const [comment, setComment] = useState("");
  const [lastDecision, setLastDecision] = useState<"approve" | "reject" | null>(null);

  async function resolve(decision: "approve" | "reject") {
    await lock.run(
      async () => {
        const { res, data } = await requestJson(`/jobs/${encodeURIComponent(jobId)}/hitl/resolve`, {
          method: "POST",
          headers: agentHeaders(),
          body: JSON.stringify({ decision, comment }),
          expectOk: false,
        });
        if (!res.ok) {
          throw new Error(formatHttpApiErrorPayload(data) || `HTTP ${res.status}`);
        }
        setLastDecision(decision);
        await qc.invalidateQueries({ queryKey: QK.jobsCards });
        await qc.invalidateQueries({ queryKey: ["job-detail-live", jobId] });
        onResolved?.();
      },
      {
        doneMessage:
          decision === "approve" ? "Validation enregistrée — exécution en cours." : "Rejet enregistré.",
      },
    );
  }

  if (lock.isDone) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950 shadow-sm">
        {lock.doneMessage || (lastDecision === "reject" ? "Rejet enregistré." : "Validation enregistrée.")}
      </div>
    );
  }

  const kind = String(hitl?.gate?.kind || "generic");
  const normalized = normalizeHitlBlock(hitl);
  const preview = String(normalized?.gate?.result_preview || hitl?.gate?.result_preview || "").trim();

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
      <p className="text-sm font-semibold text-amber-900">Validation requise</p>
      <p className="mt-1 text-xs text-amber-800">
        Type : <span className="font-mono">{kind}</span> — décidez sans quitter Missions.
      </p>
      {preview ? (
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-white/80 p-2 text-xs text-amber-950">
          {preview.slice(0, 2000)}
        </pre>
      ) : null}
      <textarea
        className="mt-3 w-full rounded-lg border border-amber-200 bg-white p-2 text-sm disabled:opacity-50"
        rows={2}
        placeholder="Commentaire dirigeant (optionnel)"
        value={comment}
        disabled={lock.busy}
        onChange={(e) => setComment(e.target.value)}
      />
      {lock.error ? <p className="mt-2 text-xs text-red-700">{lock.error}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={lock.busy}
          aria-busy={lock.busy}
          onClick={() => void resolve("approve")}
          className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {lock.busy ? "Traitement…" : "Approuver"}
        </button>
        <button
          type="button"
          disabled={lock.busy}
          aria-busy={lock.busy}
          onClick={() => void resolve("reject")}
          className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Rejeter
        </button>
      </div>
    </div>
  );
}
