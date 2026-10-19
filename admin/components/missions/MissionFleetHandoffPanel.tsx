"use client";

import { FormEvent, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { agentHeaders, requestJson } from "../../lib/api";
import { ENTERPRISE_GROUP_ID, teamBadgeClass, teamBadgeLabel } from "../../lib/agentGroupUi";
import { missionTitleLabel } from "../../lib/missionLabel";
import { QK } from "../../lib/queryClient";

type GroupRow = {
  id: string;
  label: string;
  status?: string;
  lead_agent_key?: string;
  lead_label?: string;
};

type Props = {
  parentJobId: string;
  parentGroupId?: string | null;
  parentMission?: string | null;
  onCreated: (jobId: string) => void;
};

/** Relais : nouvelle mission pour une autre flotte, nourrie du livrable d'origine. */
export default function MissionFleetHandoffPanel({
  parentJobId,
  parentGroupId,
  parentMission,
  onCreated,
}: Props) {
  const qc = useQueryClient();
  const currentGroup = (parentGroupId || ENTERPRISE_GROUP_ID).trim() || ENTERPRISE_GROUP_ID;
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

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

  const otherGroups = useMemo(
    () =>
      (groupsQuery.data || []).filter(
        (g) => g.id && g.id !== currentGroup && String(g.status || "active") !== "archived",
      ),
    [groupsQuery.data, currentGroup],
  );

  const selected = otherGroups.find((g) => g.id === selectedGroupId) || otherGroups[0] || null;
  const selectedId = selected?.id || "";
  const parentTitle = missionTitleLabel(parentMission, 80) || parentJobId;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedId || busy) return;
    setBusy(true);
    setMsg("");
    setErr("");
    try {
      const brief =
        instruction.trim() ||
        `Poursuis à partir du livrable de la mission « ${parentTitle} ». Reste dans le périmètre de ton équipe.`;
      const payload = {
        mission: brief,
        agent: selected?.lead_agent_key || "coordinateur",
        parent_job_id: parentJobId,
        mission_config: { agent_group_id: selectedId },
      };
      const { data } = await requestJson("/run", {
        method: "POST",
        headers: agentHeaders(),
        body: JSON.stringify(payload),
        timeoutMs: 20000,
      });
      const newId = String(data.job_id || "");
      setMsg(
        newId
          ? `Mission lancée pour « ${teamBadgeLabel(selectedId, { [selectedId]: selected })} ».`
          : "Mission acceptée.",
      );
      setInstruction("");
      void qc.invalidateQueries({ queryKey: QK.jobsCards });
      void qc.invalidateQueries({ queryKey: QK.tokens });
      if (newId) onCreated(newId);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  };

  if (groupsQuery.isLoading) {
    return <p className="text-sm text-slate-500">Chargement des flottes…</p>;
  }
  if (groupsQuery.isError) {
    return (
      <p className="text-sm text-red-700">
        Impossible de charger les flottes
        {groupsQuery.error instanceof Error ? ` : ${groupsQuery.error.message}` : ""}.
      </p>
    );
  }
  if (!otherGroups.length) {
    return (
      <p className="text-sm text-slate-500">
        Aucune autre flotte active. Créez une équipe projet pour relayer ce livrable sans mélanger les périmètres.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <p className="text-sm font-semibold text-slate-900">Faire travailler une autre flotte</p>
        <p className="mt-1 text-xs leading-relaxed text-slate-600">
          Crée une <span className="font-medium text-slate-800">nouvelle mission</span> pour une autre équipe, avec le
          livrable de « {parentTitle} » en entrée. Les périmètres restent séparés.
        </p>
      </div>
      <div>
        <label htmlFor="handoff-fleet" className="field-label">
          Flotte destinataire
        </label>
        <select
          id="handoff-fleet"
          value={selectedId}
          onChange={(e) => setSelectedGroupId(e.target.value)}
          className={`field-input ${teamBadgeClass(selectedId)}`}
        >
          {otherGroups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
              {g.lead_label ? ` · ${g.lead_label}` : ""}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="handoff-instruction" className="field-label">
          Consigne pour cette flotte
        </label>
        <textarea
          id="handoff-instruction"
          rows={3}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          disabled={busy}
          className="field-input leading-relaxed disabled:opacity-50"
          placeholder="Ex. : à partir de cette synthèse, rédige le chapitre 1…"
        />
      </div>
      <button type="submit" disabled={busy || !selectedId} className="btn-primary w-full sm:w-auto">
        {busy ? "Lancement…" : `Lancer la mission pour ${selected?.label || "cette flotte"}`}
      </button>
      {msg ? (
        <p className="text-sm text-emerald-800" role="status">
          {msg}
        </p>
      ) : null}
      {err ? (
        <p className="text-sm text-red-700" role="alert">
          {err}
        </p>
      ) : null}
    </form>
  );
}
