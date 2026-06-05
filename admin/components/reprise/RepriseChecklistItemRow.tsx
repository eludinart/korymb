"use client";

import Link from "next/link";
import { useState } from "react";
import {
  MEMORY_CONTEXT_TITLES,
  type MemoryContextKey,
} from "../../lib/agentMemory";
import {
  REPRISE_ACTION_LABELS,
  memoryContextKeysForAgents,
  repriseItemKey,
  type RepriseItemAction,
  type RepriseItemActionKind,
} from "../../lib/repriseCoverage";

type Props = {
  domainId: string;
  itemText: string;
  variant: "missing" | "covered";
  suggestedAgents: string[];
  userAction?: RepriseItemAction;
  selected: boolean;
  busy: boolean;
  onToggleSelect: () => void;
  onAction: (action: "validated" | "noted" | "deferred", note: string) => void;
  onLaunchAgents: (note: string) => void;
  onCreateMission: (note: string) => void;
};

const ACTION_BADGE: Record<RepriseItemActionKind, string> = {
  validated: "bg-emerald-100 text-emerald-800",
  noted: "bg-sky-100 text-sky-800",
  deferred: "bg-slate-200 text-slate-700",
  mission_pending: "bg-violet-100 text-violet-800",
  agent_launched: "bg-indigo-100 text-indigo-900",
};

function memoryLabels(keys: string[]) {
  return keys
    .map((k) => MEMORY_CONTEXT_TITLES[k as MemoryContextKey] || k)
    .join(" · ");
}

export default function RepriseChecklistItemRow({
  domainId,
  itemText,
  variant,
  suggestedAgents,
  userAction,
  selected,
  busy,
  onToggleSelect,
  onAction,
  onLaunchAgents,
  onCreateMission,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState(userAction?.note || "");

  const actionKind = userAction?.action;
  const memoryKeys = memoryContextKeysForAgents(suggestedAgents);
  const isRelaunch =
    variant === "covered" ||
    actionKind === "validated" ||
    actionKind === "noted" ||
    actionKind === "agent_launched" ||
    actionKind === "deferred";
  const canSelect = actionKind !== "mission_pending";

  return (
    <li
      className={`rounded-xl border px-3 py-2.5 ${
        variant === "missing" ? "border-amber-200/80 bg-white/60" : "border-emerald-200/60 bg-white/40"
      }`}
    >
      <div className="flex flex-wrap items-start gap-2">
        {canSelect ? (
          <input
            type="checkbox"
            checked={selected}
            disabled={busy}
            onChange={onToggleSelect}
            className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300"
            aria-label={`Sélectionner ${itemText}`}
          />
        ) : (
          <span className="mt-1 inline-block h-4 w-4 shrink-0" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug">{itemText}</p>
          {suggestedAgents.length > 0 ? (
            <p className="mt-1 text-xs text-slate-500">
              Agents : {suggestedAgents.join(", ")}
            </p>
          ) : null}
          {actionKind ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-bold ${ACTION_BADGE[actionKind]}`}
              >
                {REPRISE_ACTION_LABELS[actionKind]}
              </span>
              {userAction?.note ? (
                <span className="text-xs text-slate-600">{userAction.note}</span>
              ) : null}
              {actionKind === "mission_pending" && userAction?.output_id ? (
                <Link
                  href="/administration/approbations"
                  className="text-xs font-semibold text-violet-800 underline"
                >
                  Voir l&apos;approbation
                </Link>
              ) : null}
              {actionKind === "agent_launched" && userAction?.output_id ? (
                <Link
                  href={`/missions?job=${encodeURIComponent(userAction.output_id)}`}
                  className="text-xs font-semibold text-indigo-800 underline"
                >
                  Suivre la mission #{userAction.output_id}
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {expanded ? "Fermer" : "Agir"}
        </button>
      </div>

      {expanded ? (
        <div className="mt-3 space-y-2 border-t border-slate-200/80 pt-3 pl-6">
          <p className="text-xs text-slate-600">
            Alimente la mémoire : {memoryLabels(memoryKeys)}
          </p>
          <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">
            Précisions pour les agents et la mémoire entreprise
          </label>
          <textarea
            value={note}
            disabled={busy}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="Ex. : registre RGPD à jour chez l'avocat, relance prévue semaine prochaine…"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => onLaunchAgents(note.trim())}
              className="rounded-lg bg-indigo-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-800 disabled:opacity-50"
            >
              {isRelaunch ? "Relancer les agents" : "Lancer les agents"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onAction("validated", note.trim())}
              className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              Valider comme traité
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onAction("noted", note.trim())}
              className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-bold text-sky-900 hover:bg-sky-100 disabled:opacity-50"
            >
              Enregistrer l&apos;info
            </button>
            {variant === "missing" ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => onCreateMission(note.trim())}
                className="rounded-lg border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-bold text-violet-900 hover:bg-violet-100 disabled:opacity-50"
              >
                Proposer (approbation)
              </button>
            ) : null}
            <button
              type="button"
              disabled={busy}
              onClick={() => onAction("deferred", note.trim())}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Reporter
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

export function getUserAction(
  userActions: Record<string, RepriseItemAction> | undefined,
  domainId: string,
  itemText: string,
) {
  return userActions?.[repriseItemKey(domainId, itemText)];
}
