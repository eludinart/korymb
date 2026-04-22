"use client";

import Link from "next/link";
import AgentMessageMarkdown from "./AgentMessageMarkdown";
import CioResultPanel from "./CioResultPanel";
import MissionDeliverablesPanel from "./MissionDeliverablesPanel";
import LiveAgentInteractionStrip from "./LiveAgentInteractionStrip";
import CollapsibleMissionSection from "./CollapsibleMissionSection";
import SimpleAccordion from "./SimpleAccordion";
import MissionEventTimeline from "./MissionEventTimeline";
import MissionMetricsRow from "./MissionMetricsRow";
import SessionCadrageTimeline from "./SessionCadrageTimeline";
import CioPlanHitlPanel from "./CioPlanHitlPanel";
import { normalizeTeamRows, teamRowKey } from "../lib/jobTeam";
import { deliverablesMarkdownFromJob } from "../lib/missionDeliverablesMarkdown";
import type { DeliverablesUiState, LatestChatFollowup } from "../lib/types";

export type MissionJobLivePayload = {
  job_id?: string;
  mission?: string;
  status?: string;
  agent?: string;
  result?: string | null;
  tokens_total?: number;
  cost_usd?: number;
  events_total?: number;
  log_total?: number;
  events?: unknown[];
  mission_thread?: unknown[];
  team?: unknown;
  logs?: string[];
  hitl?: Record<string, unknown> | null;
  latest_chat_followup?: LatestChatFollowup | null;
  deliverables_ui?: DeliverablesUiState;
  user_validated_at?: string | null;
  mission_closed_by_user?: boolean;
};

type LiveQuerySlice = {
  data?: MissionJobLivePayload;
  isLoading: boolean;
  isError: boolean;
};

export type MissionJobLiveDetailProps = {
  jobId: string;
  /** Texte affiché dans le bloc « Votre consigne » ; si absent, on utilise `data.mission` quand pertinent. */
  missionPrompt?: string;
  agentFallback?: string;
  agentLabelMap: Record<string, string>;
  live: LiveQuerySlice;
  onRequestCancel?: () => void;
  cancelBusy?: boolean;
  /** Libellé du titre (ex. « Suivi mission » vs « Détail mission »). */
  title?: string;
  /** Après PUT notes/acceptations livrables (ex. invalider la query React). */
  onDeliverablesSaved?: () => void;
};

