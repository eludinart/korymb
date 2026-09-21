"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { agentHeaders, requestJson } from "../../lib/api";
import { clampRefinementRounds, DEFAULT_REFINEMENT_ROUNDS, MAX_REFINEMENT_ROUNDS } from "../../lib/missionRefinement";
import { missionTitleLabel } from "../../lib/missionLabel";
import { ENTERPRISE_GROUP_ID, fleetPerimeterInfo, teamBadgeClass, teamIdentityLabel } from "../../lib/agentGroupUi";
import { QK } from "../../lib/queryClient";
import MissionFleetSelect, {
  activeFleetGroups,
  type FleetGroupOption,
} from "./MissionFleetSelect";

type Props = {
  onCreated: (jobId: string) => void;
  onCancel?: () => void;
  className?: string;
  /** Groupe d'agents pré-sélectionné (filtre hub / URL). */
  initialAgentGroupId?: string | null;
  /** Libellé déjà résolu (évite un second fetch). */
  agentGroupLabel?: string;
};

function leadKeyForGroup(group: FleetGroupOption | undefined): string {
  return (group?.lead_agent_key || "coordinateur").trim() || "coordinateur";
}

/** Formulaire de lancement mission — point d'entrée unique (hub Missions). */
export default function MissionCreatePanel({
  onCreated,
  onCancel,
  className = "",
  initialAgentGroupId = null,
  agentGroupLabel = "",
}: Props) {
  const qc = useQueryClient();
  const [mission, setMission] = useState("");
  const [fleetId, setFleetId] = useState(() => (initialAgentGroupId || "").trim() || ENTERPRISE_GROUP_ID);
  const [agent, setAgent] = useState("coordinateur");
  const [refinementEnabled, setRefinementEnabled] = useState(false);
  const [refinementRounds, setRefinementRounds] = useState(DEFAULT_REFINEMENT_ROUNDS);
  const [skipPlanHitl, setSkipPlanHitl] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [costEst, setCostEst] = useState<{ estimated_cost_usd?: number; tier?: string; warnings?: string[] } | null>(
    null,
  );

  const groupsQuery = useQuery({
    queryKey: ["agent-groups"],
    queryFn: async () => {
      const { data, res } = await requestJson("/agent-groups", { retries: 1, expectOk: false });
      if (!res.ok) throw new Error(String(data?.detail || `HTTP ${res.status}`));
      const list = (data as { groups?: unknown })?.groups;
      return Array.isArray(list) ? (list as FleetGroupOption[]) : [];
    },
    staleTime: 30_000,
  });

  const fleets = useMemo(() => activeFleetGroups(groupsQuery.data || []), [groupsQuery.data]);
  const selectedFleet = fleets.find((g) => g.id === fleetId) || fleets[0];
  const perimeter = fleetPerimeterInfo(selectedFleet || { id: fleetId });
  const groupLabel =
    (selectedFleet?.label || "").trim() ||
    (agentGroupLabel || "").trim() ||
    (fleetId === ENTERPRISE_GROUP_ID ? "Entreprise" : "Équipe projet");

  const agents = useQuery({
    queryKey: QK.agents,
    queryFn: async () => (await requestJson("/agents", { retries: 1 })).data.agents || [],
  });

  const agentOptions = useMemo(() => {
    const all = (agents.data || []) as { key: string; label: string }[];
    if (!selectedFleet) return all;
    const allow = new Set<string>([
      leadKeyForGroup(selectedFleet),
      ...(selectedFleet.member_keys || []),
      ...(selectedFleet.members || []).map((m) => m.key),
    ]);
    const filtered = all.filter((a) => allow.has(a.key));
    return filtered.length ? filtered : all;
  }, [agents.data, selectedFleet]);

  useEffect(() => {
    const fromUrl = (initialAgentGroupId || "").trim();
    if (fromUrl) setFleetId(fromUrl);
  }, [initialAgentGroupId]);

  const fleetLead = selectedFleet?.lead_agent_key || "";
  useEffect(() => {
    if (fleetLead) setAgent(fleetLead);
  }, [fleetId, fleetLead]);

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
      const gid = (selectedFleet?.id || fleetId || ENTERPRISE_GROUP_ID).trim();
      const orch = leadKeyForGroup(selectedFleet);
      const payload = {
        mission: mission.trim(),
        agent: agent || orch,
        mission_config: {
          recursive_refinement_enabled: refinementEnabled || undefined,
          recursive_max_rounds: refinementEnabled ? rounds : undefined,
          cio_plan_hitl_enabled: skipPlanHitl ? false : undefined,
          agent_group_id: gid,
          orchestrator_key: orch,
        },
      };

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
          <p className="text-sm font-bold text-slate-900">Nouvelle mission</p>
          <p className="mt-0.5 text-xs text-slate-600">
            Choisissez la flotte, puis décrivez l&apos;objectif. Le périmètre (contexte global ou mémoire d&apos;équipe) est
            celui de l&apos;équipe.
          </p>
        </div>
        {onCancel ? (
          <div className="flex flex-wrap items-center gap-2">
            {selectedFleet ? (
              <span className={`rounded-full px-2 py-1 text-[10px] font-bold tracking-wide ${teamBadgeClass(selectedFleet.id)}`}>
                {teamIdentityLabel(selectedFleet.id, groupLabel)}
              </span>
            ) : null}
            <button type="button" onClick={onCancel} className="btn-secondary px-3 py-1.5 text-xs">
              Fermer
            </button>
          </div>
        ) : null}
      </div>

      <MissionFleetSelect value={fleetId} onChange={setFleetId} groups={fleets} disabled={busy} />
      {groupsQuery.isError ? (
        <p className="text-xs text-amber-800">Impossible de charger les équipes — flotte Entreprise par défaut.</p>
      ) : null}

      <div>
        <label htmlFor="mission-create-text" className="field-label">
          Que voulez-vous accomplir ?
        </label>
        <textarea
          id="mission-create-text"
          rows={4}
          value={mission}
          onChange={(e) => setMission(e.target.value)}
          className="field-input leading-relaxed"
          placeholder="Ex. : analyser les prospects PACA et préparer un kit de contact…"
        />
      </div>

      {costEst ? (
        <div className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-950">
          Estimation ~ <strong>${Number(costEst.estimated_cost_usd || 0).toFixed(3)}</strong>
          {costEst.tier ? ` · ${costEst.tier}` : ""}
        </div>
      ) : null}

      <details className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-sm text-slate-800">
        <summary className="cursor-pointer text-xs font-semibold text-slate-700">Options (agent, affinage, plan)</summary>
        <div className="mt-3 space-y-3">
          <div>
            <label htmlFor="mission-create-agent" className="field-label">
              Agent pilote
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
            <p className="mt-1 text-[11px] text-slate-500">
              Limité aux membres de « {groupLabel} ». Orchestration : {selectedFleet?.lead_label || "lead"}.{" "}
              {perimeter.isolated ? "Contexte global non injecté." : "Contexte global injecté."}
            </p>
          </div>
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
          <p className="text-xs text-slate-500">
            Besoin d&apos;un cadrage pas-à-pas ?{" "}
            <Link href="/missions?mode=guided" className="font-semibold text-violet-800 hover:underline">
              Cadrage guidé
            </Link>
          </p>
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
