"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import InboxActionCard, { type InboxActionItem } from "./InboxActionCard";
import { BTN_DELETE } from "../../lib/deleteMissionBundle";
import { agentHeaders, requestJson } from "../../lib/api";
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

export type { BoardSignals, BoardSourceItem, OpsBoard, OpsBoardItem };

type MissionRow = { job_id: string; mission?: string };

type UnconsultedRow = {
  job_id: string;
  mission?: string;
  status?: string;
  result_surface?: string | null;
};

type DayEvent = { id?: string; title?: string; when_label?: string; href?: string };

export type ProjectMilestone = {
  project_id?: string;
  project_title?: string;
  index?: number;
  label?: string;
  title?: string;
  priority?: number | null;
  status?: string;
  done?: boolean;
  href?: string;
  contact_id?: string | null;
  contact_name?: string;
  linked_mission_count?: number;
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

export type ProjectMilestonesBlock = {
  open?: ProjectMilestone[];
  done?: ProjectMilestone[];
  groups?: MilestoneGroup[];
};

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
      <span className="hidden shrink-0 pt-0.5 text-xs font-bold text-violet-700 sm:inline dark:text-violet-300">Ouvrir</span>
    </Link>
  );
}

function milestoneMeta(item: ProjectMilestone): string {
  const bits: string[] = [];
  if (typeof item.priority === "number") bits.push(`P${item.priority}`);
  if (item.status) bits.push(item.status);
  if (item.project_title) bits.push(item.project_title);
  return bits.join(" · ");
}

