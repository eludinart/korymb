"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import InboxActionCard, { type InboxActionItem } from "./InboxActionCard";
import { BTN_DELETE } from "../../lib/deleteMissionBundle";
import {
  buildClientOpsBoard,
  type BoardSignals,
  type BoardSourceItem,
  type OpsBoard,
  type OpsBoardItem,
} from "../../lib/briefingBoard";
import { asInboxItems, fetchAdminInboxItems } from "../../lib/inboxQuery";
import { filterSnoozedItems, snoozeInboxItem } from "../../lib/inboxSnooze";
import { missionTitleLabel } from "../../lib/missionLabel";
import { useRepriseCoverage } from "../../lib/repriseCoverage";
import { useUiMode } from "../../lib/uiMode";
import ProjectToday from "./ProjectToday";
import TodayTasks from "./TodayTasks";
import TriageTasks from "./TriageTasks";
import WhenIDoIt from "./WhenIDoIt";
import { useTaskSort } from "./useTaskSort";

export type { BoardSignals, BoardSourceItem, OpsBoard, OpsBoardItem };

type MissionRow = { job_id: string; mission?: string };

type UnconsultedRow = {
  job_id: string;
  mission?: string;
  status?: string;
  result_surface?: string | null;
};

type DayEvent = {
  id?: string;
  title?: string;
  when_label?: string;
  href?: string;
  kind?: string;
  event_type?: string;
  starts_at?: string;
};

export type ScheduleProposal = {
  id?: string;
  task_id?: string;
  title?: string;
  project_id?: string | null;
  project_title?: string;
  milestone_title?: string;
  suggested_due_at?: string;
  slot_label?: string;
  reason?: string;
  href?: string;
};

export type ProjectMilestone = {
  project_id?: string;
  project_title?: string;
  index?: number;
  label?: string;
  title?: string;
  priority?: number | null;
  status?: string;
  done?: boolean;
  notes?: string;
  reply?: string;
  reply_at?: string;
  chat_conversation_id?: string;
  href?: string;
  contact_id?: string | null;
  contact_name?: string;
  linked_mission_count?: number;
  job_id?: string;
  task_id?: string;
};

export type MilestoneProjectRef = {
  project_id?: string;
  project_title?: string;
  href?: string;
  contact_id?: string | null;
  linked_mission_count?: number;
  updated_at?: string;
};

export type MilestoneGroup = {
  id?: string;
  kind?: string;
  label?: string;
  href?: string;
  contact_id?: string | null;
  open_count?: number;
  done_count?: number;
  updated_at?: string;
  has_open_p1?: boolean;
  projects?: MilestoneProjectRef[];
  open?: ProjectMilestone[];
  done?: ProjectMilestone[];
};

export type ProjectScienceDoc = {
  id?: string;
  title?: string;
  href?: string;
};

export type ProjectTodayCard = {
  project_id?: string;
  project_title?: string;
  href?: string;
  contact_id?: string | null;
  contact_name?: string;
  linked_mission_count?: number;
  updated_at?: string;
  open?: ProjectMilestone[];
  done?: ProjectMilestone[];
  science_docs?: ProjectScienceDoc[];
};

export type ProjectMilestonesBlock = {
  open?: ProjectMilestone[];
  done?: ProjectMilestone[];
  groups?: MilestoneGroup[];
  projects?: ProjectTodayCard[];
};

