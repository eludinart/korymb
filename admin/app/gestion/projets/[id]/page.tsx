"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertBox, LoadingLine, PageHeader, PageShell, SectionCard } from "../../../../components/ui/PageChrome";
import { businessApi, formatTaskCreated, type BizContact, type BizEvent, type BizQuote } from "../../../../lib/business";
import AgentMessageMarkdown from "../../../../components/AgentMessageMarkdown";
import ProjectTasksPanel from "../../../../components/director/ProjectTasksPanel";
import ReplyComposer from "../../../../components/director/ReplyComposer";
import TaskNotes from "../../../../components/director/TaskNotes";
import { agentHeaders, requestJson } from "../../../../lib/api";
import { missionTitleLabel } from "../../../../lib/missionLabel";
import { QK } from "../../../../lib/queryClient";
import type { Job } from "../../../../lib/types";
import {
  EVENT_RESOURCE_TYPE_LABELS,
  EVENT_STATUS_LABELS,
  EVENT_TYPE_LABELS,
  EVENT_VISIBILITY_LABELS,
  PROJECT_STATUS_LABELS,
  PROJECT_TYPE_LABELS,
  QUOTE_STATUS_LABELS,
  formatDateTime,
  formatEuroCents,
  isMatiereEvent,
  toDateInputValue,
  type EventVisibility,
} from "../../_shared";

const NOTE_MAX = 2500;

type Milestone = {
  label: string;
  done?: boolean;
  notes?: string;
  reply?: string;
  reply_at?: string;
  chat_conversation_id?: string;
};

function visibilityLabel(ev: BizEvent): string {
  const vis = (ev.visibility || "") as EventVisibility;
  return EVENT_VISIBILITY_LABELS[vis] || (ev.is_public ? "Public" : "Interne");
}

function EventRow({ ev }: { ev: BizEvent }) {
  const kind = isMatiereEvent(ev)
    ? EVENT_RESOURCE_TYPE_LABELS[ev.resource_type || ""] || "Document"
    : EVENT_TYPE_LABELS[ev.event_type] || ev.event_type;
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 py-3">
      <div className="min-w-0">
        <Link href={`/gestion/planning/${ev.id}`} className="font-semibold text-slate-900 hover:text-emerald-900 hover:underline">
          {ev.title}
        </Link>
        <p className="text-xs text-slate-500">
          {kind} · {formatDateTime(ev.starts_at)} · {EVENT_STATUS_LABELS[ev.status] || ev.status} · {visibilityLabel(ev)}
        </p>
        {ev.resource_filename ? <p className="text-xs text-slate-500">Fichier : {ev.resource_filename}</p> : null}
        {ev.resource_url ? <p className="truncate text-xs text-slate-500">{ev.resource_url}</p> : null}
      </div>
      <Link
        href={`/gestion/planning/${ev.id}`}
        className="touch-target inline-flex items-center rounded-lg border border-violet-200 bg-violet-50 px-3 text-xs font-semibold text-violet-900"
      >
        Modifier
      </Link>
    </li>
  );
}

