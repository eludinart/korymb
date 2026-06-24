"use client";

import type { InboxActionItem } from "./InboxActionCard";
import { formatDaysOpen, formatInboxDate, urgencyLabel } from "../../lib/inboxDisplay";

const urgencyClass: Record<string, string> = {
  ok: "bg-emerald-500",
  warning: "bg-amber-500",
  critical: "bg-red-600",
};

type Props = {
  item: InboxActionItem;
};

export default function InboxMetaStrip({ item }: Props) {
  const urgency = item.urgency || "ok";
  const overdueText = urgencyLabel(item.urgency, item.days_overdue);
  const priorityRank = item.priority_rank ?? (Number(item.priority_score ?? 9) + 1);

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] font-medium text-slate-600">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 font-bold text-slate-700 ring-1 ring-slate-200">
        <span className={`h-2 w-2 shrink-0 rounded-full ${urgencyClass[urgency] || urgencyClass.ok}`} aria-hidden />
        P{priorityRank}
      </span>
      <span title="Date d'apparition dans votre inbox">
        Depuis le {formatInboxDate(item.created_at || item.updated_at)}
      </span>
      <span className="text-slate-500">·</span>
      <span title="Temps d'attente de votre décision">En attente : {formatDaysOpen(item.days_open)}</span>
      {overdueText ? (
        <>
          <span className="text-slate-500">·</span>
          <span
            className={
              urgency === "critical"
                ? "font-bold text-red-700"
                : urgency === "warning"
                  ? "font-bold text-amber-800"
                  : "text-slate-600"
            }
          >
            {overdueText}
          </span>
        </>
      ) : null}
      {item.progress_label ? (
        <>
          <span className="hidden text-slate-500 sm:inline">·</span>
          <span className="w-full text-slate-500 sm:w-auto">{item.progress_label}</span>
        </>
      ) : null}
      {item.status ? (
        <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500 ring-1 ring-slate-200">
          {item.status.replace(/_/g, " ")}
        </span>
      ) : null}
    </div>
  );
}