/** Préfère `projects` du serveur. Sinon reconstruit depuis groups / listes plates (backend pas encore redémarré). */
export function resolveProjectCards(block: ProjectMilestonesBlock | null | undefined): ProjectTodayCard[] {
  const provided = block?.projects;
  if (Array.isArray(provided) && provided.length > 0) return provided;

  const fromGroups = new Map<string, ProjectTodayCard>();
  for (const group of block?.groups || []) {
    for (const ref of group.projects || []) {
      const id = String(ref.project_id || "").trim();
      if (!id || fromGroups.has(id)) continue;
      fromGroups.set(id, {
        project_id: id,
        project_title: ref.project_title,
        href: ref.href,
        contact_id: ref.contact_id,
        contact_name: group.label,
        linked_mission_count: ref.linked_mission_count,
        updated_at: ref.updated_at || group.updated_at,
        open: [],
        done: [],
      });
    }
  }

  const ensure = (row: ProjectMilestone) => {
    const id = String(row.project_id || "").trim();
    if (!id) return null;
    let card = fromGroups.get(id);
    if (!card) {
      card = {
        project_id: id,
        project_title: row.project_title,
        href: row.href,
        contact_id: row.contact_id,
        contact_name: row.contact_name,
        linked_mission_count: row.linked_mission_count,
        updated_at: "",
        open: [],
        done: [],
      };
      fromGroups.set(id, card);
    }
    return card;
  };

  for (const row of block?.open || []) {
    const card = ensure(row);
    if (card) (card.open ||= []).push(row);
  }
  for (const row of block?.done || []) {
    const card = ensure(row);
    if (card) (card.done ||= []).push(row);
  }

  return [...fromGroups.values()].sort((a, b) => {
    const aOpen = (a.open || []).length ? 0 : 1;
    const bOpen = (b.open || []).length ? 0 : 1;
    if (aOpen !== bOpen) return aOpen - bOpen;
    return String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
  });
}

type Props = {
  userName?: string;
  summary?: string;
  board?: OpsBoard | null;
  milestones?: ProjectMilestonesBlock | null;
  decisions?: BoardSourceItem[];
  signals?: BoardSignals;
  running?: MissionRow[];
  planned?: MissionRow[];
  unconsulted?: UnconsultedRow[];
  dayEvents?: DayEvent[];
  dayLines?: string[];
  dayHref?: string;
  coachingEvents?: DayEvent[];
  autoSlotNote?: string;
  scheduleProposals?: ScheduleProposal[];
  inboxTotal?: number;
  memoryPending?: number;
  memoryHref?: string;
  onDeleteRunning?: (jobId: string, mission?: string) => void;
  deleteBusyId?: string | null;
};

const WHERE_TONE: Record<string, string> = {
  Décisions: "bg-violet-100 text-violet-950 ring-violet-200 dark:bg-violet-900 dark:text-violet-100 dark:ring-violet-700",
  Missions: "bg-sky-100 text-sky-950 ring-sky-200 dark:bg-sky-900 dark:text-sky-100 dark:ring-sky-700",
  Planning: "bg-amber-100 text-amber-950 ring-amber-200 dark:bg-amber-900 dark:text-amber-100 dark:ring-amber-700",
  Mémoire: "bg-emerald-100 text-emerald-950 ring-emerald-200 dark:bg-emerald-900 dark:text-emerald-100 dark:ring-emerald-700",
  Configuration: "bg-rose-100 text-rose-950 ring-rose-200 dark:bg-rose-900 dark:text-rose-100 dark:ring-rose-700",
  Budget: "bg-orange-100 text-orange-950 ring-orange-200 dark:bg-orange-900 dark:text-orange-100 dark:ring-orange-700",
  Devis: "bg-teal-100 text-teal-950 ring-teal-200 dark:bg-teal-900 dark:text-teal-100 dark:ring-teal-700",
  Courrier: "bg-teal-100 text-teal-950 ring-teal-200 dark:bg-teal-900 dark:text-teal-100 dark:ring-teal-700",
  Reprise: "bg-orange-100 text-orange-950 ring-orange-200 dark:bg-orange-900 dark:text-orange-100 dark:ring-orange-700",
};

