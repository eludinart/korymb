"use client";

import RecentInterlocutorPicks from "../RecentInterlocutorPicks";
import {
  ENTERPRISE_GROUP_ID,
  ENTERPRISE_ROLE_LABEL,
  IDENTITY_SELECT,
  fleetPerimeterInfo,
  identityFromGroupId,
  teamIdentityLabel,
  type FleetPerimeterInfo,
} from "../../lib/agentGroupUi";
import { fleetIdFromInterlocutor, interlocutorFromGroupId } from "../../lib/recentInterlocutors";

export type FleetGroupOption = {
  id: string;
  label: string;
  description?: string;
  lead_agent_key?: string;
  lead_label?: string;
  member_keys?: string[];
  members?: Array<{ key: string; label: string; role?: string }>;
  status?: string;
  is_system?: boolean;
  memory_scope?: string;
  inherit_shared?: boolean;
  sees_workspace_identity?: boolean;
  policy?: { memory_scope?: string };
};

type Props = {
  value: string;
  onChange: (groupId: string) => void;
  groups: FleetGroupOption[];
  disabled?: boolean;
  id?: string;
};

const PERIMETER_TONE: Record<FleetPerimeterInfo["kind"], string> = {
  global: "border-amber-200 bg-amber-50/70 text-amber-950",
  inherited: "border-sky-200 bg-sky-50/80 text-sky-950",
  team: "border-emerald-200 bg-emerald-50/80 text-emerald-950",
  none: "border-slate-200 bg-slate-50 text-slate-800",
};

export function activeFleetGroups(groups: FleetGroupOption[]): FleetGroupOption[] {
  const active = groups.filter((g) => g.status !== "archived");
  const enterprise = active.find((g) => g.id === ENTERPRISE_GROUP_ID);
  const rest = active.filter((g) => g.id !== ENTERPRISE_GROUP_ID);
  return enterprise ? [enterprise, ...rest] : rest;
}

export default function MissionFleetSelect({
  value,
  onChange,
  groups,
  disabled,
  id = "mission-fleet",
}: Props) {
  const list = activeFleetGroups(groups);
  const selected = list.find((g) => g.id === value) || list.find((g) => g.id === ENTERPRISE_GROUP_ID) || list[0];
  const perimeter = fleetPerimeterInfo(selected || { id: value || ENTERPRISE_GROUP_ID });
  const members =
    (selected?.members || []).map((m) => m.label).filter(Boolean).join(", ") ||
    (selected?.member_keys || []).join(", ") ||
    (selected?.id === ENTERPRISE_GROUP_ID ? "Commercial, CM, Dev, Comptable" : "—");
  const tone = IDENTITY_SELECT[identityFromGroupId(selected?.id)];

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="field-label">
        Flotte d&apos;agents
      </label>
      <select
        id={id}
        value={selected?.id || ENTERPRISE_GROUP_ID}
        disabled={disabled || !list.length}
        onChange={(e) => onChange(e.target.value)}
        className={`field-input font-semibold ${tone}`}
      >
        {list.map((g) => {
          const p = fleetPerimeterInfo(g);
          const name =
            g.id === ENTERPRISE_GROUP_ID ? `${g.label || "Entreprise"} — ${ENTERPRISE_ROLE_LABEL}` : g.label;
          return (
            <option key={g.id} value={g.id}>
              {name} · {p.short}
            </option>
          );
        })}
      </select>
      <RecentInterlocutorPicks
        current={interlocutorFromGroupId(selected?.id || value || ENTERPRISE_GROUP_ID)}
        fleetsOnly
        disabled={disabled}
        onPick={(next) => {
          const id = fleetIdFromInterlocutor(next);
          if (id) onChange(id);
        }}
      />
      {selected ? (
        <div className={`rounded-xl border px-3 py-2 text-xs leading-relaxed ${PERIMETER_TONE[perimeter.kind]}`}>
          <p className="font-bold">
            {teamIdentityLabel(selected.id, selected.label)}
            <span className="ml-2 font-semibold opacity-80">— {perimeter.short}</span>
          </p>
          <p className="mt-1">{perimeter.detail}</p>
          <p className="mt-1 opacity-80">
            Lead : {selected.lead_label || selected.lead_agent_key || "—"} · Membres : {members}
          </p>
        </div>
      ) : (
        <p className="text-xs text-slate-500">Aucune équipe active. La flotte Entreprise sera utilisée.</p>
      )}
    </div>
  );
}
