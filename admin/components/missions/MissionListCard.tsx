"use client";

import AgentMessageMarkdown from "../AgentMessageMarkdown";
import MissionStatusBadge from "../MissionStatusBadge";
import SimpleAccordion from "../SimpleAccordion";
import { bestPreview } from "../../lib/missionBilan";
import { BTN_DELETE } from "../../lib/deleteMissionBundle";

import type { Job } from "../../lib/types";

type Props = {
  job: Job;
  /** Continuation la plus récente de ce job (résultat à privilégier en preview). */
  latestChild?: Job;
  busy: boolean;
  deleteBusy?: boolean;
  onSelect: (jobId: string) => void;
  onValidate: (jobId: string, mission?: string | null) => void;
  onClose: (jobId: string, mission?: string | null) => void;
  onDelete: (jobId: string, mission?: string | null) => void;
};

/** Carte mission de la liste /missions : statut, brief, bilan CIO, actions valider/clôturer. */
export default function MissionListCard({
  job: j,
  latestChild,
  busy,
  deleteBusy = false,
  onSelect,
  onValidate,
  onClose,
  onDelete,
}: Props) {
  const closed = j.user_validated_at || j.mission_closed_by_user;
  const st = String(j.status || "");
  const canValidate = st === "completed" && !closed;
  const canCloseFromList = !closed && st !== "cancelled" && !canValidate;
  const bestResultSource = latestChild ?? j;
  const previewText = bestPreview(String(bestResultSource.result || "").trim(), 25);

  return (
    <div
      role="button"
      tabIndex={0}
      className="min-w-0 cursor-pointer rounded-2xl border border-slate-200 bg-white p-4 transition-shadow hover:border-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500"
      onClick={() => onSelect(j.job_id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(j.job_id);
        }
      }}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="min-w-0 w-full flex-1 space-y-2 sm:w-auto">
          <div className="flex flex-wrap items-center gap-2">
            <MissionStatusBadge status={j.status} />
            {canValidate ? (
              <span className="rounded-md bg-violet-900 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                À valider
              </span>
            ) : null}
          </div>
          <div className="max-h-52 min-h-0 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50/95 p-2.5 text-left shadow-inner">
            {j.mission?.trim() ? (
              <AgentMessageMarkdown
                source={j.mission}
                className="text-xs [&_blockquote]:my-1 [&_blockquote]:py-1 [&_h1]:mb-1 [&_h1]:mt-0 [&_h1]:border-0 [&_h1]:pb-0 [&_h1]:text-[13px] [&_h2]:mb-1 [&_h2]:mt-2 [&_h2]:text-xs [&_h3]:text-[11px] [&_li]:my-0 [&_li]:text-[11px] [&_ol]:my-1 [&_p]:mb-1 [&_p]:text-[11px] [&_ul]:my-1"
              />
            ) : (
              <p className="text-xs font-medium text-slate-500">(mission sans titre)</p>
            )}
          </div>
          <p className="text-xs text-slate-500">{j.agent || "coordinateur"}</p>
          {previewText ? (
            <SimpleAccordion
              title="Bilan CIO"
              defaultOpen={false}
              className="min-h-0 rounded-lg border border-slate-100 bg-white text-left"
              triggerClassName="px-2.5 py-2"
              panelClassName="border-t border-slate-100 px-2.5 pb-2.5 pt-2"
            >
              <AgentMessageMarkdown
                source={previewText}
                className="text-[11px] [&_h1]:mb-1 [&_h1]:text-[11px] [&_h2]:mb-1 [&_h2]:text-[11px] [&_h3]:text-[11px] [&_li]:text-[10px] [&_li]:my-0.5 [&_p]:mb-1 [&_p]:text-[11px] [&_ul]:my-1"
              />
            </SimpleAccordion>
          ) : (
            <p className="text-xs text-slate-400">Pas encore de synthèse disponible.</p>
          )}
        </div>
        <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto">
          {canValidate ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onValidate(j.job_id, j.mission);
              }}
              disabled={busy || deleteBusy}
              className="min-h-[44px] w-full rounded-lg bg-violet-900 px-3 py-2.5 text-xs font-semibold text-white disabled:opacity-40 sm:w-auto"
            >
              {busy ? "Validation…" : "Valider"}
            </button>
          ) : canCloseFromList ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClose(j.job_id, j.mission);
              }}
              disabled={busy || deleteBusy}
              className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-xs font-semibold text-slate-800 disabled:opacity-40 sm:w-auto"
            >
              {busy ? "Clôture…" : "Clôturer"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDelete(j.job_id, j.mission);
            }}
            disabled={busy || deleteBusy}
            className={`min-h-[44px] w-full sm:w-auto ${BTN_DELETE}`}
          >
            {deleteBusy ? "Suppression…" : "Supprimer"}
          </button>
        </div>
      </div>
    </div>
  );
}
