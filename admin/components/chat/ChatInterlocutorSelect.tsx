"use client";

import { useMemo, useState } from "react";
import {
  ENTERPRISE_GROUP_ID,
  ENTERPRISE_ROLE_LABEL,
  IDENTITY_BADGE,
  IDENTITY_BORDER,
  IDENTITY_ICON_BUTTON,
  IDENTITY_SELECT,
  identityFromInterlocutor,
  type IdentityKind,
} from "../../lib/agentGroupUi";

export type GroupOpt = {
  id: string;
  label: string;
  description?: string;
  lead_agent_key?: string;
  lead_label?: string;
  member_keys?: string[];
  members?: Array<{ key: string; label: string; role?: string }>;
  is_system?: boolean;
  status?: string;
};

type Props = {
  value: string; // "assistant" | "coordinateur" | `group:${id}`
  onChange: (v: string) => void;
  groups: GroupOpt[];
  disabled?: boolean;
  /** Compact = select only (barre mobile haute). Full = select + fiche contexte. */
  variant?: "compact" | "full";
  className?: string;
};

export type InterlocutorContext = {
  title: string;
  mode: string;
  who: string;
  team: string;
  context: string;
  kind: IdentityKind;
};

export function describeInterlocutor(value: string, groups: GroupOpt[]): InterlocutorContext {
  const kind = identityFromInterlocutor(value);
  if (value === "assistant") {
    return {
      title: "Assistant",
      mode: "Conversation libre",
      who: "Copilote généraliste (pas le CIO)",
      team: "Aucune — exploration & cadrage",
      context: "Répond à tes questions, brainstorm, plans. Propose une équipe seulement si tu le demandes.",
      kind,
    };
  }
  if (value === "coordinateur" || value === `group:${ENTERPRISE_GROUP_ID}`) {
    const ent = groups.find((g) => g.id === ENTERPRISE_GROUP_ID);
    const members =
      (ent?.members || []).map((m) => m.label).filter(Boolean).join(", ") ||
      (ent?.member_keys || []).join(", ") ||
      "Commercial, CM, Dev, Comptable";
    return {
      title: "CIO — Entreprise",
      mode: ENTERPRISE_ROLE_LABEL,
      who: ent?.lead_label || "CIO (orchestrateur)",
      team: members,
      context:
        ent?.description ||
        "Flotte métier par défaut : prospection, contenus, tech, devis — avec validations HITL.",
      kind,
    };
  }
  if (value.startsWith("group:")) {
    const id = value.slice(6);
    const g = groups.find((x) => x.id === id);
    if (!g) {
      return {
        title: "Équipe",
        mode: "Équipe projet",
        who: "Lead",
        team: "—",
        context: "Équipe sélectionnée introuvable ou archivée.",
        kind,
      };
    }
    const members =
      (g.members || []).map((m) => m.label).filter(Boolean).join(", ") ||
      (g.member_keys || []).join(", ") ||
      "—";
    return {
      title: g.label,
      mode: "Équipe projet",
      who: g.lead_label || g.lead_agent_key || "Lead",
      team: members,
      context: g.description?.trim() || "Équipe dédiée — délégation limitée à ses membres (hors flotte Entreprise).",
      kind,
    };
  }
  return {
    title: "Interlocuteur",
    mode: "—",
    who: "—",
    team: "—",
    context: "",
    kind,
  };
}

export function parseInterlocutor(value: string): {
  agent: string;
  agentGroupId: string | null;
} {
  if (value.startsWith("group:")) {
    const id = value.slice(6);
    return { agent: "coordinateur", agentGroupId: id || null };
  }
  if (value === "coordinateur") {
    return { agent: "coordinateur", agentGroupId: ENTERPRISE_GROUP_ID };
  }
  return { agent: "assistant", agentGroupId: null };
}

/** Valeur de sélecteur à partir d'un id de groupe (flotte métier = CIO). */
export function interlocutorFromGroupId(groupId: string): string {
  const id = groupId.trim();
  if (!id || id === ENTERPRISE_GROUP_ID) return "coordinateur";
  return `group:${id}`;
}

