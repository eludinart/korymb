"use client";

import { useMemo, useState } from "react";

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
};

export function describeInterlocutor(value: string, groups: GroupOpt[]): InterlocutorContext {
  if (value === "assistant") {
    return {
      title: "Assistant",
      mode: "Conversation libre",
      who: "Copilote généraliste (pas le CIO)",
      team: "Aucune — exploration & cadrage",
      context: "Répond à tes questions, brainstorm, plans. Propose une équipe seulement si tu le demandes.",
    };
  }
  if (value === "coordinateur" || value === "group:entreprise") {
    const ent = groups.find((g) => g.id === "entreprise");
    const members =
      (ent?.members || []).map((m) => m.label).filter(Boolean).join(", ") ||
      (ent?.member_keys || []).join(", ") ||
      "Commercial, CM, Dev, Comptable";
    return {
      title: "CIO — Entreprise",
      mode: "Exécution métier",
      who: ent?.lead_label || "CIO (orchestrateur)",
      team: members,
      context:
        ent?.description ||
        "Flotte métier par défaut : prospection, contenus, tech, devis — avec validations HITL.",
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
    };
  }
  return {
    title: "Interlocuteur",
    mode: "—",
    who: "—",
    team: "—",
    context: "",
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
    return { agent: "coordinateur", agentGroupId: "entreprise" };
  }
  return { agent: "assistant", agentGroupId: null };
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
  return (
    <select
      className={`h-8 min-w-0 max-w-[9.5rem] shrink truncate rounded-lg border border-violet-200 bg-white px-1.5 text-[11px] font-semibold text-slate-800 sm:max-w-[12rem] sm:px-2 sm:text-xs ${className}`}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Interlocuteur"
      title="Choisir à qui tu parles"
    >
      <option value="assistant">Assistant</option>
      <option value="coordinateur">CIO · Entreprise</option>
      {groups
        .filter((g) => g.id !== "entreprise" && g.status !== "archived")
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
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
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
            <div className="absolute right-0 top-9 z-50 w-[min(100vw-1.5rem,18rem)] rounded-xl border border-violet-200 bg-white p-3 shadow-lg">
              <ContextCard info={info} />
            </div>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2 ${className}`}>
      <div className="min-w-0 flex-1">
        <ContextCard info={info} dense />
      </div>
      <SelectControl
        value={value}
        onChange={onChange}
        groups={groups}
        disabled={disabled}
        className="max-w-[14rem]"
      />
    </div>
  );
}

function ContextCard({ info, dense }: { info: InterlocutorContext; dense?: boolean }) {
  return (
    <div className={dense ? "min-w-0" : "space-y-1.5 text-left"}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <p className={`font-bold text-slate-900 ${dense ? "text-xs" : "text-sm"}`}>{info.title}</p>
        <span className="rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-800">
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
