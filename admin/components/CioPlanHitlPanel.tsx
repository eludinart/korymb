"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { agentHeaders, formatHttpApiErrorPayload, requestJson } from "../lib/api";
import { QK } from "../lib/queryClient";

type HitlBlock = {
  gate?: Record<string, unknown>;
  resolved_at?: string | null;
  comment?: string | null;
  resolution?: Record<string, unknown> | null;
};

type Props = {
  jobId: string;
  hitl: HitlBlock | null | undefined;
};

export default function CioPlanHitlPanel({ jobId, hitl }: Props) {
  const qc = useQueryClient();
  const gate = (hitl?.gate || {}) as Record<string, unknown>;
  const planPublic = (gate.plan_public || {}) as Record<string, unknown>;
  const planKey = JSON.stringify(planPublic);
  const [draft, setDraft] = useState(() => JSON.stringify(planPublic, null, 2));
  const [feedback, setFeedback] = useState("");
  const [parseErr, setParseErr] = useState("");

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
    void qc.invalidateQueries({ queryKey: QK.jobs });
  };

  const mut = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const { res, data } = await requestJson(`/missions/jobs/${encodeURIComponent(jobId)}/validate`, {
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

  const onApprove = () => {
    setParseErr("");
    mut.mutate({ decision: "approve", feedback });
  };
  const onReject = () => {
    setParseErr("");
    mut.mutate({ decision: "reject", feedback });
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
    mut.mutate({ decision: "amend", amended_plan: amended, feedback });
  };

  return (
    <div className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/60 p-4">
      <p className="text-sm font-semibold text-violet-950">Validation du plan CIO (avant délégation)</p>
      <p className="text-xs leading-relaxed text-violet-900/90">
        Le CIO a proposé un plan de délégation. Approuvez pour lancer les sous-agents, modifiez le JSON (synthèse
        attendue, sous-tâches par clé de rôle), ou rejetez pour arrêter la mission.
      </p>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={12}
        className="w-full rounded-lg border border-violet-200 bg-white p-2 font-mono text-xs text-slate-800"
        spellCheck={false}
      />
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
