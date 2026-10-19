"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertBox, LoadingLine, PageHeader, PageShell, SectionCard } from "../../../../components/ui/PageChrome";
import { businessApi, type BizContact, type BizProject, type EmailAttachment } from "../../../../lib/business";
import { CoverImageField } from "../../../../components/gestion/CoverImageField";
import { ResourceFileField } from "../../../../components/gestion/ResourceFileField";
import EventAccessFields from "../../../../components/gestion/EventAccessFields";
import EventKindFields from "../../../../components/gestion/EventKindFields";
import { EVENT_MODALITY_LABELS, EVENT_RESOURCE_TYPE_LABELS, EVENT_STATUS_LABELS, toDatetimeLocalValue, visibilityFromEvent, type EventVisibility } from "../../_shared";

export default function GestionPlanningEditPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [eventType, setEventType] = useState("seance");
  const [status, setStatus] = useState("planned");
  const [contactId, setContactId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [visibility, setVisibility] = useState<EventVisibility>("internal");
  const [audienceIds, setAudienceIds] = useState<string[]>([]);
  const [modality, setModality] = useState("");
  const [nature, setNature] = useState("presence");
  const [resourceType, setResourceType] = useState("");
  const [resourceUrl, setResourceUrl] = useState("");
  const [resourceFile, setResourceFile] = useState<EmailAttachment | null>(null);
  const [coverFile, setCoverFile] = useState<EmailAttachment | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const [error, setError] = useState("");
  const [hydrated, setHydrated] = useState(false);

  const event = useQuery({
    queryKey: ["business-event", id],
    queryFn: () => businessApi.getEvent(id),
    enabled: Boolean(id),
  });
  const contacts = useQuery({ queryKey: ["business-contacts"], queryFn: () => businessApi.listContacts() });
  const projects = useQuery({ queryKey: ["business-projects"], queryFn: () => businessApi.listProjects() });
  const participants = useQuery({ queryKey: ["storefront-participants"], queryFn: () => businessApi.listParticipants() });

  useEffect(() => {
    if (!event.data || hydrated) return;
    const ev = event.data;
    setTitle(ev.title || "");
    setStartsAt(toDatetimeLocalValue(ev.starts_at));
    setEndsAt(toDatetimeLocalValue(ev.ends_at));
    setEventType(ev.event_type || "seance");
    setStatus(ev.status || "planned");
    setContactId(ev.contact_id || "");
    setProjectId(ev.project_id || "");
    setLocation(ev.location || "");
    setNotes(ev.notes || "");
    setVisibility(visibilityFromEvent(ev));
    setAudienceIds(ev.audience_user_ids?.length ? ev.audience_user_ids : ev.audience_contact_ids || []);
    setModality(ev.modality || "");
    setNature(ev.nature === "matiere" || ev.resource_type ? "matiere" : "presence");
    setResourceType(ev.resource_type || "");
    setResourceUrl(ev.resource_url || "");
    setResourceFile(
      ev.resource_file_id
        ? {
            id: ev.resource_file_id,
            filename: ev.resource_filename || "fichier",
            mime: ev.resource_file_mime,
            size: ev.resource_file_size,
          }
        : null,
    );
    setCoverFile(
      ev.cover_file_id
        ? {
            id: ev.cover_file_id,
            filename: ev.cover_filename || "cover",
            mime: ev.cover_mime,
          }
        : null,
    );
    setHydrated(true);
  }, [event.data, hydrated]);

  const save = useMutation({
    mutationFn: () =>
      businessApi.updateEvent(id, {
        title: title.trim(),
        starts_at: new Date(startsAt).toISOString(),
        ends_at: endsAt ? new Date(endsAt).toISOString() : null,
        event_type: eventType,
        status,
        contact_id: contactId || null,
        project_id: projectId || null,
        location: location.trim(),
        notes: notes.trim(),
        visibility,
        audience_contact_ids: [],
        audience_user_ids: visibility === "selected" ? audienceIds : [],
        modality: resourceType && !modality ? "async" : modality,
        nature: resourceType ? "matiere" : nature,
        resource_type: resourceType,
        resource_url: resourceUrl.trim(),
        resource_file_id: resourceType ? resourceFile?.id || "" : "",
        cover_file_id: coverFile?.id || "",
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["business-events"] });
      void qc.invalidateQueries({ queryKey: ["business-event", id] });
      void qc.invalidateQueries({ queryKey: ["business-overview"] });
      router.push("/gestion/planning");
    },
    onError: (e: Error) => setError(e.message),
  });

  if (event.isLoading) {
    return (
      <PageShell size="wide">
        <LoadingLine label="Chargement du créneau…" />
      </PageShell>
    );
  }

  if (event.isError || !event.data) {
    return (
      <PageShell size="wide">
        <AlertBox tone="error" title="Créneau introuvable">
          <Link href="/gestion/planning" className="underline">
            Retour à l&apos;agenda
          </Link>
        </AlertBox>
      </PageShell>
    );
  }

  return (
    <PageShell size="wide" className="space-y-6">
      <PageHeader
        accent="emerald"
        badge="Calendrier"
        title={`Modifier — ${event.data.title}`}
        description="Rendez-vous ou contenu à ouvrir."
        actions={
          <Link href="/gestion/planning" className="btn-link-secondary">
            ← Retour à l&apos;agenda
          </Link>
        }
      />

      <SectionCard title="Créneau">
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) {
              setError("Le titre est obligatoire.");
              return;
            }
            if (visibility === "selected" && audienceIds.length === 0) {
              setError("Cochez au moins un participant actif pour un accès nominatif.");
              return;
            }
            save.mutate();
          }}
        >
          <label className="block text-sm sm:col-span-2">
            <span className="font-medium text-slate-700">Titre *</span>
            <input className="input-field mt-1 w-full" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </label>
          <EventKindFields
            nature={nature}
            eventType={eventType}
            onNature={setNature}
            onEventType={setEventType}
            onClearResource={() => setResourceType("")}
          />
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Statut</span>
            <select className="input-field mt-1 w-full" value={status} onChange={(e) => setStatus(e.target.value)}>
              {Object.entries(EVENT_STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Début *</span>
            <input type="datetime-local" className="input-field mt-1 w-full" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Fin</span>
            <input type="datetime-local" className="input-field mt-1 w-full" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
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
            <span className="mt-1 block text-xs text-slate-500">Prospect ou client lié au créneau. Ce n’est pas un participant.</span>
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Projet</span>
            <select className="input-field mt-1 w-full" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">— Aucun —</option>
              {(projects.data || []).map((p: BizProject) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="font-medium text-slate-700">Lieu</span>
            <input className="input-field mt-1 w-full" value={location} onChange={(e) => setLocation(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Modalité</span>
            <select className="input-field mt-1 w-full" value={modality} onChange={(e) => setModality(e.target.value)}>
              <option value="">— Non précisée —</option>
              {Object.entries(EVENT_MODALITY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <EventAccessFields
            visibility={visibility}
            onVisibility={setVisibility}
            audienceIds={audienceIds}
            onAudienceIds={setAudienceIds}
            participants={participants.data || []}
          />
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Fichier à partager</span>
            <select
              className="input-field mt-1 w-full"
              value={resourceType}
              onChange={(e) => {
                const v = e.target.value;
                setResourceType(v);
                if (v) {
                  setNature("matiere");
                  setEventType((prev) => (prev === "jalon" ? prev : "ressource"));
                  if (!modality) setModality("async");
                }
              }}
            >
              <option value="">— Aucun fichier —</option>
              {Object.entries(EVENT_RESOURCE_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-slate-500">
              Uniquement si les personnes doivent ouvrir un document, une vidéo ou un podcast. Pas besoin pour un rendez-vous.
            </span>
          </label>
          {resourceType ? (
            <div className="sm:col-span-2 space-y-3">
              <ResourceFileField file={resourceFile} onFile={setResourceFile} onBusy={setFileBusy} disabled={save.isPending} />
              <label className="block text-sm">
                <span className="font-medium text-slate-700">Lien externe (optionnel)</span>
                <input
                  className="input-field mt-1 w-full"
                  value={resourceUrl}
                  onChange={(e) => setResourceUrl(e.target.value)}
                  placeholder="https://… YouTube, Drive, page web…"
                />
              </label>
            </div>
          ) : null}
          <div className="sm:col-span-2">
            <CoverImageField file={coverFile} onFile={setCoverFile} onBusy={setFileBusy} disabled={save.isPending} />
          </div>
          <label className="block text-sm sm:col-span-2">
            <span className="font-medium text-slate-700">Notes</span>
            <textarea className="input-field mt-1 w-full" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
            <button type="submit" className="btn-primary" disabled={save.isPending || fileBusy}>
              {save.isPending || fileBusy ? "Enregistrement…" : "Enregistrer les modifications"}
            </button>
            <Link href="/gestion/planning" className="btn-secondary">
              Annuler
            </Link>
            {error ? <p className="text-sm text-red-700">{error}</p> : null}
          </div>
        </form>
      </SectionCard>
    </PageShell>
  );
}
