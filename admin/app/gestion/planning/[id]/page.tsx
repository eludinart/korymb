"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertBox, LoadingLine, PageHeader, PageShell, SectionCard } from "../../../../components/ui/PageChrome";
import { businessApi, type BizContact, type BizProject } from "../../../../lib/business";
import { EVENT_STATUS_LABELS, EVENT_TYPE_LABELS, toDatetimeLocalValue } from "../../_shared";

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
  const [error, setError] = useState("");
  const [hydrated, setHydrated] = useState(false);

  const event = useQuery({
    queryKey: ["business-event", id],
    queryFn: () => businessApi.getEvent(id),
    enabled: Boolean(id),
  });
  const contacts = useQuery({ queryKey: ["business-contacts"], queryFn: () => businessApi.listContacts() });
  const projects = useQuery({ queryKey: ["business-projects"], queryFn: () => businessApi.listProjects() });

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
        badge="Planning"
        title={`Modifier — ${event.data.title}`}
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
            save.mutate();
          }}
        >
          <label className="block text-sm sm:col-span-2">
            <span className="font-medium text-slate-700">Titre *</span>
            <input className="input-field mt-1 w-full" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Type</span>
            <select className="input-field mt-1 w-full" value={eventType} onChange={(e) => setEventType(e.target.value)}>
              {Object.entries(EVENT_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
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
            <span className="font-medium text-slate-700">Contact</span>
            <select className="input-field mt-1 w-full" value={contactId} onChange={(e) => setContactId(e.target.value)}>
              <option value="">— Aucun —</option>
              {(contacts.data || []).map((c: BizContact) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
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
          <label className="block text-sm sm:col-span-2">
            <span className="font-medium text-slate-700">Notes</span>
            <textarea className="input-field mt-1 w-full" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
            <button type="submit" className="btn-primary" disabled={save.isPending}>
              {save.isPending ? "Enregistrement…" : "Enregistrer les modifications"}
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
