"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { agentHeaders, requestJson } from "../../lib/api";
import { clampRefinementRounds, DEFAULT_REFINEMENT_ROUNDS, MAX_REFINEMENT_ROUNDS } from "../../lib/missionRefinement";
import { missionTitleLabel } from "../../lib/missionLabel";
import { ENTERPRISE_GROUP_ID, teamBadgeClass, teamBadgeLabel } from "../../lib/agentGroupUi";
import { QK } from "../../lib/queryClient";

type Props = {
  onCreated: (jobId: string) => void;
  onCancel?: () => void;
  className?: string;
  /** Groupe d'agents à rattacher (contexte d'équipe projet). */
  initialAgentGroupId?: string | null;
  /** Libellé déjà résolu (évite un second fetch). */
  agentGroupLabel?: string;
};

type GroupRow = {
  id: string;
  label: string;
  status?: string;
  lead_agent_key?: string;
  lead_label?: string;
};

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
  const [agent, setAgent] = useState("coordinateur");
  const [selectedGroupId, setSelectedGroupId] = useState(
    () => (initialAgentGroupId || "").trim() || ENTERPRISE_GROUP_ID,
  );
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
      return Array.isArray(list) ? (list as GroupRow[]) : [];
    },
    staleTime: 60_000,
  });

  const groupOptions = useMemo(() => {
    const rows = (groupsQuery.data || []).filter((g) => g.id && String(g.status || "active") !== "archived");
    if (!rows.some((g) => g.id === ENTERPRISE_GROUP_ID)) {
      return [{ id: ENTERPRISE_GROUP_ID, label: "Entreprise", lead_agent_key: "coordinateur", lead_label: "CIO" }, ...rows];
    }
    return rows;
  }, [groupsQuery.data]);

  const groupsById = useMemo(() => {
    const map: Record<string, { label?: string }> = { [ENTERPRISE_GROUP_ID]: { label: "Entreprise" } };
    for (const g of groupOptions) map[g.id] = { label: g.label };
    return map;
  }, [groupOptions]);

  const agentGroupId = (selectedGroupId || "").trim() || ENTERPRISE_GROUP_ID;
  const selectedGroup = groupOptions.find((g) => g.id === agentGroupId);
  const groupLabel =
    (selectedGroup?.label || "").trim() ||
    (agentGroupLabel || "").trim() ||
    teamBadgeLabel(agentGroupId, groupsById);

  useEffect(() => {
    const fromUrl = (initialAgentGroupId || "").trim();
    if (fromUrl) setSelectedGroupId(fromUrl);
  }, [initialAgentGroupId]);

  useEffect(() => {
    const lead = selectedGroup?.lead_agent_key?.trim();
    if (lead) setAgent(lead);
  }, [selectedGroup?.lead_agent_key]);

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
          agent_group_id?: string | null;
        };
      } = { mission: mission.trim(), agent };
      const mcfg: {
        recursive_refinement_enabled?: boolean;
        recursive_max_rounds?: number;
        cio_plan_hitl_enabled?: boolean;
        agent_group_id?: string | null;
      } = {};
      if (refinementEnabled) {
        mcfg.recursive_refinement_enabled = true;
        mcfg.recursive_max_rounds = rounds;
      }
      if (skipPlanHitl) mcfg.cio_plan_hitl_enabled = false;
      mcfg.agent_group_id = agentGroupId;
      payload.mission_config = mcfg;

      const { data } = await requestJson("/run", {
        method: "POST",
        headers: agentHeaders(),
        body: JSON.stringify(payload),
        timeoutMs: 20000,
      });
      const newId = String(data.job_id || "");
      setMsg(
        newId
          ? `Mission lancée pour « ${groupLabel} » : « ${missionTitleLabel(mission, 80) || newId} »`
          : "Mission acceptée.",
      );
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
            Choisissez la flotte, puis décrivez l’objectif. « {groupLabel} » exécute la mission dans son périmètre.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2 py-1 text-[10px] font-bold tracking-wide ${teamBadgeClass(agentGroupId)}`}>
            Flotte · {groupLabel}
          </span>
          {onCancel ? (
            <button type="button" onClick={onCancel} className="btn-secondary px-3 py-1.5 text-xs">
              Fermer
            </button>
          ) : null}
        </div>
      </div>

      <div>
        <label htmlFor="mission-create-fleet" className="field-label">
          Flotte d’agents
        </label>
        <select
          id="mission-create-fleet"
          value={agentGroupId}
          onChange={(e) => setSelectedGroupId(e.target.value)}
          className={`field-input ${teamBadgeClass(agentGroupId)}`}
        >
          {groupOptions.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
              {g.lead_label ? ` · ${g.lead_label}` : ""}
            </option>
          ))}
        </select>
        {groupsQuery.isError ? (
          <p className="mt-1 text-xs text-amber-800">Liste des flottes incomplète — défaut Entreprise.</p>
        ) : null}
      </div>

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
