"use client";

import Link from "next/link";
import {
  decisionsHrefForJob,
  missionOrigin,
  missionPhase,
  originBadgeClass,
  phaseBadgeClass,
  resolveMissionPrimaryAction,
  ticketActionLabel,
  type InboxHint,
} from "../../lib/missionDailyUx";
import type { Job } from "../../lib/types";

type Props = {
  job: Job;
  inboxItems?: InboxHint[];
  hasPendingQuestions?: boolean;
  busy?: boolean;
  finishBusy?: boolean;
  onFinish: () => void;
  onApproveTicket?: (ticketId: string) => void;
  onFocusDecide?: () => void;
};

/**
 * Panneau « Prochaine action » — CTA métier (publier / agenda / envoyer / décider / terminer).
 */
export default function MissionNextActionPanel({
  job,
  inboxItems = [],
  hasPendingQuestions = false,
  busy = false,
  finishBusy = false,
  onFinish,
  onApproveTicket,
  onFocusDecide,
}: Props) {
  const origin = missionOrigin(job.source);
  const hasTicket = inboxItems.some((i) => i.kind === "action_ticket" && i.ticket_id);
  const phase = missionPhase(job, {
    hasActionTicket: hasTicket,
    hasPendingQuestions,
  });
  const action = resolveMissionPrimaryAction(job, inboxItems);
  const tickets = inboxItems.filter((i) => i.kind === "action_ticket" && i.ticket_id);
  const closed = Boolean(job.user_validated_at || job.mission_closed_by_user);
  const jobId = String(job.job_id || "");

  return (
    <section className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50/90 to-white p-4 shadow-sm ring-1 ring-violet-100">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${phaseBadgeClass(phase.id)}`}
        >
          {phase.label}
        </span>
        <span className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-semibold ${originBadgeClass(origin.id)}`}>
          {origin.label}
        </span>
        <h2 className="ml-auto text-xs font-semibold uppercase tracking-wide text-violet-800/80">
          Prochaine action
        </h2>
      </div>

      {closed ? (
        <p className="mt-3 text-sm text-emerald-900">Mission terminée — consultez les livrables ci-dessous.</p>
      ) : (
        <div className="mt-3 space-y-3">
          {tickets.length ? (
            <ul className="space-y-2">
              {tickets.map((t) => (
                <li
                  key={String(t.ticket_id)}
                  className="flex flex-col gap-2 rounded-xl border border-emerald-200 bg-white px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">
                      {ticketActionLabel(String(t.action_kind || ""), t.primary_cta)}
                    </p>
                    {t.title ? <p className="truncate text-xs text-slate-500">{t.title}</p> : null}
                  </div>
                  <button
                    type="button"
                    disabled={busy || !onApproveTicket}
                    onClick={() => onApproveTicket?.(String(t.ticket_id))}
                    className="shrink-0 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-40"
                  >
                    {busy ? "…" : ticketActionLabel(String(t.action_kind || ""), t.primary_cta)}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {!tickets.length && action.type === "open_decide" ? (
            <button
              type="button"
              onClick={() => onFocusDecide?.()}
              className="w-full rounded-xl bg-violet-800 px-4 py-3 text-sm font-semibold text-white hover:bg-violet-900"
            >
              {action.label}
            </button>
          ) : null}

          {!tickets.length && action.type === "open_href" ? (
            <Link
              href={action.href}
              className="flex w-full items-center justify-center rounded-xl bg-violet-800 px-4 py-3 text-sm font-semibold text-white hover:bg-violet-900"
            >
              {action.label}
            </Link>
          ) : null}

          {!tickets.length && action.type === "finish" ? (
            <button
              type="button"
              disabled={finishBusy}
              onClick={onFinish}
              className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
            >
              {finishBusy ? "…" : "Terminer la mission"}
            </button>
          ) : null}

          {action.type === "none" && !tickets.length ? (
            <p className="text-sm text-slate-600">
              {phase.id === "running"
                ? "L’équipe travaille — vous serez sollicité dès qu’une décision ou une publication sera prête."
                : "Aucune action immédiate. Ouvrez le dossier pour le détail."}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2 pt-1">
            {!closed && phase.id !== "ready" && phase.id !== "act" ? (
              <button
                type="button"
                disabled={finishBusy}
                onClick={onFinish}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                Terminer
              </button>
            ) : null}
            {origin.id === "studio" ? (
              <Link
                href="/gestion/studio"
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Studio
              </Link>
            ) : null}
            <Link
              href="/gestion/planning"
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Agenda
            </Link>
            <Link
              href={decisionsHrefForJob(jobId)}
              className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-900 hover:bg-violet-100"
            >
              À valider
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}
