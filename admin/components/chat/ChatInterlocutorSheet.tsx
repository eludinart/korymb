"use client";

import { useMemo } from "react";
import RecentInterlocutorPicks from "../RecentInterlocutorPicks";
import {
  ENTERPRISE_GROUP_ID,
  ENTERPRISE_ROLE_LABEL,
  IDENTITY_BADGE,
  IDENTITY_CARD,
  identityFromInterlocutor,
} from "../../lib/agentGroupUi";
import { describeInterlocutor, type GroupOpt } from "./ChatInterlocutorSelect";
import ChatBottomSheet from "./ChatBottomSheet";

type Props = {
  open: boolean;
  onClose: () => void;
  value: string;
  onChange: (v: string) => void;
  groups: GroupOpt[];
  disabled?: boolean;
};

function optionButtonClass(active: boolean) {
  return `w-full rounded-2xl border px-4 py-3.5 text-left transition-colors ${
    active
      ? "border-violet-400 bg-violet-50 ring-2 ring-violet-200"
      : "border-slate-200 bg-white active:bg-slate-50"
  }`;
}

/** Sheet mobile : choisir Assistant / Chef d'orchestre / équipe projet. */
export default function ChatInterlocutorSheet({
  open,
  onClose,
  value,
  onChange,
  groups,
  disabled,
}: Props) {
  const info = useMemo(() => describeInterlocutor(value, groups), [value, groups]);
  const projectGroups = useMemo(
    () => groups.filter((g) => g.id !== ENTERPRISE_GROUP_ID && g.status !== "archived"),
    [groups],
  );

  const pick = (next: string) => {
    if (disabled) return;
    onChange(next);
    onClose();
  };

  return (
    <ChatBottomSheet open={open} onClose={onClose} title="À qui parler ?" tall>
      <div className={`mb-3 rounded-2xl border px-3 py-2.5 ${IDENTITY_CARD[info.kind]}`}>
        <div className="flex flex-wrap items-baseline gap-2">
          <p className="text-sm font-bold text-slate-900">{info.title}</p>
          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${IDENTITY_BADGE[info.kind]}`}>
            {info.mode}
          </span>
        </div>
        <p className="mt-1 text-xs text-slate-600">
          <span className="font-semibold text-slate-700">Qui : </span>
          {info.who}
        </p>
        <p className="mt-0.5 text-xs text-slate-600">
          <span className="font-semibold text-slate-700">Équipe : </span>
          {info.team}
        </p>
      </div>

      <RecentInterlocutorPicks
        current={value === `group:${ENTERPRISE_GROUP_ID}` ? "coordinateur" : value}
        onPick={pick}
        disabled={disabled}
        className="mb-3"
      />

      <div className="space-y-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => pick("assistant")}
          className={optionButtonClass(value === "assistant" || identityFromInterlocutor(value) === "assistant")}
        >
          <p className="text-[15px] font-bold text-slate-900">Assistant</p>
          <p className="mt-0.5 text-xs text-slate-500">Conversation libre — clarifier avant d&apos;agir</p>
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={() => pick("coordinateur")}
          className={optionButtonClass(
            value === "coordinateur" || value === `group:${ENTERPRISE_GROUP_ID}`,
          )}
        >
          <p className="text-[15px] font-bold text-slate-900">
            Entreprise — {ENTERPRISE_ROLE_LABEL}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">Flotte métier · validations avant envoi</p>
        </button>

        {projectGroups.map((g) => {
          const v = `group:${g.id}`;
          return (
            <button
              key={g.id}
              type="button"
              disabled={disabled}
              onClick={() => pick(v)}
              className={optionButtonClass(value === v)}
            >
              <p className="text-[15px] font-bold text-slate-900">{g.label}</p>
              <p className="mt-0.5 truncate text-xs text-slate-500">
                {g.lead_label || g.lead_agent_key || "Lead"}
                {g.description ? ` · ${g.description}` : ""}
              </p>
            </button>
          );
        })}
      </div>
    </ChatBottomSheet>
  );
}
