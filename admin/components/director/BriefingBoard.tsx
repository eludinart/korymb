"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { BTN_DELETE } from "../../lib/deleteMissionBundle";
import {
  buildClientOpsBoard,
  type BoardSignals,
  type BoardSourceItem,
  type OpsBoard,
  type OpsBoardItem,
} from "../../lib/briefingBoard";
import { asInboxItems, fetchAdminInboxItems } from "../../lib/inboxQuery";
import { filterSnoozedItems } from "../../lib/inboxSnooze";
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

type Props = {
  userName?: string;
  summary?: string;
  board?: OpsBoard | null;
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

function Kpi({
  href,
  label,
  value,
  hot,
}: {
  href: string;
  label: string;
  value: number;
  hot: string;
}) {
  const active = value > 0;
  return (
    <a
      href={href}
      className={`flex min-h-[4.25rem] flex-col justify-between rounded-xl border px-3 py-2.5 transition hover:shadow-sm ${
        active
          ? hot
          : "border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
      }`}
    >
      <span className="text-[11px] font-bold uppercase leading-tight tracking-wide">{label}</span>
      <span className="mt-1 text-2xl font-extrabold tabular-nums leading-none">{value}</span>
    </a>
  );
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
  const { isPlatformOwner } = useUiMode();
  const serverReady = Boolean(board?.counts);
  const inbox = useQuery({
    queryKey: ["admin-inbox"],
    queryFn: () => fetchAdminInboxItems(80),
    enabled: !serverReady,
    staleTime: 45_000,
    refetchOnWindowFocus: false,
  });
  const [repriseWarning, setRepriseWarning] = useState<OpsBoardItem | null>(null);

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
  const warningCount = Number(counts.warnings ?? baseWarnings.length) + (warnings.length - baseWarnings.length);
  const runningRows = running || [];
  const plannedRows = planned || [];
  const resumeRows = unconsulted || [];
  const advanceCount = plannedRows.length + resumeRows.length;
  const events = (dayEvents || []).filter((ev) => ev.title);
  const lines = (dayLines || []).filter((line) => line && !/rien d.urgent au planning/i.test(line));
  const greet = userName ? `Bonjour, ${userName}` : "Bonjour";

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

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <Kpi href="#board-urgent" label="Urgent" value={urgentCount} hot="border-rose-300 bg-rose-50 text-rose-950 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-100" />
        <Kpi href="#board-todo" label="À faire" value={todoCount} hot="border-violet-300 bg-violet-50 text-violet-950 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-100" />
        <Kpi href="#board-running" label="En cours" value={runningRows.length} hot="border-sky-300 bg-sky-50 text-sky-950 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-100" />
        <Kpi href="#board-advance" label="À avancer" value={advanceCount} hot="border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100" />
        <Kpi href="#board-proposals" label="Propositions" value={proposalCount} hot="border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-100" />
        <Kpi href="#board-warnings" label="Avertissements" value={warningCount} hot="border-orange-300 bg-orange-50 text-orange-950 dark:border-orange-700 dark:bg-orange-950 dark:text-orange-100" />
      </div>

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
            <ul className="grid gap-2 lg:grid-cols-2">
              {urgent.map((item, index) => (
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
