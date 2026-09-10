"use client";

import Link from "next/link";
import { useState } from "react";
import { BTN_DELETE } from "../../lib/deleteMissionBundle";
import {
  decisionsHrefForJob,
  missionCardTitle,
  missionOrigin,
  missionPhase,
  originBadgeClass,
  phaseBadgeClass,
  resolveMissionPrimaryAction,
  type InboxHint,
  type MissionPrimaryAction,
} from "../../lib/missionDailyUx";
import type { Job } from "../../lib/types";

type Props = {
  job: Job;
  inboxItems?: InboxHint[];
  busy: boolean;
  deleteBusy?: boolean;
  actionBusy?: boolean;
  onSelect: (jobId: string) => void;
  onFinish: (jobId: string, mission?: string | null) => void;
  onDelete: (jobId: string, mission?: string | null) => void;
  onApproveTicket?: (ticketId: string) => void;
};

function PrimaryButton({
  action,
  busy,
  disabled,
  onSelect,
  onFinish,
  onApproveTicket,
  jobId,
  mission,
}: {
  action: MissionPrimaryAction;
  busy: boolean;
  disabled: boolean;
  onSelect: (id: string) => void;
  onFinish: (id: string, mission?: string | null) => void;
  onApproveTicket?: (ticketId: string) => void;
  jobId: string;
  mission?: string | null;
}) {
  if (action.type === "none") {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(jobId);
        }}
        className="min-h-[40px] w-full rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40 sm:w-auto"
      >
        Ouvrir
      </button>
    );
  }

  if (action.type === "open_href") {
    return (
      <Link
        href={action.href}
        onClick={(e) => e.stopPropagation()}
        className="inline-flex min-h-[40px] w-full items-center justify-center rounded-lg bg-violet-800 px-3 py-2 text-center text-xs font-semibold text-white hover:bg-violet-900 sm:w-auto"
      >
        {action.label}
      </Link>
    );
  }

  if (action.type === "approve_ticket") {
    return (
      <button
        type="button"
        disabled={disabled || !onApproveTicket}
        onClick={(e) => {
          e.stopPropagation();
          onApproveTicket?.(action.ticketId);
        }}
        className="min-h-[40px] w-full rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-40 sm:w-auto"
      >
        {busy ? "…" : action.label}
      </button>
    );
  }

  if (action.type === "finish") {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          onFinish(jobId, mission);
        }}
        className="min-h-[40px] w-full rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40 sm:w-auto"
      >
        {busy ? "…" : action.label}
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(jobId);
      }}
      className="min-h-[40px] w-full rounded-lg bg-violet-800 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-900 disabled:opacity-40 sm:w-auto"
    >
      {action.label}
    </button>
  );
}

/** Carte mission compacte : titre · phase · CTA primaire. */
export default function MissionListCard({
  job: j,
  inboxItems = [],
  busy,
  deleteBusy = false,
  actionBusy = false,
  onSelect,
  onFinish,
  onDelete,
  onApproveTicket,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const origin = missionOrigin(j.source);
  const ticketHint = inboxItems.some((i) => i.kind === "action_ticket" && i.ticket_id);
  const phase = missionPhase(j, {
    hasActionTicket: ticketHint,
    hasPendingQuestions: inboxItems.some((i) => i.kind === "cio_question"),
  });
  const action = resolveMissionPrimaryAction(j, inboxItems);
  const title = missionCardTitle(j.mission, 88);
  const disabled = busy || deleteBusy || actionBusy;
  const ring =
    phase.id === "act"
      ? "border-emerald-400 ring-2 ring-emerald-200/80"
      : phase.id === "decide"
        ? "border-violet-400 ring-2 ring-violet-200/70"
        : phase.id === "running"
          ? "border-amber-300 ring-1 ring-amber-100"
          : "border-slate-200";

  return (
    <div
      role="button"
      tabIndex={0}
      className={`min-w-0 cursor-pointer rounded-2xl border bg-white p-3.5 shadow-sm transition-shadow hover:border-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500 ${ring}`}
      onClick={() => onSelect(j.job_id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(j.job_id);
        }
      }}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${phaseBadgeClass(phase.id)}`}
            >
              {phase.label}
            </span>
            <span
              className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-semibold ${originBadgeClass(origin.id)}`}
            >
              {origin.label}
            </span>
          </div>
          <p className="truncate text-sm font-semibold text-slate-900" title={title}>
            {title}
          </p>
          <p className="text-[11px] text-slate-500">
            {j.agent || "coordinateur"}
            {action.type === "approve_ticket" ? " · action prête" : null}
          </p>
        </div>

        <div className="flex w-full shrink-0 items-stretch gap-2 sm:w-auto sm:items-center">
          <PrimaryButton
            action={action}
            busy={busy || actionBusy}
            disabled={disabled}
            onSelect={onSelect}
            onFinish={onFinish}
            onApproveTicket={onApproveTicket}
            jobId={j.job_id}
            mission={j.mission}
          />
          <div className="relative">
            <button
              type="button"
              aria-label="Plus d’actions"
              aria-expanded={menuOpen}
              disabled={disabled}
              className="min-h-[40px] rounded-lg border border-slate-200 bg-white px-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }}
            >
              ⋯
            </button>
            {menuOpen ? (
              <div
                className="absolute right-0 z-20 mt-1 w-48 rounded-xl border border-slate-200 bg-white p-1 shadow-lg"
                onClick={(e) => e.stopPropagation()}
              >
                <Link
                  href={decisionsHrefForJob(j.job_id)}
                  className="block rounded-lg px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  onClick={() => setMenuOpen(false)}
                >
                  Voir dans Décisions
                </Link>
                {origin.id === "studio" ? (
                  <Link
                    href="/gestion/studio"
                    className="block rounded-lg px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    onClick={() => setMenuOpen(false)}
                  >
                    Ouvrir le Studio
                  </Link>
                ) : null}
                <button
                  type="button"
                  className={`mt-0.5 w-full rounded-lg px-3 py-2 text-left text-xs font-semibold ${BTN_DELETE}`}
                  disabled={disabled}
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete(j.job_id, j.mission);
                  }}
                >
                  {deleteBusy ? "Suppression…" : "Supprimer"}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
