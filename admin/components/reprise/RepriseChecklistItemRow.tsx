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

type RepriseRowAction = "validated" | "noted" | "deferred" | "ignored";

type Props = {
  domainId: string;
  itemText: string;
  variant: "missing" | "covered" | "deferred" | "ignored";
  suggestedAgents: string[];
  userAction?: RepriseItemAction;
  selected: boolean;
  busy: boolean;
  onToggleSelect: () => void;
  onAction: (action: RepriseRowAction, note: string) => void | Promise<void>;
  onLaunchAgents: (note: string) => void;
  onCreateMission: (note: string) => void;
  onReopen?: () => void | Promise<void>;
};

const ACTION_BADGE: Record<RepriseItemActionKind, string> = {
  validated: "bg-emerald-100 text-emerald-800",
  noted: "bg-sky-100 text-sky-800",
  deferred: "bg-amber-100 text-amber-800",
  ignored: "bg-slate-200 text-slate-600",
  mission_pending: "bg-violet-100 text-violet-800",
  agent_launched: "bg-indigo-100 text-indigo-900",
};

const PASSIVE_BADGE: Record<"deferred" | "ignored", string> = {
  deferred: "Reporté",
  ignored: "Ignoré",
};

function memoryLabels(keys: string[]) {
  return keys
    .map((k) => MEMORY_CONTEXT_TITLES[k as MemoryContextKey] || k)
    .join(" · ");
}

export default function RepriseChecklistItemRow({
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
  onReopen,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState(userAction?.note || "");
  const [exiting, setExiting] = useState(false);

  const actionKind = userAction?.action;
  const memoryKeys = memoryContextKeysForAgents(suggestedAgents);
  const isRelaunch =
    variant === "covered" ||
    actionKind === "validated" ||
    actionKind === "noted" ||
    actionKind === "agent_launched" ||
    actionKind === "deferred";
  const canSelect = actionKind !== "mission_pending" && variant !== "ignored" && variant !== "deferred";
  const isPassive =
    variant === "ignored" || variant === "deferred" || actionKind === "ignored";

  const runQuickAction = async (action: "deferred" | "ignored") => {
    setExiting(true);
    try {
      await onAction(action, note.trim());
    } catch {
      setExiting(false);
    }
  };

  return (
    <li
      className={`group relative list-none rounded-2xl border-2 transition-all duration-300 ease-out ${
        exiting ? "pointer-events-none scale-[0.98] opacity-0" : "scale-100 opacity-100"
      } ${
        variant === "missing"
          ? "border-amber-200/90 bg-white shadow-sm"
          : variant === "ignored"
            ? "border-slate-200 bg-slate-50/90"
            : variant === "deferred"
              ? "border-dashed border-slate-300 bg-slate-50/60"
              : "border-emerald-200/70 bg-white/80 shadow-sm"
      }`}
    >
      <div className="p-3 sm:p-4">
        {!isPassive ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void runQuickAction("ignored")}
            className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-base leading-none text-slate-500 opacity-100 shadow-sm transition hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:opacity-50 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
            aria-label="Ne pas traiter ce point"
            title="Ne pas traiter — hors périmètre"
          >
            ×
          </button>
        ) : null}

        <div className={`flex flex-col gap-3 sm:flex-row sm:items-start ${!isPassive ? "sm:pr-8" : ""}`}>
          <div className="flex min-w-0 flex-1 items-start gap-2">
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
              {isPassive && (variant === "deferred" || variant === "ignored") ? (
                <span
                  className={`mb-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ${
                    variant === "deferred" ? "bg-amber-100 text-amber-800" : "bg-slate-200 text-slate-600"
                  }`}
                >
                  {PASSIVE_BADGE[variant]}
                </span>
              ) : null}
              <p
                className={`text-sm font-semibold leading-snug sm:text-base ${
                  variant === "ignored" ? "text-slate-500 line-through" : "text-slate-900"
                }`}
              >
                {itemText}
              </p>
              {suggestedAgents.length > 0 && !isPassive ? (
                <p className="mt-1 text-xs text-slate-500">Agents : {suggestedAgents.join(", ")}</p>
              ) : null}
              {actionKind && !isPassive ? (
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
          </div>

          {!isPassive ? (
            <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:min-w-[9.5rem]">
              <button
                type="button"
                disabled={busy}
                onClick={() => setExpanded((v) => !v)}
                className="btn-primary w-full px-4 py-2 text-sm"
              >
                {expanded ? "Réduire" : "Agir"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void runQuickAction("deferred")}
                className="btn-secondary w-full px-3 py-2 text-xs"
                title="Reporter sans lancer d'action"
              >
                Pas maintenant
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void onReopen?.()}
              className="btn-link-secondary w-full shrink-0 text-center text-xs sm:w-auto"
            >
              Réafficher
            </button>
          )}
        </div>

        {expanded && !isPassive ? (
          <div className="mt-4 space-y-3 border-t-2 border-violet-100 pt-4">
            <p className="text-xs text-slate-600">Alimente la mémoire : {memoryLabels(memoryKeys)}</p>
            <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">
              Précisions pour les agents et la mémoire entreprise
            </label>
            <textarea
              value={note}
              disabled={busy}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Ex. : registre RGPD à jour chez l'avocat, relance prévue semaine prochaine…"
              className="field-input w-full text-sm"
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
            </div>
            <p className="text-xs text-slate-500">
              Ce point ne vous concerne pas ? Utilisez{" "}
              <button
                type="button"
                disabled={busy}
                onClick={() => void runQuickAction("ignored")}
                className="font-semibold text-slate-700 underline hover:text-red-700"
              >
                Ne pas traiter
              </button>{" "}
              ou{" "}
              <button
                type="button"
                disabled={busy}
                onClick={() => void runQuickAction("deferred")}
                className="font-semibold text-slate-700 underline hover:text-amber-800"
              >
                Pas maintenant
              </button>
              .
            </p>
          </div>
        ) : null}
      </div>
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