function formatDateFr() {
  return new Date().toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function resultStatus(status?: string) {
  if (status === "awaiting_validation") return "Validation en attente";
  if (String(status || "").startsWith("error")) return "Échec à consulter";
  return "Résultat non consulté";
}

function Where({ children }: { children: string }) {
  const tone = WHERE_TONE[children] || "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-600";
  return (
    <span className={`inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-xs font-bold ring-1 ${tone}`}>
      {children}
    </span>
  );
}

function RepriseWarningProbe({ onItem }: { onItem: (item: OpsBoardItem | null) => void }) {
  const coverage = useRepriseCoverage();
  const gaps = coverage.data?.workspace_empty ? 0 : (coverage.data?.gaps.length ?? 0);
  useEffect(() => {
    if (!coverage.data || gaps <= 0) {
      onItem(null);
      return;
    }
    onItem({
      id: "reprise-gaps",
      title: gaps > 1 ? `${gaps} domaines incomplets` : "1 domaine incomplet",
      where: "Reprise",
      href: "/administration/reprise",
      kind: "warning",
      severity: "medium",
      detail: "Évolution d'activité",
    });
  }, [coverage.data, gaps, onItem]);
  return null;
}

const DECISION_KINDS = new Set(["hitl", "action_ticket", "cio_question", "closure", "quality"]);

function inboxMatchesRow(item: InboxActionItem, row: OpsBoardItem): boolean {
  const focus = item.ticket_id || item.job_id || item.output_id || item.suggestion_id || item.event_id || "";
  if (!focus) return false;
  return row.id === `${item.kind || "item"}:${focus}` || String(row.href || "").includes(focus);
}

function countBit(n: number, one: string, many: string): string | null {
  if (n <= 0) return null;
  return n === 1 ? one : `${n} ${many}`;
}

function Lane({
  id,
  title,
  hint,
  count,
  accent,
  bar,
  action,
  className = "",
  children,
}: {
  id: string;
  title: string;
  hint: string;
  count: number;
  accent: string;
  bar: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className={`relative scroll-mt-28 flex min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-3 pt-4 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-4 sm:pt-5 ${className}`}
    >
      <span className={`absolute inset-x-0 top-0 h-1 ${bar}`} aria-hidden />
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-extrabold tracking-tight text-slate-950 dark:text-slate-50">{title}</h2>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-extrabold tabular-nums ${accent}`}>{count}</span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p>
        </div>
        {action}
      </div>
      <div className="min-h-0 xl:max-h-[32rem] xl:overflow-y-auto xl:pr-1">{children}</div>
    </section>
  );
}

function ItemLink({ item, placeFirst = false }: { item: OpsBoardItem; placeFirst?: boolean }) {
  const hot = item.severity === "critical" || item.severity === "high";
  const title = (
    <span className="block text-sm font-bold leading-snug text-slate-900 dark:text-slate-50">
      {item.title || "À traiter"}
    </span>
  );
  const place = item.where ? <Where>{item.where}</Where> : null;
  return (
    <Link
      href={item.href || "/inbox"}
      className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 transition hover:shadow-sm ${
        hot
          ? "border-rose-200 bg-rose-50/80 hover:border-rose-300 dark:border-rose-800 dark:bg-rose-950/40"
          : "border-slate-200 bg-slate-50/80 hover:border-violet-300 dark:border-slate-700 dark:bg-slate-950/60"
      }`}
    >
      <span
        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${hot ? "bg-rose-500" : "bg-violet-400"}`}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        {placeFirst ? (
          <span className="mb-1.5 flex flex-wrap items-center gap-1.5">
            {place}
            {item.detail ? <span className="text-xs text-slate-500 dark:text-slate-400">{item.detail}</span> : null}
          </span>
        ) : null}
        {title}
        {placeFirst ? null : (
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {place}
            {item.detail ? <span className="text-xs text-slate-500 dark:text-slate-400">{item.detail}</span> : null}
          </span>
        )}
      </span>
      <span className="shrink-0 self-center rounded-lg bg-white px-2 py-1 text-xs font-bold text-violet-800 ring-1 ring-violet-200 transition active:scale-[0.98] dark:bg-slate-900 dark:text-violet-100 dark:ring-violet-700">
        Ouvrir
      </span>
    </Link>
  );
}

function EmptyLine({ children }: { children: string }) {
  return (
    <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-sm font-medium text-slate-600 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-300">
      {children}
    </p>
  );
}