function MilestoneRow({ item, done }: { item: ProjectMilestone; done?: boolean }) {
  const qc = useQueryClient();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const projectId = item.project_id || "";
  const stepIndex = item.index;
  const canCheck = !done && Boolean(projectId) && typeof stepIndex === "number";
  const title = item.title || item.label || "Jalon";
  const checked = Boolean(done || saved);

  const toggle = useMutation({
    mutationFn: async () => {
      await requestJson(
        `/business/projects/${encodeURIComponent(projectId)}/milestones/${encodeURIComponent(String(stepIndex))}/done`,
        {
          method: "POST",
          headers: agentHeaders(),
          body: JSON.stringify({ done: true, label: item.label || "" }),
        },
      );
    },
    onSuccess: async () => {
      setError("");
      setSaved(true);
      await qc.invalidateQueries({ queryKey: ["admin-briefing"] });
      await qc.invalidateQueries({ queryKey: ["business-projects"] });
      if (projectId) await qc.invalidateQueries({ queryKey: ["business-project", projectId] });
    },
    onError: (err: Error) => {
      setSaved(false);
      setError(err.message || "Impossible d'enregistrer ce jalon.");
    },
  });

  return (
    <div
      className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 ${
        checked
          ? "border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-400"
          : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950"
      }`}
    >
      <input
        type="checkbox"
        className="mt-1 h-4 w-4 shrink-0 accent-violet-700"
        checked={checked}
        disabled={!canCheck || toggle.isPending || checked}
        aria-label={checked ? `« ${title} » est fait` : `Marquer « ${title} » comme fait`}
        onChange={() => {
          if (!canCheck || toggle.isPending || checked) return;
          setError("");
          toggle.mutate();
        }}
      />
      <span className="min-w-0 flex-1">
        <Link
          href={item.href || "/gestion/projets"}
          className={`block text-sm font-bold leading-snug hover:underline ${
            checked ? "text-slate-500 line-through dark:text-slate-400" : "text-slate-900 dark:text-slate-50"
          }`}
        >
          {title}
        </Link>
        {milestoneMeta(item) ? (
          <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{milestoneMeta(item)}</span>
        ) : null}
        {toggle.isPending ? (
          <span className="mt-1 block text-xs font-semibold text-violet-800 dark:text-violet-200">Enregistrement…</span>
        ) : null}
        {saved ? (
          <span className="mt-1 block text-xs font-semibold text-emerald-800 dark:text-emerald-200">Fait.</span>
        ) : null}
        {error ? (
          <span className="mt-1 block text-xs font-semibold text-red-700 dark:text-red-300">{error}</span>
        ) : null}
      </span>
    </div>
  );
}

const MILESTONE_PREVIEW = 5;

function milestoneCountLabel(openCount: number, doneCount: number): string {
  const open = openCount === 1 ? "1 ouvert" : `${openCount} ouverts`;
  const done = doneCount === 1 ? "1 fait" : `${doneCount} faits`;
  return `${open} · ${done}`;
}

function linkedMissionLabel(count: number): string {
  return count === 1 ? "1 mission liée" : `${count} missions liées`;
}

function resolveMilestoneGroups(block: ProjectMilestonesBlock): MilestoneGroup[] {
  const provided = Array.isArray(block.groups) ? block.groups : null;
  if (provided && provided.length > 0) return provided;
  const open = block.open || [];
  const done = block.done || [];
  if (open.length === 0 && done.length === 0) return [];
  return [{
    id: "flat",
    kind: "owner",
    label: "Projets",
    href: "/gestion/projets",
    open,
    done,
    projects: [],
  }];
}

function MilestoneProgress({ doneCount, total }: { doneCount: number; total: number }) {
  if (total <= 0) return null;
  const width = Math.max(0, Math.min(100, Math.round((doneCount / total) * 100)));
  return (
    <div
      className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={doneCount}
      aria-label={`${doneCount} faits sur ${total}`}
    >
      <div className="h-full rounded-full bg-violet-600 dark:bg-violet-400" style={{ width: `${width}%` }} />
    </div>
  );
}

function LinkedMissions({ group }: { group: MilestoneGroup }) {
  const projects = group.projects || [];
  const linked = projects.filter((project) => (project.linked_mission_count || 0) > 0);
  if (linked.length === 0) return null;
  const single = projects.length === 1;
  return (
    <ul className="mt-2 space-y-1">
      {linked.map((project) => {
        const count = project.linked_mission_count || 0;
        const phrase = linkedMissionLabel(count);
        const text = single ? phrase : `${project.project_title || "Projet"} · ${phrase}`;
        const href = project.href || "";
        const sameAsHeader = Boolean(single && href && href === (group.href || ""));
        return (
          <li key={project.project_id || text} className="text-xs font-semibold text-slate-600 dark:text-slate-300">
            {href && !sameAsHeader ? (
              <Link href={href} className="hover:underline">{text}</Link>
            ) : (
              text
            )}
          </li>
        );
      })}
    </ul>
  );
}

function MilestoneGroupCard({ group }: { group: MilestoneGroup }) {
  const open = group.open || [];
  const done = group.done || [];
  const openCount = open.length;
  const doneCount = done.length;
  const fullyDone = openCount === 0 && doneCount > 0;
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? open : open.slice(0, MILESTONE_PREVIEW);
  const hidden = openCount - visible.length;
  const label = group.label || "Projets";
  const href = group.href || "";
  const name = href ? (
    <Link href={href} className="block min-w-0 truncate text-sm font-extrabold tracking-tight text-slate-950 hover:underline dark:text-slate-50">
      {label}
    </Link>
  ) : (
    <span className="min-w-0 truncate text-sm font-extrabold tracking-tight text-slate-950 dark:text-slate-50">{label}</span>
  );

  return (
    <article
      className={`flex min-w-0 flex-col rounded-xl border p-3 ${
        fullyDone
          ? "border-slate-200 bg-slate-50/80 dark:border-slate-700 dark:bg-slate-950/40"
          : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        {name}
        <span className="shrink-0 text-[11px] font-bold tabular-nums text-slate-500 dark:text-slate-400">
          {milestoneCountLabel(openCount, doneCount)}
        </span>
      </div>
      <MilestoneProgress doneCount={doneCount} total={openCount + doneCount} />
      <LinkedMissions group={group} />
      {openCount > 0 ? (
        <ul className="mt-3 space-y-2">
          {visible.map((item) => (
            <li key={`${item.project_id || "prj"}-${item.index ?? item.title}`}>
              <MilestoneRow item={item} />
            </li>
          ))}
        </ul>
      ) : null}
      {hidden > 0 ? (
        <button
          type="button"
          className="mt-2 self-start text-xs font-bold text-violet-700 hover:underline dark:text-violet-300"
          onClick={() => setShowAll(true)}
        >
          Voir plus
        </button>
      ) : null}
      {showAll && openCount > MILESTONE_PREVIEW ? (
        <button
          type="button"
          className="mt-2 self-start text-xs font-bold text-slate-500 hover:underline dark:text-slate-400"
          onClick={() => setShowAll(false)}
        >
          Réduire
        </button>
      ) : null}
      {doneCount > 0 ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-bold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200">
            {doneCount === 1 ? "1 jalon fait" : `${doneCount} jalons faits`}
          </summary>
          <ul className="mt-2 space-y-2">
            {done.map((item) => (
              <li key={`done-${item.project_id || "prj"}-${item.index ?? item.title}`}>
                <MilestoneRow item={item} done />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </article>
  );
}

function MilestoneSection({ milestones }: { milestones: ProjectMilestonesBlock }) {
  const groups = resolveMilestoneGroups(milestones).filter(
    (group) => (group.open || []).length + (group.done || []).length > 0,
  );
  if (groups.length === 0) return null;
  const openTotal = (milestones.open || []).length || groups.reduce((sum, group) => sum + (group.open || []).length, 0);
  return (
    <section
      id="board-milestones"
      className="scroll-mt-28 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-4 lg:col-span-2 xl:col-span-12"
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-extrabold tracking-tight text-slate-950 dark:text-slate-50">Jalons</h2>
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-extrabold tabular-nums text-violet-900 dark:bg-violet-900 dark:text-violet-100">
              {openTotal}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Par client. Les ouverts d&apos;abord, classés par priorité.
          </p>
        </div>
        <Link href="/gestion/projets" className="text-xs font-bold text-violet-700 hover:underline dark:text-violet-300">
          Projets
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {groups.map((group, index) => (
          <MilestoneGroupCard key={group.id || group.label || index} group={group} />
        ))}
      </div>
    </section>
  );
}

function EmptyLine({ children }: { children: string }) {
  return (
    <p className="rounded-xl border border-dashed border-slate-200 px-3 py-3 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
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
  const doneMilestones = milestones?.done || [];
  const milestoneGroups = milestones?.groups || [];
  const warningCount = Number(counts.warnings ?? baseWarnings.length) + (warnings.length - baseWarnings.length);
  const runningRows = running || [];
  const plannedRows = planned || [];
  const resumeRows = unconsulted || [];
  const advanceCount = plannedRows.length + resumeRows.length;
  const events = (dayEvents || []).filter((ev) => ev.title);
  const lines = (dayLines || []).filter((line) => line && !/rien d.urgent au planning/i.test(line));
  const greet = userName ? `Bonjour, ${userName}` : "Bonjour";
  const liveInbox = useMemo(
    () => filterSnoozedItems(asInboxItems(inbox.data)),
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
            {openMilestones.length > 0 ? (
              <>
                <span className="text-slate-300"> · </span>
                <a href="#board-milestones" className="text-violet-800 underline-offset-2 hover:underline dark:text-violet-200">
                  {countBit(openMilestones.length, "1 jalon", "jalons")}
                </a>
              </>
            ) : null}
            {todoCount > 0 ? (
              <>
                <span className="text-slate-300"> · </span>
                <a href="#board-todo" className="text-violet-800 underline-offset-2 hover:underline dark:text-violet-200">
                  {countBit(todoCount, "1 à valider", "à valider")}
                </a>
              </>
            ) : null}
            {runningRows.length > 0 ? (
              <>
                <span className="text-slate-300"> · </span>
                <a href="#board-running" className="underline-offset-2 hover:underline">
                  {countBit(runningRows.length, "1 en cours", "en cours")}
                </a>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link href="/missions?create=1" className="btn-link-primary">
            Nouvelle intention
          </Link>
          <Link href="/inbox" className="btn-link-secondary">
            Décisions{inboxTotal > 0 ? ` (${inboxTotal})` : ""}
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-12 xl:items-start">
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
                <h2 className="text-sm font-extrabold text-rose-950 dark:text-rose-100">Urgent</h2>
                <p className="mt-0.5 text-xs text-rose-800/80 dark:text-rose-200/80">À traiter avant le reste.</p>
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

        {openMilestones.length > 0 || doneMilestones.length > 0 || milestoneGroups.length > 0 ? (
          <MilestoneSection milestones={milestones || { open: openMilestones, done: doneMilestones, groups: milestoneGroups }} />
        ) : null}

        <Lane
          id="board-todo"
          title="À faire"
          hint="Décisions et validations qui vous attendent."
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
          title="En cours"
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
          title="À avancer"
          hint="Résultats à reprendre, puis tâches prévues."
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
            <EmptyLine>Rien à reprendre ni à lancer.</EmptyLine>
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
          title="Propositions"
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
            <EmptyLine>Aucune proposition en attente.</EmptyLine>
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
          title="Bientôt"
          hint="Planning des prochaines 48 h."
          count={events.length || lines.length}
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
          {events.length === 0 && lines.length === 0 && memoryPending <= 0 ? (
            <EmptyLine>Rien au planning sur les 48 prochaines heures.</EmptyLine>
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
              {events.map((ev, index) => (
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
                    </span>
                    <Where>Planning</Where>
                  </Link>
                </li>
              ))}
              {events.length === 0
                ? lines.slice(0, 4).map((line, index) => (
                    <li key={`${index}-${line.slice(0, 24)}`} className="text-sm text-slate-700 dark:text-slate-200">
                      {line}
                    </li>
                  ))
                : null}
            </ul>
          )}
        </Lane>
      </div>
    </div>
  );
}