export default function MissionJobLiveDetail({
  jobId,
  missionPrompt,
  agentFallback = "coordinateur",
  agentLabelMap,
  live,
  onRequestCancel,
  cancelBusy = false,
  title = "Suivi mission",
  onDeliverablesSaved,
}: MissionJobLiveDetailProps) {
  const d = live.data;
  const st = String(d?.status || "").toLowerCase();
  const canCancelMission = Boolean(jobId && (st === "running" || st === "pending" || st === "awaiting_validation"));
  const hitlGate = d?.hitl as { gate?: { kind?: string } } | undefined;
  const showCioPlanHitl =
    st === "awaiting_validation" && String(hitlGate?.gate?.kind || "") === "cio_plan" && Boolean(d?.hitl);
  const consigne =
    (missionPrompt && missionPrompt.trim()) || (typeof d?.mission === "string" ? d.mission.trim() : "");

  return (
    <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <p className="text-sm font-semibold text-slate-900">
            {title} #{jobId}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Statut : {String(d?.status || "…")} · Agent : {String(d?.agent || agentFallback)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canCancelMission && onRequestCancel ? (
            <button
              type="button"
              onClick={() => void onRequestCancel()}
              disabled={cancelBusy}
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-100 disabled:opacity-40"
            >
              {cancelBusy ? "Arrêt…" : "Stopper la mission"}
            </button>
          ) : null}
          <Link
            href={`/missions?job=${encodeURIComponent(jobId)}`}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-violet-900 hover:bg-violet-50"
          >
            Panneau mission
          </Link>
        </div>
      </div>
      {live.isLoading ? <p className="text-sm text-slate-400">Chargement du fil mission…</p> : null}
      {live.isError ? <p className="text-sm text-red-700">Impossible de charger le suivi.</p> : null}
      {d ? (
        <div className="space-y-4">
          {st.startsWith("error") ? (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900"
            >
              <p className="font-semibold">Mission en erreur</p>
              <p className="mt-1 text-xs leading-relaxed text-red-800">
                La synthèse ci-dessous reprend le message d&apos;échec renvoyé par le serveur ; le journal d&apos;exécution
                contient la trace complète.
              </p>
            </div>
          ) : null}
          {consigne ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50/90 px-3 py-2 text-left">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Consigne mission</p>
              <div className="mt-1 text-sm leading-relaxed text-slate-800">
                <AgentMessageMarkdown source={consigne} />
              </div>
            </div>
          ) : null}
          {showCioPlanHitl ? <CioPlanHitlPanel jobId={jobId} hitl={d.hitl as Record<string, unknown>} /> : null}
          <LiveAgentInteractionStrip events={d.events} agentLabelMap={agentLabelMap} />
          <CioResultPanel
            result={d.result}
            missionTitle={d.mission}
            jobLine={`#${d.job_id} · ${d.agent} · ${d.status}`}
          />
          {(() => {
            const { markdown, team } = deliverablesMarkdownFromJob(d);
            return (
              <MissionDeliverablesPanel
                jobId={jobId}
                resultMarkdown={markdown}
                team={team}
                deliverablesUi={d.deliverables_ui}
                missionClosed={Boolean(d.user_validated_at || d.mission_closed_by_user)}
                canValidateMission={false}
                onSaved={onDeliverablesSaved}
              />
            );
          })()}
          <MissionMetricsRow
            status={d.status}
            tokensTotal={Number(d.tokens_total || 0)}
            costUsd={Number(d.cost_usd ?? 0)}
            eventsTotal={Number(d.events_total || 0)}
            logTotal={Number(d.log_total || 0)}
          />
          <SessionCadrageTimeline
            messages={d.mission_thread}
            title="Fil de cadrage avec le CIO (contexte)"
            maxHeightClass="max-h-[min(24rem,48vh)]"
          />
          <CollapsibleMissionSection
            title="Évolution entre agents (événements)"
            hint="Qui a fait quoi entre agents — ouvrir pour le détail opérationnel"
            defaultOpen={false}
          >
            <MissionEventTimeline
              events={d.events}
              title="Évolution entre agents (événements)"
              suppressTitle
              maxHeightClass="max-h-[min(28rem,55vh)]"
            />
          </CollapsibleMissionSection>

          <SimpleAccordion
            key={jobId}
            className="rounded-2xl border border-slate-200 bg-slate-50/80 shadow-sm"
            triggerClassName="cursor-pointer rounded-2xl px-4 py-3 hover:bg-slate-100/80"
            title="Détail d&apos;exécution"
            hint="Équipe, journaux et volumétrie — cliquer pour afficher ou masquer"
            defaultOpen={false}
            panelClassName="space-y-4 border-t border-slate-200 px-4 py-4"
          >
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Équipe / agents</p>
                {normalizeTeamRows(d.team).length ? (
                  <ul className="space-y-2 text-sm text-slate-700">
                    {normalizeTeamRows(d.team).map((row, i) => (
                      <li key={teamRowKey(row, i)} className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
                        <span className="font-medium text-slate-800">{row.label || row.key}</span>
                        {row.status ? <span className="text-xs text-violet-700"> · {row.status}</span> : null}
                        {row.phase ? <span className="text-xs text-slate-500"> · {row.phase}</span> : null}
                        {row.detail ? <p className="mt-0.5 text-xs text-slate-600">{row.detail}</p> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-500">Aucun sous-agent déclaré pour cette mission.</p>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Événements</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{Number(d.events_total || 0)}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Lignes de log</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{Number(d.log_total || 0)}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Tokens</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{Number(d.tokens_total || 0)}</p>
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Journal d&apos;exécution</p>
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap text-xs text-slate-700">
                  {((d.logs || []) as string[]).join("\n") || "(logs en attente)"}
                </pre>
              </div>
          </SimpleAccordion>
        </div>
      ) : null}
    </section>
  );
}