function normalizeSelectValue(value: string): string {
  return value === `group:${ENTERPRISE_GROUP_ID}` ? "coordinateur" : value;
}

function SelectControl({
  value,
  onChange,
  groups,
  disabled,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  groups: GroupOpt[];
  disabled?: boolean;
  className?: string;
}) {
  const selectValue = normalizeSelectValue(value);
  const tone = IDENTITY_SELECT[identityFromInterlocutor(selectValue)];
  return (
    <select
      className={`h-8 min-w-0 max-w-[9.5rem] shrink truncate rounded-lg border px-1.5 text-[11px] font-semibold sm:max-w-[12rem] sm:px-2 sm:text-xs ${tone} ${className}`}
      value={selectValue}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Interlocuteur"
      title="Choisir à qui tu parles"
    >
      <option value="assistant">Assistant</option>
      <option value="coordinateur">{ENTERPRISE_ROLE_LABEL}</option>
      {groups
        .filter((g) => g.id !== ENTERPRISE_GROUP_ID && g.status !== "archived")
        .map((g) => (
          <option key={g.id} value={`group:${g.id}`}>
            Équipe · {g.label}
          </option>
        ))}
    </select>
  );
}

export default function ChatInterlocutorSelect({
  value,
  onChange,
  groups,
  disabled,
  variant = "compact",
  className = "",
}: Props) {
  const [open, setOpen] = useState(false);
  const info = useMemo(() => describeInterlocutor(value, groups), [value, groups]);

  if (variant === "compact") {
    return (
      <div className={`relative flex shrink-0 items-center gap-1 ${className}`}>
        <SelectControl value={value} onChange={onChange} groups={groups} disabled={disabled} />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${IDENTITY_ICON_BUTTON[info.kind]}`}
          aria-label="Détail interlocuteur"
          aria-expanded={open}
          title={`${info.title} — ${info.mode}`}
        >
          <span className="text-xs font-bold">i</span>
        </button>
        {open ? (
          <>
            <button
              type="button"
              className="fixed inset-0 z-40 cursor-default"
              aria-label="Fermer le détail"
              onClick={() => setOpen(false)}
            />
            <div
              className={`absolute right-0 top-9 z-50 w-[min(100vw-1.5rem,18rem)] rounded-xl border bg-white p-3 shadow-lg ${IDENTITY_BORDER[info.kind]}`}
            >
              <ContextCard info={info} />
            </div>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 ${IDENTITY_SELECT[info.kind]} ${className}`}>
      <div className="min-w-0 flex-1">
        <ContextCard info={info} dense />
      </div>
      <SelectControl
        value={value}
        onChange={onChange}
        groups={groups}
        disabled={disabled}
        className="max-w-[14rem] bg-white/80"
      />
    </div>
  );
}

function ContextCard({ info, dense }: { info: InterlocutorContext; dense?: boolean }) {
  return (
    <div className={dense ? "min-w-0" : "space-y-1.5 text-left"}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <p className={`font-bold text-slate-900 ${dense ? "text-xs" : "text-sm"}`}>{info.title}</p>
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tracking-wide ${IDENTITY_BADGE[info.kind]}`}>
          {info.mode}
        </span>
      </div>
      <p className={`text-slate-600 ${dense ? "truncate text-[11px]" : "text-xs"}`}>
        <span className="font-semibold text-slate-700">Qui : </span>
        {info.who}
      </p>
      <p className={`text-slate-600 ${dense ? "truncate text-[11px]" : "text-xs"}`}>
        <span className="font-semibold text-slate-700">Équipe : </span>
        {info.team}
      </p>
      {!dense ? <p className="text-xs leading-snug text-slate-500">{info.context}</p> : null}
      {dense ? (
        <p className="truncate text-[11px] text-slate-500" title={info.context}>
          {info.context}
        </p>
      ) : null}
    </div>
  );
}
