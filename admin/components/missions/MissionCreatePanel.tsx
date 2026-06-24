"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { agentHeaders, requestJson } from "../../lib/api";
import { clampRefinementRounds, DEFAULT_REFINEMENT_ROUNDS, MAX_REFINEMENT_ROUNDS } from "../../lib/missionRefinement";
import { missionTitleLabel } from "../../lib/missionLabel";
import { QK } from "../../lib/queryClient";

type Props = {
  onCreated: (jobId: string) => void;
  onCancel?: () => void;
  className?: string;
};

/** Formulaire de lancement mission — point d'entrée unique (hub Missions). */
export default function MissionCreatePanel({ onCreated, onCancel, className = "" }: Props) {
  const qc = useQueryClient();
  const [mission, setMission] = useState("");
  const [agent, setAgent] = useState("coordinateur");
  const [refinementEnabled, setRefinementEnabled] = useState(false);
  const [refinementRounds, setRefinementRounds] = useState(DEFAULT_REFINEMENT_ROUNDS);
  const [skipPlanHitl, setSkipPlanHitl] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [costEst, setCostEst] = useState<{ estimated_cost_usd?: number; tier?: string; warnings?: string[] } | null>(
    null,
  );

  const agents = useQuery({
    queryKey: QK.agents,
    queryFn: async () => (await requestJson("/agents", { retries: 1 })).data.agents || [],
  });

  const agentOptions = useMemo(
    () => (agents.data || []) as { key: string; label: string }[],
    [agents.data],
  );

  useEffect(() => {
    const text = mission.trim();
    if (text.length < 12) {
      setCostEst(null);
      return;
    }
    const t = window.setTimeout(() => {
      void requestJson("/missions/estimate-cost", {
        method: "POST",
        headers: agentHeaders(),
        body: JSON.stringify({
          mission: text,
          agents: [agent],
          mode: "cio",
          refinement_rounds: refinementEnabled ? refinementRounds : 0,
        }),
      })
        .then(({ data }) => setCostEst(data))
        .catch(() => setCostEst(null));
    }, 500);
    return () => window.clearTimeout(t);
  }, [mission, agent, refinementEnabled, refinementRounds]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!mission.trim() || busy) return;
    setBusy(true);
    setMsg("");
    try {
      const rounds = clampRefinementRounds(refinementRounds);
      const payload: {
        mission: string;
        agent: string;
        mission_config?: {
          recursive_refinement_enabled?: boolean;
          recursive_max_rounds?: number;
          cio_plan_hitl_enabled?: boolean;
        };
      } = { mission: mission.trim(), agent };
      const mcfg: {
        recursive_refinement_enabled?: boolean;
        recursive_max_rounds?: number;
        cio_plan_hitl_enabled?: boolean;
      } = {};
      if (refinementEnabled) {
        mcfg.recursive_refinement_enabled = true;
        mcfg.recursive_max_rounds = rounds;
      }
      if (skipPlanHitl) mcfg.cio_plan_hitl_enabled = false;
      if (Object.keys(mcfg).length) payload.mission_config = mcfg;

      const { data } = await requestJson("/run", {
        method: "POST",
        headers: agentHeaders(),
        body: JSON.stringify(payload),
        timeoutMs: 20000,
      });
      const newId = String(data.job_id || "");
      setMsg(newId ? `Mission lancée : « ${missionTitleLabel(mission, 80) || newId} »` : "Mission acceptée.");
      setMission("");
      void qc.invalidateQueries({ queryKey: QK.jobsCards });
      void qc.invalidateQueries({ queryKey: QK.tokens });
      if (newId) onCreated(newId);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      className={`space-y-4 rounded-2xl border-2 border-emerald-200 bg-gradient-to-b from-emerald-50/80 to-white p-5 shadow-sm ${className}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-slate-900">Lancer une mission</p>
          <p className="mt-0.5 text-xs text-slate-600">Consigne + agent pilote — suivi immédiat dans ce hub.</p>
        </div>
        {onCancel ? (
          <button type="button" onClick={onCancel} className="btn-secondary px-3 py-1.5 text-xs">
            Fermer
          </button>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-[minmax(8rem,10rem)_1fr]">
        <div>
          <label htmlFor="mission-create-agent" className="field-label">
            Agent
          </label>
          <select
            id="mission-create-agent"
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
            className="field-input"
          >
            {agentOptions.map((a, i) => (
              <option key={`${a.key}-${i}`} value={a.key}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="mission-create-text" className="field-label">
            Consigne
          </label>
          <textarea
            id="mission-create-text"
            rows={4}
            value={mission}
            onChange={(e) => setMission(e.target.value)}
            className="field-input leading-relaxed"
            placeholder="Décrivez ce que le CIO doit orchestrer…"
          />
        </div>
      </div>

      {costEst ? (
        <div className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-950">
          Estimation ~ <strong>${Number(costEst.estimated_cost_usd || 0).toFixed(3)}</strong>
          {costEst.tier ? ` · ${costEst.tier}` : ""}
        </div>
      ) : null}

      <details className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-sm text-slate-800">
        <summary className="cursor-pointer text-xs font-semibold text-slate-700">Options avancées</summary>
        <div className="mt-3 space-y-2">
          <label className="flex cursor-pointer items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={refinementEnabled}
              onChange={(e) => setRefinementEnabled(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Boucle d&apos;affinage CIO ({refinementEnabled ? refinementRounds : DEFAULT_REFINEMENT_ROUNDS} tour
              {refinementRounds > 1 ? "s" : ""} max {MAX_REFINEMENT_ROUNDS})
            </span>
          </label>
          {refinementEnabled ? (
            <input
              type="number"
              min={1}
              max={MAX_REFINEMENT_ROUNDS}
              value={refinementRounds}
              onChange={(e) => setRefinementRounds(clampRefinementRounds(e.target.value))}
              className="w-20 rounded-md border border-slate-200 px-2 py-1 text-sm"
              aria-label="Nombre de tours d'affinage"
            />
          ) : null}
          <label className="flex cursor-pointer items-start gap-2 text-xs">
            <input type="checkbox" checked={skipPlanHitl} onChange={(e) => setSkipPlanHitl(e.target.checked)} className="mt-0.5" />
            <span>Lancer sans pause sur le plan CIO (pas de validation HITL du plan)</span>
          </label>
        </div>
      </details>

      <button type="submit" disabled={busy || !mission.trim()} className="btn-primary w-full sm:w-auto">
        {busy ? "Lancement…" : "Lancer la mission"}
      </button>
      {msg ? (
        <p className="text-sm text-slate-700" role="status">
          {msg}
        </p>
      ) : null}
    </form>
  );
}
