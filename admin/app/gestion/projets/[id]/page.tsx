"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertBox, LoadingLine, PageHeader, PageShell, SectionCard } from "../../../../components/ui/PageChrome";
import { businessApi, type BizContact } from "../../../../lib/business";
import { PROJECT_STATUS_LABELS, PROJECT_TYPE_LABELS } from "../../_shared";

export default function GestionProjetEditPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [contactId, setContactId] = useState("");
  const [projectType, setProjectType] = useState("autre");
  const [status, setStatus] = useState("active");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [hydrated, setHydrated] = useState(false);

  const project = useQuery({
    queryKey: ["business-project", id],
    queryFn: () => businessApi.getProject(id),
    enabled: Boolean(id),
  });
  const contacts = useQuery({ queryKey: ["business-contacts"], queryFn: () => businessApi.listContacts() });

  useEffect(() => {
    if (!project.data || hydrated) return;
    const p = project.data;
    setTitle(p.title || "");
    setContactId(p.contact_id || "");
    setProjectType(p.project_type || "autre");
    setStatus(p.status || "active");
    setLocation(p.location || "");
    setDescription(p.description || "");
    setHydrated(true);
  }, [project.data, hydrated]);

  const save = useMutation({
    mutationFn: () =>
      businessApi.updateProject(id, {
        title: title.trim(),
        contact_id: contactId || null,
        project_type: projectType,
        status,
        location: location.trim(),
        description: description.trim(),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["business-projects"] });
      void qc.invalidateQueries({ queryKey: ["business-project", id] });
      void qc.invalidateQueries({ queryKey: ["business-overview"] });
      router.push("/gestion/projets");
    },
    onError: (e: Error) => setError(e.message),
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
        title={`Modifier — ${project.data.title}`}
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
          <label className="block text-sm sm:col-span-2">
            <span className="font-medium text-slate-700">Description</span>
            <textarea className="input-field mt-1 w-full" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
            <button type="submit" className="btn-primary" disabled={save.isPending}>
              {save.isPending ? "Enregistrement…" : "Enregistrer les modifications"}
            </button>
            <Link href="/gestion/projets" className="btn-secondary">
              Annuler
            </Link>
            {error ? <p className="text-sm text-red-700">{error}</p> : null}
          </div>
        </form>
      </SectionCard>
    </PageShell>
  );
}