export default function GestionProjetEditPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [contactId, setContactId] = useState("");
  const [projectType, setProjectType] = useState("autre");
  const [status, setStatus] = useState("active");
  const [location, setLocation] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [description, setDescription] = useState("");
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [hydrated, setHydrated] = useState(false);

  const project = useQuery({
    queryKey: ["business-project", id],
    queryFn: () => businessApi.getProject(id),
    enabled: Boolean(id),
  });
  const contacts = useQuery({ queryKey: ["business-contacts"], queryFn: () => businessApi.listContacts() });
  const events = useQuery({
    queryKey: ["business-events", "project", id],
    queryFn: () => businessApi.listEvents(undefined, undefined, 500, id),
    enabled: Boolean(id),
  });
  const quotes = useQuery({ queryKey: ["business-quotes"], queryFn: () => businessApi.listQuotes() });
  const scienceDocs = useQuery({
    queryKey: ["knowledge-documents", "project", id],
    queryFn: () => businessApi.listKnowledgeDocuments({ project_id: id }),
    enabled: Boolean(id),
  });
  const jobs = useQuery({
    queryKey: QK.jobsCards,
    queryFn: async () => {
      const { data } = await requestJson("/jobs/cards", { headers: agentHeaders(), retries: 1, timeoutMs: 20_000 });
      return ((data as { jobs?: Job[] })?.jobs || []) as Job[];
    },
    staleTime: 20_000,
  });

  useEffect(() => {
    if (!project.data || hydrated) return;
    const p = project.data;
    setTitle(p.title || "");
    setContactId(p.contact_id || "");
    setProjectType(p.project_type || "autre");
    setStatus(p.status || "active");
    setLocation(p.location || "");
    setStartDate(toDateInputValue(p.start_date));
    setEndDate(toDateInputValue(p.end_date));
    setDescription(p.description || "");
    setMilestones((p.milestones || []).map((m) => ({
      label: m.label || "",
      done: Boolean(m.done),
      notes: m.notes || "",
      reply: m.reply || "",
      reply_at: m.reply_at || "",
      chat_conversation_id: m.chat_conversation_id || "",
    })));
    setHydrated(true);
  }, [project.data, hydrated]);

  const linkedQuotes = useMemo(
    () => (quotes.data || []).filter((q: BizQuote) => q.project_id === id),
    [quotes.data, id],
  );
  const linkedJobs = useMemo(() => {
    const ids = new Set((project.data?.linked_job_ids || []).map(String));
    if (!ids.size) return [];
    return (jobs.data || []).filter((j) => ids.has(String(j.job_id)));
  }, [jobs.data, project.data?.linked_job_ids]);
  const sessions = useMemo(() => (events.data || []).filter((ev) => !isMatiereEvent(ev)), [events.data]);
  const resources = useMemo(() => (events.data || []).filter((ev) => isMatiereEvent(ev)), [events.data]);

  const planningHref = (resource = false) => {
    const params = new URLSearchParams();
    params.set("project", id);
    if (contactId) params.set("contact", contactId);
    params.set("next", `/gestion/projets/${id}`);
    if (resource) params.set("resource", "1");
    return `/gestion/planning/nouveau?${params.toString()}`;
  };
  const devisHref = () => {
    const params = new URLSearchParams();
    params.set("project", id);
    if (contactId) params.set("contact", contactId);
    params.set("next", `/gestion/projets/${id}`);
    return `/gestion/devis/nouveau?${params.toString()}`;
  };

  const save = useMutation({
    mutationFn: () =>
      businessApi.updateProject(id, {
        title: title.trim(),
        contact_id: contactId || null,
        project_type: projectType,
        status,
        location: location.trim(),
        start_date: startDate || null,
        end_date: endDate || null,
        description: description.trim(),
        milestones: milestones.filter((m) => m.label.trim()).map((m) => ({
          label: m.label.trim(),
          done: Boolean(m.done),
          notes: m.notes || "",
          reply: m.reply || "",
          reply_at: m.reply_at || "",
          chat_conversation_id: m.chat_conversation_id || "",
        })),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["business-projects"] });
      void qc.invalidateQueries({ queryKey: ["business-project", id] });
      void qc.invalidateQueries({ queryKey: ["business-overview"] });
      setError("");
      setSaved("Modifications enregistrées.");
    },
    onError: (e: Error) => {
      setSaved("");
      setError(e.message);
    },
  });

  if (project.isLoading) {
    return (
      <PageShell size="wide">
        <LoadingLine label="Chargement du projet…" />
      </PageShell>
    );
  }

  if (project.isError || !project.data) {
    return (
      <PageShell size="wide">
        <AlertBox tone="error" title="Projet introuvable">
          <Link href="/gestion/projets" className="underline">
            Retour à la liste
          </Link>
        </AlertBox>
      </PageShell>
    );
  }

  return (
    <PageShell size="wide" className="space-y-6">
      <PageHeader
        accent="emerald"
        badge="Projets"
        title={project.data.title}
        description="Où je vais (étapes + science) puis Travail (tâches). Les rendez-vous restent au calendrier."
        actions={
          <Link href="/gestion/projets" className="btn-link-secondary">
            ← Retour à la liste
          </Link>
        }
      />

      <SectionCard title="Détails du projet">
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) {
              setError("Le titre est obligatoire.");
              return;
            }
            save.mutate();
          }}
        >
          <label className="block text-sm sm:col-span-2">
            <span className="font-medium text-slate-700">Titre *</span>
            <input className="input-field mt-1 w-full" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Fiche CRM (optionnel)</span>
            <select className="input-field mt-1 w-full" value={contactId} onChange={(e) => setContactId(e.target.value)}>
              <option value="">— Aucune —</option>
              {(contacts.data || []).map((c: BizContact) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-slate-500">
              Contact commercial. Les participants (inscrits / invités) se choisissent sur chaque rendez-vous ou document, pas ici.
            </span>
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Type</span>
            <select className="input-field mt-1 w-full" value={projectType} onChange={(e) => setProjectType(e.target.value)}>
              {Object.entries(PROJECT_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Statut</span>
            <select className="input-field mt-1 w-full" value={status} onChange={(e) => setStatus(e.target.value)}>
              {Object.entries(PROJECT_STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Lieu</span>
            <input className="input-field mt-1 w-full" value={location} onChange={(e) => setLocation(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Début</span>
            <input type="date" className="input-field mt-1 w-full" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Fin</span>
            <input type="date" className="input-field mt-1 w-full" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="font-medium text-slate-700">Description</span>
            <textarea className="input-field mt-1 w-full" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
            {description.trim() ? (
              <div className="mt-2 rounded-lg border border-slate-100 bg-slate-50/80 p-2 dark:border-slate-800 dark:bg-slate-950/40">
                <TaskNotes source={description} label="Aperçu" />
              </div>
            ) : null}
          </label>
          <div id="projet-direction" className="sm:col-span-2 scroll-mt-28 space-y-2 rounded-xl border border-sky-200 bg-sky-50/50 p-3 dark:border-sky-800 dark:bg-sky-950/30">
            <div>
              <p className="text-sm font-extrabold text-slate-900 dark:text-slate-50" title="Méthode SMART — cible claire, mesurable, datée">
                Où je vais — étapes
              </p>
              <p className="mt-0.5 text-xs text-slate-500" title="Méthode SMART — cible claire, mesurable, datée">
                Direction du projet (pas les tâches du quotidien).{" "}
                <span className="font-semibold">En savoir plus</span> (SMART).
              </p>
            </div>
            {milestones.length === 0 ? <p className="text-xs text-slate-500">Aucune étape pour l’instant. Liste interne à cocher — ce n’est ni un rendez-vous, ni un document pour les inscrits.</p> : null}
            {milestones.map((m, idx) => (
              <div key={`${idx}-${m.chat_conversation_id || ""}`} className="rounded-xl border border-slate-200 p-2 dark:border-slate-700">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="checkbox"
                  checked={Boolean(m.done)}
                  onChange={(e) => {
                    const next = [...milestones];
                    next[idx] = { ...m, done: e.target.checked };
                    setMilestones(next);
                  }}
                  aria-label={`Étape ${idx + 1} terminée`}
                />
                <input
                  className="input-field min-w-[12rem] flex-1"
                  value={m.label}
                  onChange={(e) => {
                    const next = [...milestones];
                    next[idx] = { ...m, label: e.target.value };
                    setMilestones(next);
                  }}
                  placeholder="Libellé de l’étape"
                />
                <button
                  type="button"
                  className="touch-target inline-flex items-center rounded-lg border border-red-200 bg-red-50 px-3 text-sm font-semibold text-red-800"
                  onClick={() => setMilestones(milestones.filter((_, i) => i !== idx))}
                >
                  Retirer
                </button>
              </div>
              <label className="mt-2 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                Commentaire
                <textarea
                  className="input-field mt-1 w-full text-sm"
                  rows={2}
                  maxLength={NOTE_MAX}
                  value={m.notes || ""}
                  placeholder="Notes, contexte, suivi…"
                  aria-label={`Commentaire de l'étape ${idx + 1}`}
                  onChange={(e) => {
                    const next = [...milestones];
                    next[idx] = { ...m, notes: e.target.value };
                    setMilestones(next);
                  }}
                  onBlur={async () => {
                    if (!m.label.trim()) return;
                    try {
                      const updated = await businessApi.setMilestoneNotes(id, idx, {
                        notes: m.notes || "",
                        label: m.label,
                      });
                      const saved = updated.milestones?.[idx];
                      setMilestones((current) =>
                        current.map((step, stepIndex) =>
                          stepIndex === idx ? { ...step, notes: saved?.notes || "" } : step,
                        ),
                      );
                      void qc.invalidateQueries({ queryKey: ["admin-briefing"] });
                    } catch {
                      /* l'enregistrement global du projet conserve aussi notes */
                    }
                  }}
                />
              </label>
              {m.label.trim() ? (
                <ReplyComposer
                  indent={false}
                  kind="Étape"
                  title={m.label}
                  notes={m.notes || ""}
                  reply={m.reply || ""}
                  replyAt={m.reply_at || ""}
                  conversationId={m.chat_conversation_id || ""}
                  saving={false}
                  savedLabel={m.reply_at ? `Enregistrée le ${formatTaskCreated(m.reply_at) || "—"}` : ""}
                  onSave={async (next) => {
                    const updated = await businessApi.setMilestoneReply(id, idx, { reply: next, label: m.label });
                    const saved = updated.milestones?.[idx];
                    setMilestones((current) => current.map((step, stepIndex) => (
                      stepIndex === idx
                        ? {
                          ...step,
                          reply: saved?.reply || "",
                          reply_at: saved?.reply_at || "",
                          chat_conversation_id: saved?.chat_conversation_id || step.chat_conversation_id || "",
                        }
                        : step
                    )));
                    void qc.invalidateQueries({ queryKey: ["admin-briefing"] });
                  }}
                  onConversationId={async (conversation) => {
                    const updated = await businessApi.setMilestoneReply(id, idx, {
                      reply: m.reply || "",
                      label: m.label,
                      conversation_id: conversation,
                    });
                    const saved = updated.milestones?.[idx];
                    setMilestones((current) => current.map((step, stepIndex) => (
                      stepIndex === idx
                        ? { ...step, chat_conversation_id: saved?.chat_conversation_id || conversation }
                        : step
                    )));
                  }}
                />
              ) : null}
              </div>
            ))}
            <button
              type="button"
              className="text-sm font-medium text-emerald-800 hover:underline"
              onClick={() => setMilestones([...milestones, { label: "", done: false }])}
            >
              + Ajouter une étape
            </button>
          </div>
          <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
            <button type="submit" className="btn-primary" disabled={save.isPending}>
              {save.isPending ? "Enregistrement…" : "Enregistrer les modifications"}
            </button>
            <Link href="/gestion/projets" className="btn-secondary">
              Retour à la liste
            </Link>
            {error ? <p className="text-sm text-red-700">{error}</p> : null}
            {saved ? <p className="text-sm text-emerald-800">{saved}</p> : null}
          </div>
        </form>
      </SectionCard>

      <ProjectTasksPanel projectId={id} />

      <SectionCard
        title={`Missions liées (${linkedJobs.length})`}
        action={
          <Link href="/carte" className="text-xs font-semibold text-violet-800 hover:underline">
            Voir sur la carte
          </Link>
        }
      >
        {jobs.isLoading ? <LoadingLine /> : null}
        {!jobs.isLoading && linkedJobs.length === 0 ? (
          <p className="text-sm text-slate-500">
            Aucune mission rattachée pour l’instant. Les missions liées apparaissent aussi sur la carte.
          </p>
        ) : null}
        <ul className="divide-y divide-slate-100">
          {linkedJobs.map((j) => (
            <li key={j.job_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div>
                <Link href={`/missions?job=${encodeURIComponent(j.job_id)}`} className="font-semibold text-slate-900 hover:underline">
                  {missionTitleLabel(j.mission, 80) || j.job_id}
                </Link>
                <p className="text-xs text-slate-500">{j.status === "planned" ? "À faire" : j.status || "—"}</p>
              </div>
              <Link
                href={`/missions?job=${encodeURIComponent(j.job_id)}`}
                className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-900"
              >
                Ouvrir
              </Link>
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard
        title={`Rendez-vous (${sessions.length})`}
        action={
          <Link href={planningHref(false)} className="btn-primary">
            + Planifier un rendez-vous
          </Link>
        }
      >
        {events.isLoading ? <LoadingLine /> : null}
        {events.isError ? <AlertBox tone="error" title="Erreur">Impossible de charger le calendrier du projet.</AlertBox> : null}
        {!events.isLoading && sessions.length === 0 ? (
          <p className="text-sm text-slate-500">
            Aucun rendez-vous rattaché. Les créneaux se créent dans le calendrier, liés à ce projet.
          </p>
        ) : null}
        <ul className="divide-y divide-slate-100">
          {sessions.map((ev) => (
            <EventRow key={ev.id} ev={ev} />
          ))}
        </ul>
      </SectionCard>

      <SectionCard
        title={`Science & contexte (${(scienceDocs.data || []).length})`}
        description="Nourrit « Où je vais » — pas le tri du jour."
        action={
          <Link href={`/gestion/science?nouveau=1&project=${encodeURIComponent(id)}`} className="btn-primary">
            + Document science
          </Link>
        }
      >
        <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
          Notes et stratégies de la Science de l&apos;entreprise rattachées à ce projet.
        </p>
        {scienceDocs.isLoading ? <LoadingLine /> : null}
        {!scienceDocs.isLoading && (scienceDocs.data || []).length === 0 ? (
          <p className="text-sm text-slate-500">Aucun document science pour ce projet.</p>
        ) : null}
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {(scienceDocs.data || []).map((doc) => (
            <li key={doc.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
              <div className="min-w-0">
                <Link
                  href={`/gestion/science/${doc.id}`}
                  className="font-semibold text-slate-900 hover:text-violet-900 hover:underline dark:text-slate-50"
                >
                  {doc.title}
                </Link>
                {doc.summary ? (
                  <div className="mt-1 max-h-12 overflow-hidden text-xs">
                    <AgentMessageMarkdown source={doc.summary} className="text-xs" />
                  </div>
                ) : null}
              </div>
              <Link
                href={`/gestion/science/${doc.id}`}
                className="text-xs font-bold text-violet-800 hover:underline dark:text-violet-200"
              >
                Ouvrir
              </Link>
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard
        title={`Médias calendrier (${resources.length})`}
        action={
          <Link href={planningHref(true)} className="btn-primary">
            + Ajouter un média
          </Link>
        }
      >
        <p className="mb-3 text-sm text-slate-600">
          Documents, vidéos et podcasts du calendrier (accès interne / public). Distinct de la Science.
        </p>
        {!events.isLoading && resources.length === 0 ? (
          <p className="text-sm text-slate-500">Aucun document rattaché à ce projet pour l’instant.</p>
        ) : null}
        <ul className="divide-y divide-slate-100">
          {resources.map((ev) => (
            <EventRow key={ev.id} ev={ev} />
          ))}
        </ul>
      </SectionCard>

      <SectionCard
        title={`Devis (${linkedQuotes.length})`}
        action={
          <Link href={devisHref()} className="btn-secondary">
            + Nouveau devis
          </Link>
        }
      >
        {quotes.isLoading ? <LoadingLine /> : null}
        {!quotes.isLoading && linkedQuotes.length === 0 ? (
          <p className="text-sm text-slate-500">Aucun devis lié à ce projet.</p>
        ) : null}
        <ul className="divide-y divide-slate-100">
          {linkedQuotes.map((q) => (
            <li key={q.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
              <div>
                <Link href={`/gestion/devis/${q.id}`} className="font-semibold text-slate-900 hover:text-emerald-900 hover:underline">
                  {q.title || q.quote_number}
                </Link>
                <p className="text-xs text-slate-500">
                  {QUOTE_STATUS_LABELS[q.status] || q.status} · {formatEuroCents(q.total_cents)}
                </p>
              </div>
              <Link
                href={`/gestion/devis/${q.id}`}
                className="touch-target inline-flex items-center rounded-lg border border-violet-200 bg-violet-50 px-3 text-xs font-semibold text-violet-900"
              >
                Ouvrir
              </Link>
            </li>
          ))}
        </ul>
      </SectionCard>
    </PageShell>
  );
}
