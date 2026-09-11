"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LoadingLine, PageHeader, PageShell, SectionCard } from "../../../../components/ui/PageChrome";
import { businessApi, type BizContact, type BizProject, type EmailAttachment } from "../../../../lib/business";
import { CoverImageField } from "../../../../components/gestion/CoverImageField";
import { ResourceFileField } from "../../../../components/gestion/ResourceFileField";
import EventAccessFields from "../../../../components/gestion/EventAccessFields";
import EventKindFields from "../../../../components/gestion/EventKindFields";
import { EVENT_MODALITY_LABELS, EVENT_RESOURCE_TYPE_LABELS, type EventVisibility } from "../../_shared";

function defaultStartsAt(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
}

function safeNextPath(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/gestion/planning";
  return raw;
}

export default function GestionPlanningNouveauPage() {
  return (
    <Suspense
      fallback={
        <PageShell size="wide">
          <LoadingLine label="Chargement du formulaire…" />
        </PageShell>
      }
    >
      <GestionPlanningNouveauForm />
    </Suspense>
  );
}

function GestionPlanningNouveauForm() {
  const router = useRouter();
  const qc = useQueryClient();
  const search = useSearchParams();
  const presetProject = search.get("project") || "";
  const presetContact = search.get("contact") || "";
  const asResource = search.get("resource") === "1";
  const returnTo = safeNextPath(search.get("next"));
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState(defaultStartsAt);
  const [endsAt, setEndsAt] = useState("");
  const [eventType, setEventType] = useState(asResource ? "ressource" : "seance");
  const [contactId, setContactId] = useState(presetContact);
  const [projectId, setProjectId] = useState(presetProject);
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [visibility, setVisibility] = useState<EventVisibility>("internal");
  const [audienceIds, setAudienceIds] = useState<string[]>([]);
  const [modality, setModality] = useState(asResource ? "async" : "");
  const [nature, setNature] = useState(asResource ? "matiere" : "presence");
  const [resourceType, setResourceType] = useState(asResource ? "document" : "");
  const [resourceUrl, setResourceUrl] = useState("");
  const [resourceFile, setResourceFile] = useState<EmailAttachment | null>(null);
  const [coverFile, setCoverFile] = useState<EmailAttachment | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const [error, setError] = useState("");

  const contacts = useQuery({ queryKey: ["business-contacts"], queryFn: () => businessApi.listContacts() });
  const projects = useQuery({ queryKey: ["business-projects"], queryFn: () => businessApi.listProjects() });
  const participants = useQuery({ queryKey: ["storefront-participants"], queryFn: () => businessApi.listParticipants() });

  const create = useMutation({
    mutationFn: () =>
      businessApi.createEvent({
        title: title.trim(),
        starts_at: new Date(startsAt).toISOString(),
        ends_at: endsAt ? new Date(endsAt).toISOString() : null,
        event_type: eventType,
        contact_id: contactId || null,
        project_id: projectId || null,
        location: location.trim(),
        notes: notes.trim(),
        status: "planned",
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
      void qc.invalidateQueries({ queryKey: ["business-overview"] });
      router.push(returnTo);
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <PageShell size="wide" className="space-y-6">
      <PageHeader
        accent="emerald"
        badge="Planning"
        title={asResource ? "Ajouter un document ou une vidéo" : "Planifier un rendez-vous"}
        description="Un rendez-vous (séance, atelier, visio) ou un contenu à ouvrir (document, vidéo, podcast). Puis qui y a accès : interne, personnes nommées, tous les inscrits, ou public sans compte."
        actions={
          <Link href={returnTo} className="btn-link-secondary">
            ← Retour
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
            create.mutate();
          }}
        >
          <label className="block text-sm sm:col-span-2">
            <span className="font-medium text-slate-700">Titre *</span>
            <input className="input-field mt-1 w-full" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
          </label>
          <EventKindFields
            nature={nature}
            eventType={eventType}
            onNature={setNature}
            onEventType={setEventType}
            onClearResource={() => setResourceType("")}
          />
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
            <input className="input-field mt-1 w-full" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Lieu, visio, adresse…" />
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
              <ResourceFileField file={resourceFile} onFile={setResourceFile} onBusy={setFileBusy} disabled={create.isPending} />
              <label className="block text-sm">
                <span className="font-medium text-slate-700">Lien externe (optionnel)</span>
                <input
                  className="input-field mt-1 w-full"
                  value={resourceUrl}
                  onChange={(e) => setResourceUrl(e.target.value)}
                  placeholder="https://… YouTube, Drive, page web…"
                />
                <span className="mt-1 block text-xs text-slate-500">
                  En plus du fichier, ou à la place. Visible selon l’accès choisi, à partir de la date de début.
                </span>
              </label>
            </div>
          ) : null}
          <div className="sm:col-span-2">
            <CoverImageField file={coverFile} onFile={setCoverFile} onBusy={setFileBusy} disabled={create.isPending} />
          </div>
          <label className="block text-sm sm:col-span-2">
            <span className="font-medium text-slate-700">Notes</span>
            <textarea className="input-field mt-1 w-full" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
            <button type="submit" className="btn-primary" disabled={create.isPending || fileBusy}>
              {create.isPending || fileBusy ? "Enregistrement…" : "Ajouter au planning"}
            </button>
            <Link href={returnTo} className="btn-secondary">
              Annuler
            </Link>
            {error ? <p className="text-sm text-red-700">{error}</p> : null}
          </div>
        </form>
      </SectionCard>
    </PageShell>
  );
}
