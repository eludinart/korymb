"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { agentHeaders, requestJson } from "../../lib/api";
import { businessApi, formatTaskCreated, todayISO, type BizWorkTask } from "../../lib/business";
import { missionTitleLabel } from "../../lib/missionLabel";
import { QK } from "../../lib/queryClient";
import { projectPastel } from "../../lib/projectPastel";
import { sortTasks, type TaskSortId } from "../../lib/taskSort";
import type { Job } from "../../lib/types";
import ReplyComposer from "./ReplyComposer";
import TaskNotes from "./TaskNotes";
import WorkTaskList, { missionRefsFromJobs, TaskSortSelect } from "./WorkTaskList";
import { useWorkTaskActions, WorkTaskEditor } from "./workTaskActions";

const PREVIEW = 4;

const NOTE_MAX = 2500;

export type TodayStep = {
  project_id?: string;
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
  contact_name?: string;
  job_id?: string;
  task_id?: string;
};

export type TodayProject = {
  project_id?: string;
  project_title?: string;
  href?: string;
  contact_name?: string;
  linked_mission_count?: number;
  updated_at?: string;
  open?: TodayStep[];
  done?: TodayStep[];
};

function stepMeta(item: TodayStep): string {
  const bits: string[] = [];
  if (typeof item.priority === "number") bits.push(`P${item.priority}`);
  if (item.status) bits.push(item.status);
  return bits.join(" · ");
}