export default function BriefingBoard({
  userName,
  summary,
  board,
  milestones,
  decisions,
  signals,
  running,
  planned,
  unconsulted,
  dayEvents,
  dayLines,
  dayHref,
  coachingEvents,
  autoSlotNote,
  scheduleProposals,
  inboxTotal = 0,
  memoryPending = 0,
  memoryHref,
  onDeleteRunning,
  deleteBusyId,
}: Props) {
  const qc = useQueryClient();
  const { isPlatformOwner } = useUiMode();
  const serverReady = Boolean(board?.counts);
  const inbox = useQuery({
    queryKey: ["admin-inbox"],
    queryFn: () => fetchAdminInboxItems(80),
    staleTime: 45_000,
    refetchOnWindowFocus: false,
  });
  const [repriseWarning, setRepriseWarning] = useState<OpsBoardItem | null>(null);
  const [snoozeTick, setSnoozeTick] = useState(0);
  const [hiddenLead, setHiddenLead] = useState("");
  const [openTaskCount, setOpenTaskCount] = useState(0);
  const [triageCount, setTriageCount] = useState(0);
  const taskSort = useTaskSort();

  const resolved = useMemo(() => {
    if (serverReady && board) return board;
    const live = inbox.data ? filterSnoozedItems(asInboxItems(inbox.data)) : decisions || [];
    return buildClientOpsBoard(live, signals || {});
  }, [board, decisions, inbox.data, serverReady, signals]);

  const urgent = resolved.urgent || [];
  const todo = resolved.todo || [];
  const proposals = resolved.proposals || [];
  const baseWarnings = resolved.warnings || [];
  const warnings = repriseWarning && !baseWarnings.some((item) => item.id === repriseWarning.id)
    ? [...baseWarnings, repriseWarning]
    : baseWarnings;
  const counts = resolved.counts || {};
  const urgentCount = Number(counts.urgent ?? urgent.length);
  const todoCount = Number(counts.todo ?? todo.length);
  const proposalCount = Number(counts.proposals ?? proposals.length);
  const openMilestones = milestones?.open || [];
  const projectCards = resolveProjectCards(milestones);
  const warningCount = Number(counts.warnings ?? baseWarnings.length) + (warnings.length - baseWarnings.length);
  const runningRows = running || [];
  const plannedRows = planned || [];
  const resumeRows = unconsulted || [];
  const advanceCount = plannedRows.length + resumeRows.length;
  const events = (dayEvents || []).filter((ev) => ev.title);
  const lines = (dayLines || []).filter((line) => line && !/rien d.urgent au planning/i.test(line));
  const greet = userName ? `Bonjour, ${userName}` : "Bonjour";
  // snoozeTick force le recalcul : le filtre lit le localStorage, pas inbox.data.
  const liveInbox = useMemo(
    () => filterSnoozedItems(asInboxItems(inbox.data)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- snoozeTick
    [inbox.data, snoozeTick],
  );
  const leadRow = urgent[0];
  const leadIndex = leadRow ? liveInbox.findIndex((item) => inboxMatchesRow(item, leadRow)) : -1;
  const leadItem = leadIndex >= 0 && DECISION_KINDS.has(String(liveInbox[leadIndex]?.kind || "")) ? liveInbox[leadIndex] : null;
  const leadKey = leadItem ? `${leadItem.kind || "item"}:${leadItem.ticket_id || leadItem.job_id || leadItem.event_id || leadIndex}` : "";
  const showLead = Boolean(leadItem) && hiddenLead !== leadKey;
  const urgentLinks = showLead ? urgent.slice(1) : urgent;

  useEffect(() => {
    if (!showLead || !leadItem) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key !== "s" && e.key !== "S") return;
      e.preventDefault();
      snoozeInboxItem(leadItem, leadIndex, 24);
      setHiddenLead(leadKey);
      setSnoozeTick((n) => n + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showLead, leadItem, leadIndex, leadKey]);

  return (
    <div className="space-y-4">
      {isPlatformOwner ? <RepriseWarningProbe onItem={setRepriseWarning} /> : null}
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500 capitalize dark:text-slate-400">
            {formatDateFr()}
          </p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950 dark:text-slate-50 xl:text-3xl">
            {greet}
          </h1>
          <p className="mt-1 line-clamp-3 max-w-3xl text-sm leading-relaxed text-slate-600 dark:text-slate-300 lg:line-clamp-none">
            {summary || "Voici ce qui demande votre attention aujourd'hui."}
          </p>
          <p className="mt-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
            {urgentCount === 0 ? <span>Rien d&apos;urgent.</span> : (
              <a href="#board-urgent" className="text-rose-800 underline-offset-2 hover:underline dark:text-rose-200">
                {countBit(urgentCount, "1 urgent", "urgents")}
              </a>
            )}
            {projectCards.length > 0 ? (
              <>
                <span className="text-slate-300"> · </span>
                <a href="#board-direction" className="text-sky-800 underline-offset-2 hover:underline dark:text-sky-200">
                  {countBit(projectCards.length, "1 direction", "directions")}
                </a>
              </>
            ) : null}
            {openMilestones.length > 0 ? (
              <>
                <span className="text-slate-300"> · </span>
                <a href="#board-direction" className="text-sky-800 underline-offset-2 hover:underline dark:text-sky-200">
                  {countBit(openMilestones.length, "1 étape", "étapes")}
                </a>
              </>
            ) : null}
            {todoCount > 0 ? (
              <>
                <span className="text-slate-300"> · </span>
                <a href="#board-todo" className="text-violet-800 underline-offset-2 hover:underline dark:text-violet-200">
                  {countBit(todoCount, "1 décision en attente", "décisions en attente")}
                </a>
              </>
            ) : null}
            {runningRows.length > 0 ? (
              <>
                <span className="text-slate-300"> · </span>
                <a href="#board-running" className="underline-offset-2 hover:underline">
                  {countBit(runningRows.length, "1 mission en cours", "missions en cours")}
                </a>
              </>
            ) : null}
            {openTaskCount > 0 ? (
              <>
                <span className="text-slate-300"> · </span>
                <a href="#board-tasks" className="text-violet-800 underline-offset-2 hover:underline dark:text-violet-200">
                  {countBit(openTaskCount, "1 qui traîne", "qui traînent")}
                </a>
              </>
            ) : null}
            {triageCount > 0 ? (
              <>
                <span className="text-slate-300"> · </span>
                <a href="#board-triage" className="text-amber-900 underline-offset-2 hover:underline dark:text-amber-200">
                  {countBit(triageCount, "1 à prioriser", "à prioriser")}
                </a>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {urgentCount > 0 ? (
            <a href="#board-urgent" className="btn-primary">
              Traiter maintenant
            </a>
          ) : todoCount > 0 ? (
            <a href="#board-todo" className="btn-primary">
              Décider
            </a>
          ) : (
            <Link href="/missions?create=1" className="btn-primary">
              Nouvelle intention
            </Link>
          )}
          {urgentCount > 0 || todoCount > 0 ? (
            <Link href="/missions?create=1" className="btn-link-secondary">
              Nouvelle intention
            </Link>
          ) : null}
          <Link href="/inbox" className="btn-link-secondary">
            Décisions{inboxTotal > 0 ? ` (${inboxTotal})` : ""}
          </Link>
        </div>
      </header>

      {/* Coaching : Où je vais → Ce qui traîne → Quoi d'abord → Quand je le fais ; Décisions à part */}
      <ProjectToday projects={projectCards} />

      <TodayTasks
        onOpenCount={setOpenTaskCount}
        sort={taskSort.sort}
        criteria={taskSort.criteria}
      />

      <TriageTasks
        onCount={setTriageCount}
        sort={taskSort.sort}
        criteria={taskSort.criteria}
      />

      <WhenIDoIt
        coachingEvents={coachingEvents || []}
        dayEvents={events}
        autoSlotNote={autoSlotNote}
        scheduleProposals={scheduleProposals || []}
        dayHref={dayHref}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-12 xl:items-start">
        <p id="board-decisions" className="sr-only">
          Décisions agents — validation HITL, distincte du coaching.
        </p>
        {warningCount === 0 ? <div id="board-warnings" className="hidden" /> : null}
        {warningCount > 0 ? (
          <section
            id="board-warnings"
            className="scroll-mt-28 rounded-2xl border border-orange-200 bg-orange-50/80 p-3 dark:border-orange-800 dark:bg-orange-950/40 sm:p-4 lg:col-span-2 xl:col-span-12"
          >
            <h2 className="text-sm font-extrabold text-orange-950 dark:text-orange-100">Avertissements</h2>
            <p className="mt-0.5 text-xs text-orange-900/80 dark:text-orange-200/80">
              Chaque pastille dit où agir.
            </p>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {warnings.map((item, index) => (
                <li key={`${item.id || item.title}-${index}`}>
                  <ItemLink item={item} placeFirst />
                </li>
              ))}
            </ul>
            {warningCount > warnings.length ? (
              <p className="mt-2 text-xs font-semibold text-orange-900 dark:text-orange-200">
                {warningCount - warnings.length} autre{warningCount - warnings.length > 1 ? "s" : ""} dans les écrans liés.
              </p>
            ) : null}
          </section>
        ) : null}

        {urgentCount === 0 ? (
          <p
            id="board-urgent"
            className="scroll-mt-28 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm font-semibold text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-100 lg:col-span-2 xl:col-span-12"
          >
            Rien d&apos;urgent.
          </p>
        ) : null}
        {urgentCount > 0 ? (
          <section
            id="board-urgent"
            className="scroll-mt-28 rounded-2xl border-2 border-rose-300 bg-white p-3 shadow-sm dark:border-rose-700 dark:bg-slate-900 sm:p-4 lg:col-span-2 xl:col-span-12"
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-extrabold text-rose-950 dark:text-rose-100">À faire maintenant</h2>
                <p className="mt-0.5 text-xs text-rose-800/80 dark:text-rose-200/80">
                  {urgentCount === 1 ? "Une chose avant le reste." : `${urgentCount} choses avant le reste.`}
                </p>
              </div>
              <Link href="/inbox?severity=critical" className="text-xs font-bold text-rose-800 hover:underline dark:text-rose-200">
                File des décisions
              </Link>
            </div>
            {showLead && leadItem ? (
              <div className="mb-3">
                <InboxActionCard
                  item={leadItem}
                  defaultExpanded
                  onDismissed={() => {
                    setHiddenLead(leadKey);
                    void qc.invalidateQueries({ queryKey: ["admin-inbox"] });
                    void qc.invalidateQueries({ queryKey: ["admin-briefing"] });
                  }}
                />
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    className="text-xs font-bold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                    onClick={() => {
                      snoozeInboxItem(leadItem, leadIndex, 24);
                      setHiddenLead(leadKey);
                      setSnoozeTick((n) => n + 1);
                    }}
                  >
                    Reporter
                    <kbd className="ml-1 rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px] dark:bg-slate-800">S</kbd>
                  </button>
                </div>
              </div>
            ) : null}
            <ul className="grid gap-2 lg:grid-cols-2">
              {urgentLinks.map((item, index) => (
                <li key={`${item.id || item.title}-${index}`}>
                  <ItemLink item={item} />
                </li>
              ))}
            </ul>
            {urgentCount > urgent.length ? (
              <p className="mt-2 text-xs font-semibold text-rose-800 dark:text-rose-200">
                <Link href="/inbox?severity=critical" className="underline">
                  Voir les {urgentCount - urgent.length} autres urgences
                </Link>
              </p>
            ) : null}
          </section>
        ) : null}

        <Lane
          id="board-todo"
          title="Décisions en attente"
          hint="Validations qui vous attendent, hors urgences."
          count={todoCount}
          accent="bg-violet-100 text-violet-900 dark:bg-violet-900 dark:text-violet-100"
          bar="bg-violet-500"
          className="xl:col-span-5"
          action={
            <Link href="/inbox" className="text-xs font-bold text-violet-700 hover:underline dark:text-violet-300">
              Tout voir
            </Link>
          }
        >
          {todo.length === 0 ? (
            <EmptyLine>Aucune décision en attente hors urgences.</EmptyLine>
          ) : (
            <ul className="space-y-2">
              {todo.map((item, index) => (
                <li key={`${item.id || item.title}-${index}`}>
                  <ItemLink item={item} />
                </li>
              ))}
            </ul>
          )}
          {todoCount > todo.length ? (
            <p className="mt-2 text-xs font-semibold text-slate-500">
              <Link href="/inbox" className="font-bold text-violet-700 hover:underline dark:text-violet-300">
                {todoCount - todo.length} de plus dans Décisions
              </Link>
            </p>
          ) : null}
        </Lane>

        <Lane
          id="board-running"
          title="Missions en cours"
          hint="Missions qui tournent en ce moment."
          count={runningRows.length}
          accent="bg-sky-100 text-sky-950 dark:bg-sky-900 dark:text-sky-100"
          bar="bg-sky-500"
          className="xl:col-span-3"
          action={
            <Link href="/missions" className="text-xs font-bold text-sky-800 hover:underline dark:text-sky-200">
              Missions
            </Link>
          }
        >
          {runningRows.length === 0 ? (
            <EmptyLine>Aucune mission en cours.</EmptyLine>
          ) : (
            <ul className="space-y-2">
              {runningRows.map((m) => (
                <li
                  key={m.job_id}
                  className="rounded-xl border border-sky-200 bg-sky-50/70 px-3 py-2.5 dark:border-sky-800 dark:bg-sky-950/40"
                >
                  <p className="text-sm font-bold leading-snug text-slate-900 dark:text-slate-50">
                    {missionTitleLabel(m.mission, 90) || m.job_id}
                  </p>
                  <span className="mt-1.5 inline-flex">
                    <Where>Missions</Where>
                  </span>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Link href={`/missions?job=${encodeURIComponent(m.job_id)}`} className="btn-link-primary text-xs">
                      Suivre
                    </Link>
                    {onDeleteRunning ? (
                      <button
                        type="button"
                        disabled={deleteBusyId === m.job_id}
                        onClick={() => onDeleteRunning(m.job_id, m.mission)}
                        className={BTN_DELETE}
                      >
                        {deleteBusyId === m.job_id ? "Suppression…" : "Supprimer"}
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Lane>

        <Lane
          id="board-advance"
          title="Missions planifiées et résultats"
          hint="Résultats non consultés, puis missions pas encore lancées."
          count={advanceCount}
          accent="bg-amber-100 text-amber-950 dark:bg-amber-900 dark:text-amber-100"
          bar="bg-amber-500"
          className="xl:col-span-4"
          action={
            <Link href="/missions?view=kanban" className="text-xs font-bold text-amber-800 hover:underline dark:text-amber-200">
              Kanban
            </Link>
          }
        >
          {advanceCount === 0 ? (
            <EmptyLine>Aucune mission planifiée, aucun résultat à lire.</EmptyLine>
          ) : (
            <ul className="space-y-2">
              {resumeRows.map((m) => (
                <li key={`resume-${m.job_id}`}>
                  <Link
                    href={`/missions?job=${encodeURIComponent(m.job_id)}`}
                    className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2.5 hover:border-amber-300 dark:border-amber-800 dark:bg-amber-950/40"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold leading-snug text-slate-900 dark:text-slate-50">
                        {missionTitleLabel(m.mission, 90) || m.job_id}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Where>Missions</Where>
                        <span className="text-xs font-semibold text-amber-800 dark:text-amber-200">
                          {resultStatus(m.status)}
                        </span>
                      </span>
                      {m.result_surface ? (
                        <span className="mt-1 line-clamp-2 block text-xs text-slate-600 dark:text-slate-300">
                          {m.result_surface}
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 text-xs font-bold text-amber-800 dark:text-amber-200">Reprendre</span>
                  </Link>
                </li>
              ))}
              {plannedRows.map((m) => (
                <li key={`plan-${m.job_id}`}>
                  <Link
                    href={`/missions?job=${encodeURIComponent(m.job_id)}`}
                    className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 hover:border-amber-300 dark:border-slate-700 dark:bg-slate-950"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold leading-snug text-slate-900 dark:text-slate-50">
                        {missionTitleLabel(m.mission, 90) || m.job_id}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Where>Missions</Where>
                        <span className="text-xs text-slate-500">Prévue, pas encore lancée</span>
                      </span>
                    </span>
                    <span className="shrink-0 text-xs font-bold text-violet-700 dark:text-violet-300">Ouvrir</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Lane>

        <Lane
          id="board-proposals"
          title="Propositions à valider"
          hint="Suggestions à accepter ou à refuser. Rien ne part sans vous."
          count={proposalCount}
          accent="bg-emerald-100 text-emerald-950 dark:bg-emerald-900 dark:text-emerald-100"
          bar="bg-emerald-500"
          className="xl:col-span-7"
          action={
            <Link href="/inbox" className="text-xs font-bold text-emerald-800 hover:underline dark:text-emerald-200">
              Trancher
            </Link>
          }
        >
          {proposals.length === 0 ? (
            <EmptyLine>Aucune proposition à valider.</EmptyLine>
          ) : (
            <ul className="space-y-2">
              {proposals.map((item, index) => (
                <li key={`${item.id || item.title}-${index}`}>
                  <ItemLink item={item} />
                </li>
              ))}
            </ul>
          )}
          {proposalCount > proposals.length ? (
            <p className="mt-2 text-xs font-semibold">
              <Link href="/inbox" className="font-bold text-emerald-800 hover:underline dark:text-emerald-200">
                {proposalCount - proposals.length} autre{proposalCount - proposals.length > 1 ? "s" : ""} dans Décisions
              </Link>
            </p>
          ) : null}
        </Lane>

        <Lane
          id="board-soon"
          title="Autres rendez-vous 48 h"
          hint="Séances et CRM — le coaching du jour est dans « Quand je le fais »."
          count={events.filter((ev) => ev.kind !== "coaching").length || lines.length}
          accent="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
          bar="bg-slate-400"
          className="lg:col-span-2 xl:col-span-5"
          action={
            <Link
              href={dayHref || "/gestion/planning"}
              className="text-xs font-bold text-slate-700 hover:underline dark:text-slate-200"
            >
              Planning
            </Link>
          }
        >
          {(() => {
            const otherEvents = events.filter((ev) => ev.kind !== "coaching");
            return otherEvents.length === 0 && lines.length === 0 && memoryPending <= 0 ? (
            <EmptyLine>Rien d&apos;autre au planning sur les 48 prochaines heures.</EmptyLine>
          ) : (
            <ul className="space-y-2">
              {memoryPending > 0 && !proposals.some((item) => item.kind === "learning_suggestion") ? (
                <li>
                  <Link
                    href={memoryHref || "/administration/memory"}
                    className="flex items-center justify-between gap-2 rounded-xl border border-violet-200 bg-violet-50/70 px-3 py-2.5 text-sm dark:border-violet-800 dark:bg-violet-950/40"
                  >
                    <span>
                      <span className="block font-bold text-slate-900 dark:text-slate-50">
                        {memoryPending} mémoire{memoryPending > 1 ? "s" : ""} à confirmer
                      </span>
                      <span className="mt-1 inline-flex">
                        <Where>Mémoire</Where>
                      </span>
                    </span>
                    <span className="text-xs font-bold text-violet-700 dark:text-violet-300">Traiter</span>
                  </Link>
                </li>
              ) : null}
              {otherEvents.map((ev, index) => (
                <li key={ev.id || `${ev.title}-${index}`}>
                  <Link
                    href={ev.href || dayHref || "/gestion/planning"}
                    className="flex items-start justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2.5 hover:border-violet-300 dark:border-slate-700"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-bold text-slate-900 dark:text-slate-50">{ev.title}</span>
                      {ev.when_label ? (
                        <span className="mt-0.5 block text-xs text-slate-500">{ev.when_label}</span>
                      ) : null}
                      {ev.kind === "session" || ev.event_type === "seance" ? (
                        <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                          Séance / CRM
                        </span>
                      ) : null}
                    </span>
                    <Where>Planning</Where>
                  </Link>
                </li>
              ))}
              {otherEvents.length === 0
                ? lines.slice(0, 4).map((line, index) => (
                    <li key={`${index}-${line.slice(0, 24)}`} className="text-sm text-slate-700 dark:text-slate-200">
                      {line}
                    </li>
                  ))
                : null}
            </ul>
          );
          })()}
        </Lane>
      </div>
    </div>
  );
}
