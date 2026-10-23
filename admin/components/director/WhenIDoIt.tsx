"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { businessApi, todayISO, type BizWorkTask } from "../../lib/business";
import type { ScheduleProposal } from "./BriefingBoard";

type DayEvent = {
  id?: string;
  title?: string;
  when_label?: string;
  href?: string;
  kind?: string;
  event_type?: string;
  starts_at?: string;
};

const SNOOZE_KEY = "korymb-schedule-proposal-snooze";

function loadSnoozed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(SNOOZE_KEY);
    const parsed = raw ? (JSON.parse(raw) as { id: string; until: number }[]) : [];
    const now = Date.now();
    return new Set((Array.isArray(parsed) ? parsed : []).filter((e) => e.until > now).map((e) => e.id));
  } catch {
    return new Set();
  }
}

function snoozeProposal(id: string, hours = 24) {
  if (typeof window === "undefined" || !id) return;
  try {
    const raw = localStorage.getItem(SNOOZE_KEY);
    const parsed = raw ? (JSON.parse(raw) as { id: string; until: number }[]) : [];
    const list = Array.isArray(parsed) ? parsed.filter((e) => e.id !== id) : [];
    list.push({ id, until: Date.now() + hours * 60 * 60 * 1000 });
    localStorage.setItem(SNOOZE_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

function dueToday(task: BizWorkTask, today: string): boolean {
  const due = String(task.due_at || "").trim();
  return Boolean(due && due.slice(0, 10) === today);
}

export default function WhenIDoIt({
  coachingEvents = [],
  dayEvents = [],
  autoSlotNote,
  scheduleProposals = [],
  dayHref,
}: {
  coachingEvents?: DayEvent[];
  dayEvents?: DayEvent[];
  autoSlotNote?: string;
  scheduleProposals?: ScheduleProposal[];
  dayHref?: string;
}) {
  const qc = useQueryClient();
  const today = todayISO();
  const [snoozeTick, setSnoozeTick] = useState(0);
  const [actionError, setActionError] = useState("");
  const [actionOk, setActionOk] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const tasks = useQuery({
    queryKey: ["work-tasks", "open"],
    queryFn: () => businessApi.listTasks("open"),
  });

  const dueTasks = useMemo(
    () => (tasks.data || []).filter((task) => dueToday(task, today)),
    [tasks.data, today],
  );

  const agenda = useMemo(() => {
    const fromCoaching = coachingEvents.filter((ev) => ev.title);
    if (fromCoaching.length) return fromCoaching;
    return dayEvents.filter((ev) => ev.title && (ev.kind === "coaching" || ev.event_type === "tache" || ev.event_type === "jalon"));
  }, [coachingEvents, dayEvents]);

  const visibleProposals = useMemo(() => {
    const snoozed = loadSnoozed();
    return scheduleProposals.filter((p) => p.id && !snoozed.has(p.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- snoozeTick
  }, [scheduleProposals, snoozeTick]);

  useEffect(() => {
    setActionOk("");
  }, [visibleProposals.length]);

  const accept = useMutation({
    mutationFn: async (proposal: ScheduleProposal) => {
      if (!proposal.task_id || !proposal.suggested_due_at) {
        throw new Error("Proposition incomplète.");
      }
      return businessApi.acceptScheduleProposal(proposal.task_id, proposal.suggested_due_at);
    },
    onSuccess: async () => {
      setActionError("");
      setActionOk("Créneau accepté — date posée au calendrier.");
      await qc.invalidateQueries({ queryKey: ["work-tasks"] });
      await qc.invalidateQueries({ queryKey: ["admin-briefing"] });
      await qc.invalidateQueries({ queryKey: ["business-events"] });
    },
    onError: (err: Error) => {
      setActionOk("");
      setActionError(err.message || "Impossible d'accepter cette proposition.");
    },
  });

  const note =
    autoSlotNote ||
    "Une date sans heure crée un créneau 09:00–09:30 automatique — rappel, pas un bloc volontaire.";

  return (
    <section
      id="board-when"
      className="scroll-mt-28 rounded-2xl border-2 border-teal-300 bg-teal-50/80 p-3 dark:border-teal-800 dark:bg-teal-950/40 sm:p-4"
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2
            className="text-sm font-extrabold text-slate-950 dark:text-slate-50"
            title="Time blocking — placer dans mon agenda"
          >
            Quand je le fais
          </h2>
          <p
            className="mt-0.5 text-xs text-slate-500 dark:text-slate-400"
            title="Time blocking — placer dans mon agenda"
          >
            Échéances du jour et créneaux tâches / jalons. Les séances CRM restent dans le calendrier.
            {" "}
            <span className="font-semibold text-slate-600 dark:text-slate-300">En savoir plus</span>
            {" "}
            (time blocking).
          </p>
        </div>
        <Link
          href={dayHref || "/gestion/planning"}
          className="text-xs font-bold text-teal-900 hover:underline dark:text-teal-200"
        >
          Calendrier
        </Link>
      </div>

      <p className="mt-2 text-[11px] leading-snug text-slate-500 dark:text-slate-400">{note}</p>

      {tasks.isLoading ? <p className="mt-3 text-sm text-slate-500">Chargement…</p> : null}
      {tasks.isError ? <p className="mt-3 text-sm text-red-700">Impossible de charger les échéances.</p> : null}

      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="text-xs font-extrabold uppercase tracking-wide text-teal-950 dark:text-teal-100">
            Aujourd&apos;hui{dueTasks.length || agenda.length ? ` (${dueTasks.length + agenda.length})` : ""}
          </h3>
          {dueTasks.length === 0 && agenda.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">Rien de daté aujourd&apos;hui côté coaching.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {dueTasks.map((task) => (
                <li
                  key={task.id}
                  className="rounded-xl border border-teal-200 bg-white px-3 py-2 dark:border-teal-800 dark:bg-slate-950"
                >
                  <p className="text-sm font-bold text-slate-900 dark:text-slate-50">{task.title}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Échéance {String(task.due_at || "").slice(0, 16).replace("T", " ")}
                  </p>
                </li>
              ))}
              {agenda.map((ev, index) => (
                <li key={ev.id || `${ev.title}-${index}`}>
                  <Link
                    href={ev.href || dayHref || "/gestion/planning"}
                    className="block rounded-xl border border-teal-200 bg-white px-3 py-2 hover:border-teal-400 dark:border-teal-800 dark:bg-slate-950"
                  >
                    <span className="block text-sm font-bold text-slate-900 dark:text-slate-50">{ev.title}</span>
                    {ev.when_label ? (
                      <span className="mt-0.5 block text-xs text-slate-500">{ev.when_label}</span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="text-xs font-extrabold uppercase tracking-wide text-teal-950 dark:text-teal-100">
            Propositions d&apos;agenda{visibleProposals.length ? ` (${visibleProposals.length})` : ""}
          </h3>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Rien n&apos;est écrit sans votre accord.
          </p>
          {actionError ? <p className="mt-2 text-sm text-red-700">{actionError}</p> : null}
          {actionOk ? <p className="mt-2 text-sm text-emerald-800 dark:text-emerald-200">{actionOk}</p> : null}
          {visibleProposals.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">Aucune proposition pour l&apos;instant.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {visibleProposals.map((proposal) => {
                const key = proposal.id || proposal.task_id || proposal.title || "";
                const pending = busyId === key || (accept.isPending && busyId === key);
                return (
                  <li
                    key={key}
                    className="rounded-xl border border-teal-200 bg-white px-3 py-2.5 dark:border-teal-800 dark:bg-slate-950"
                  >
                    <p className="text-sm font-bold text-slate-900 dark:text-slate-50">{proposal.title}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {[proposal.slot_label, proposal.project_title || proposal.milestone_title, proposal.reason]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn-primary text-xs"
                        disabled={pending}
                        onClick={() => {
                          setBusyId(key);
                          setActionError("");
                          setActionOk("");
                          accept.mutate(proposal, {
                            onSettled: () => setBusyId(null),
                          });
                        }}
                      >
                        {pending ? "Enregistrement…" : "Accepter"}
                      </button>
                      <button
                        type="button"
                        className="btn-link-secondary text-xs"
                        disabled={pending}
                        onClick={() => {
                          if (proposal.id) snoozeProposal(proposal.id, 24);
                          setSnoozeTick((n) => n + 1);
                          setActionOk("Proposition reportée pour 24 h.");
                        }}
                      >
                        Plus tard
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