function StepRow({ item, done, linkedJobIds }: { item: TodayStep; done?: boolean; linkedJobIds: Set<string> }) {
  const qc = useQueryClient();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [replyBusy, setReplyBusy] = useState(false);
  const [notesBusy, setNotesBusy] = useState(false);
  const [notesDraft, setNotesDraft] = useState(item.notes || "");
  const [notesSaved, setNotesSaved] = useState(false);
  const [details, setDetails] = useState(false);
  const projectId = item.project_id || "";
  const stepIndex = item.index;
  const canCheck = !done && Boolean(projectId) && typeof stepIndex === "number";
  const title = item.title || item.label || "Étape";
  const checked = Boolean(done || saved);
  const jobId = (item.job_id || "").trim();
  const meta = stepMeta(item);
  const fullLabel = (item.label || "").trim();
  const showFullLabel = Boolean(fullLabel && fullLabel !== title);
  const notesText = (item.notes || "").trim();
  const notesDirty = notesDraft !== (item.notes || "");

  useEffect(() => {
    setNotesDraft(item.notes || "");
  }, [item.notes]);

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
      setError(err.message || "Impossible d'enregistrer cette étape.");
    },
  });

  return (
    <div
      className={`rounded-xl border px-3 py-2.5 ${
        checked
          ? "border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-400"
          : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950"
      }`}
    >
      <div className="flex items-start gap-2.5">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 shrink-0 accent-violet-700"
          checked={checked}
          disabled={!canCheck || toggle.isPending || checked}
          aria-label={checked ? `« ${title} » est faite` : `Marquer « ${title} » comme faite`}
          onChange={() => {
            if (!canCheck || toggle.isPending || checked) return;
            setError("");
            toggle.mutate();
          }}
        />
        <span className="min-w-0 flex-1">
          <button
            type="button"
            className={`block w-full text-left text-sm font-bold leading-snug hover:underline ${
              checked ? "text-slate-500 line-through dark:text-slate-400" : "text-slate-900 dark:text-slate-50"
            }`}
            aria-expanded={details}
            onClick={() => setDetails((value) => !value)}
          >
            {title}
          </button>
          {meta ? (
            <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{meta}</span>
          ) : null}
          {!details && notesText ? (
            <p className="mt-1 line-clamp-2 text-xs leading-snug text-slate-600 dark:text-slate-300">{notesText}</p>
          ) : null}
          <button
            type="button"
            className="mt-1 text-xs font-bold text-violet-800 hover:underline dark:text-violet-200"
            aria-expanded={details}
            onClick={() => setDetails((value) => !value)}
          >
            {details ? "Réduire" : notesText || item.reply ? "Voir le détail" : "Commentaire & réponse"}
          </button>
          {toggle.isPending ? (
            <span className="mt-1 block text-xs font-semibold text-violet-800 dark:text-violet-200">Enregistrement…</span>
          ) : null}
          {saved ? (
            <span className="mt-1 block text-xs font-semibold text-emerald-800 dark:text-emerald-200">Faite.</span>
          ) : null}
          {error ? <span className="mt-1 block text-xs font-semibold text-red-700 dark:text-red-300">{error}</span> : null}
        </span>
      </div>
      {details ? (
        <div className="mt-2 grid gap-2 border-t border-slate-100 pt-2 dark:border-slate-800">
          {showFullLabel ? (
            <p className="text-xs leading-snug text-slate-600 dark:text-slate-300">
              <span className="font-semibold">Libellé · </span>
              {fullLabel}
            </p>
          ) : null}
          {item.status ? (
            <p className="text-xs text-slate-600 dark:text-slate-300">
              <span className="font-semibold">Statut · </span>
              {item.status}
            </p>
          ) : null}
          {typeof item.priority === "number" ? (
            <p className="text-xs text-slate-600 dark:text-slate-300">
              <span className="font-semibold">Priorité · </span>
              P{item.priority}
            </p>
          ) : null}
          {jobId ? (
            <Link
              href={`/missions?job=${encodeURIComponent(jobId)}`}
              className="text-xs font-semibold text-violet-800 hover:underline dark:text-violet-200"
            >
              {linkedJobIds.has(jobId) ? "Mission liée à une tâche · ouvrir" : `Mission · ${missionTitleLabel(title, 80) || "Ouvrir"}`}
            </Link>
          ) : null}
          <Link
            href={item.href || "/gestion/projets"}
            className="text-xs font-semibold text-violet-800 hover:underline dark:text-violet-200"
          >
            Fiche projet
          </Link>
          <div className="grid gap-1.5">
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Commentaire
              <textarea
                className="input-field mt-1 w-full text-sm"
                rows={3}
                maxLength={NOTE_MAX}
                value={notesDraft}
                disabled={!projectId || typeof stepIndex !== "number" || notesBusy}
                aria-label={`Commentaire de l'étape « ${title} »`}
                onChange={(event) => {
                  setNotesSaved(false);
                  setNotesDraft(event.target.value);
                }}
              />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="inline-flex min-h-9 items-center rounded-lg border border-violet-200 bg-violet-50 px-3 text-xs font-bold text-violet-900 disabled:opacity-50 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-100"
                disabled={!projectId || typeof stepIndex !== "number" || notesBusy || !notesDirty}
                onClick={async () => {
                  if (!projectId || typeof stepIndex !== "number") return;
                  setError("");
                  setNotesBusy(true);
                  try {
                    await businessApi.setMilestoneNotes(projectId, stepIndex, {
                      notes: notesDraft,
                      label: item.label || "",
                    });
                    setNotesSaved(true);
                    await qc.invalidateQueries({ queryKey: ["admin-briefing"] });
                    await qc.invalidateQueries({ queryKey: ["business-projects"] });
                    await qc.invalidateQueries({ queryKey: ["business-project", projectId] });
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Impossible d'enregistrer le commentaire.");
                  } finally {
                    setNotesBusy(false);
                  }
                }}
              >
                {notesBusy ? "Enregistrement…" : "Enregistrer le commentaire"}
              </button>
              <span className="text-[11px] text-slate-500">
                {notesDraft.length}/{NOTE_MAX}
                {notesSaved ? " · Enregistré" : ""}
              </span>
            </div>
          </div>
          {!checked ? (
            <ReplyComposer
              indent={false}
              kind="Étape"
              title={title}
              notes={notesText || item.status || ""}
              subject={item.contact_name || ""}
              reply={item.reply || ""}
              replyAt={item.reply_at || ""}
              conversationId={item.chat_conversation_id || ""}
              saving={replyBusy}
              savedLabel={item.reply_at ? `Enregistrée le ${formatTaskCreated(item.reply_at) || "—"}` : ""}
              onSave={async (next) => {
                if (!projectId || typeof stepIndex !== "number") return;
                setError("");
                setReplyBusy(true);
                try {
                  await businessApi.setMilestoneReply(projectId, stepIndex, { reply: next, label: item.label || "" });
                  await qc.invalidateQueries({ queryKey: ["admin-briefing"] });
                  await qc.invalidateQueries({ queryKey: ["business-projects"] });
                  await qc.invalidateQueries({ queryKey: ["business-project", projectId] });
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Impossible d'enregistrer la réponse.");
                } finally {
                  setReplyBusy(false);
                }
              }}
              onConversationId={async (id) => {
                if (!projectId || typeof stepIndex !== "number") return;
                await businessApi.setMilestoneReply(projectId, stepIndex, {
                  reply: item.reply || "",
                  label: item.label || "",
                  conversation_id: id,
                });
                await qc.invalidateQueries({ queryKey: ["admin-briefing"] });
              }}
            />
          ) : item.reply ? (
            <TaskNotes source={item.reply} label="Réponse" />
          ) : (
            <p className="text-xs text-slate-500">Aucune réponse enregistrée.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function PreviewList<T>({
  items,
  itemKey,
  render,
}: {
  items: T[];
  itemKey: (item: T, index: number) => string;
  render: (item: T) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const visible = open ? items : items.slice(0, PREVIEW);
  const hidden = items.length - visible.length;
  return (
    <>
      <ul className="mt-2 space-y-2">
        {visible.map((item, index) => (
          <li key={itemKey(item, index)}>{render(item)}</li>
        ))}
      </ul>
      {hidden > 0 ? (
        <button
          type="button"
          className="mt-2 text-xs font-bold text-violet-700 hover:underline dark:text-violet-300"
          onClick={() => setOpen(true)}
        >
          +{hidden} autres
        </button>
      ) : null}
      {open && items.length > PREVIEW ? (
        <button
          type="button"
          className="mt-2 ml-3 text-xs font-bold text-slate-500 hover:underline"
          onClick={() => setOpen(false)}
        >
          Réduire
        </button>
      ) : null}
    </>
  );
}

function ProjectCard({
  card,
  tasks,
  actions,
  missionsByTaskId,
  linkedJobIds,
}: {
  card: TodayProject;
  tasks: BizWorkTask[];
  actions: ReturnType<typeof useWorkTaskActions>;
  missionsByTaskId: Map<string, { job_id: string; title: string; status?: string }[]>;
  linkedJobIds: Set<string>;
}) {
  const today = todayISO();
  const [expanded, setExpanded] = useState(false);
  const openSteps = card.open || [];
  const doneSteps = card.done || [];
  const title = card.project_title || "Projet";
  const href = card.href || (card.project_id ? `/gestion/projets/${card.project_id}` : "/gestion/projets");
  const missionCount = card.linked_mission_count || 0;
  const pastel = projectPastel(card.project_id || card.project_title);
  const stepLabel = openSteps.length === 1 ? "1 étape" : `${openSteps.length} étapes`;
  const taskLabel = tasks.length === 1 ? "1 tâche" : `${tasks.length} tâches`;
  return (
    <article className={`rounded-xl border p-3 ${pastel.card}`}>
      <div className="flex items-start gap-2">
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <span className="block truncate text-sm font-extrabold text-slate-950 dark:text-slate-50">
            {title}
          </span>
          {card.contact_name ? (
            <span className="mt-0.5 block text-xs text-slate-500">{card.contact_name}</span>
          ) : null}
          <span className={`mt-1 block text-xs font-semibold ${pastel.heading}`}>
            {stepLabel} · {taskLabel}
            {missionCount > 0 ? ` · ${missionCount === 1 ? "1 mission" : `${missionCount} missions`}` : ""}
          </span>
        </button>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${pastel.chip}`}>
            Projet
          </span>
          <button
            type="button"
            className="text-xs font-bold text-slate-700 hover:underline dark:text-slate-200"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "Réduire" : "Voir le détail"}
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="mt-3 border-t border-black/10 pt-3 dark:border-white/10">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <Link href={href} className="text-xs font-bold text-violet-800 hover:underline dark:text-violet-200">
              Fiche projet
            </Link>
            {missionCount > 0 ? (
              <Link href={href} className="text-[11px] font-bold text-violet-800 hover:underline dark:text-violet-200">
                {missionCount === 1 ? "1 mission liée" : `${missionCount} missions liées`}
              </Link>
            ) : null}
          </div>

          <h3 className={`text-xs font-bold uppercase tracking-wide ${pastel.heading}`}>Étapes</h3>
          {openSteps.length === 0 ? (
            <p className="mt-1 text-sm text-slate-500">Aucune étape ouverte.</p>
          ) : (
            <PreviewList
              items={openSteps}
              itemKey={(item) => `${item.project_id || "p"}-${item.index ?? item.title}`}
              render={(item) => <StepRow item={item} linkedJobIds={linkedJobIds} />}
            />
          )}
          {doneSteps.length > 0 ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-bold text-slate-500">
                {doneSteps.length === 1 ? "1 étape faite" : `${doneSteps.length} étapes faites`}
              </summary>
              <ul className="mt-2 space-y-2">
                {doneSteps.map((item) => (
                  <li key={`done-${item.project_id || "p"}-${item.index ?? item.title}`}>
                    <StepRow item={item} done linkedJobIds={linkedJobIds} />
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <h3 className={`mt-3 text-xs font-bold uppercase tracking-wide ${pastel.heading}`}>
            Tâches{tasks.length ? ` (${tasks.length})` : ""}
          </h3>
          {tasks.length === 0 ? (
            <p className="mt-1 text-sm text-slate-500">Aucune tâche ouverte.</p>
          ) : (
            <TaskPreview
              tasks={tasks}
              today={today}
              actions={actions}
              missionsByTaskId={missionsByTaskId}
            />
          )}
        </div>
      ) : null}
    </article>
  );
}

function TaskPreview({
  tasks,
  today,
  actions,
  missionsByTaskId,
}: {
  tasks: BizWorkTask[];
  today: string;
  actions: ReturnType<typeof useWorkTaskActions>;
  missionsByTaskId: Map<string, { job_id: string; title: string; status?: string }[]>;
}) {
  const [open, setOpen] = useState(false);
  const visible = open ? tasks : tasks.slice(0, PREVIEW);
  const hidden = tasks.length - visible.length;
  return (
    <div className="mt-2">
      <WorkTaskList
        tasks={visible}
        today={today}
        actions={actions}
        mode="complete-only"
        missionsByTaskId={missionsByTaskId}
        showProject={false}
      />
      {hidden > 0 ? (
        <button
          type="button"
          className="mt-2 text-xs font-bold text-violet-700 hover:underline dark:text-violet-300"
          onClick={() => setOpen(true)}
        >
          +{hidden} autres
        </button>
      ) : null}
      {open && tasks.length > PREVIEW ? (
        <button
          type="button"
          className="mt-2 text-xs font-bold text-slate-500 hover:underline"
          onClick={() => setOpen(false)}
        >
          Réduire
        </button>
      ) : null}
    </div>
  );
}

export default function ProjectToday({
  projects,
  sort,
  onSort,
}: {
  projects: TodayProject[];
  sort: TaskSortId;
  onSort: (id: TaskSortId) => void;
}) {
  const today = todayISO();
  const actions = useWorkTaskActions();
  const tasks = useQuery({
    queryKey: ["work-tasks", "open"],
    queryFn: () => businessApi.listTasks("open"),
  });
  const jobs = useQuery({
    queryKey: QK.jobsCards,
    queryFn: async () => {
      const { data } = await requestJson("/jobs/cards", { headers: agentHeaders(), retries: 1, timeoutMs: 20_000 });
      return ((data as { jobs?: Job[] })?.jobs || []) as Job[];
    },
    staleTime: 20_000,
  });
  const missionsByTaskId = useMemo(() => missionRefsFromJobs(jobs.data || []), [jobs.data]);
  const linkedJobIds = useMemo(() => {
    const ids = new Set<string>();
    for (const list of missionsByTaskId.values()) {
      for (const item of list) ids.add(item.job_id);
    }
    return ids;
  }, [missionsByTaskId]);
  const openTasks = tasks.data || [];

  return (
    <section
      id="board-milestones"
      className="scroll-mt-28 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-4"
    >
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-extrabold tracking-tight text-slate-950 dark:text-slate-50">
            Projets{projects.length ? ` (${projects.length})` : ""}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Chaque projet, ses étapes, puis ses tâches ouvertes.
          </p>
        </div>
        <TaskSortSelect value={sort} onChange={onSort} />
      </div>
      {actions.error ? <p className="mb-2 text-sm text-red-700">{actions.error}</p> : null}
      {projects.length === 0 ? (
        <p className="text-sm text-slate-500">Aucun projet actif.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {projects.map((card) => {
            const pid = card.project_id || "";
            const mine = sortTasks(
              openTasks.filter((task) => task.project_id === pid),
              sort,
              today,
            );
            return (
              <ProjectCard
                key={pid || card.project_title}
                card={card}
                tasks={mine}
                actions={actions}
                missionsByTaskId={missionsByTaskId}
                linkedJobIds={linkedJobIds}
              />
            );
          })}
        </div>
      )}
      <WorkTaskEditor actions={actions} />
    </section>
  );
}
