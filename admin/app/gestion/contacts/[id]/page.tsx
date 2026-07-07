"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertBox, LoadingLine, PageHeader, PageShell, SectionCard } from "../../../../components/ui/PageChrome";
import { businessApi } from "../../../../lib/business";
import { CONTACT_STATUS_LABELS, CONTACT_TYPE_LABELS, formatDateTime, INTERACTION_TYPE_LABELS } from "../../_shared";

export default function GestionContactEditPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [contactType, setContactType] = useState("prospect");
  const [status, setStatus] = useState("active");
  const [tags, setTags] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [hydrated, setHydrated] = useState(false);

  const contact = useQuery({
    queryKey: ["business-contact", id],
    queryFn: () => businessApi.getContact(id),
    enabled: Boolean(id),
  });

  const interactions = useQuery({
    queryKey: ["business-interactions", id],
    queryFn: () => businessApi.listInteractions(id),
    enabled: Boolean(id),
  });

  useEffect(() => {
    if (!contact.data || hydrated) return;
    const c = contact.data;
    setName(c.name || "");
    setEmail(c.email || "");
    setPhone(c.phone || "");
    setCompany(c.company || "");
    setContactType(c.contact_type || "prospect");
    setStatus(c.status || "active");
    setTags((c.tags || []).join(", "));
    setNotes(c.notes || "");
    setHydrated(true);
  }, [contact.data, hydrated]);

  const save = useMutation({
    mutationFn: () =>
      businessApi.updateContact(id, {
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        company: company.trim(),
        contact_type: contactType,
        status,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        notes: notes.trim(),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["business-contacts"] });
      void qc.invalidateQueries({ queryKey: ["business-contact", id] });
      void qc.invalidateQueries({ queryKey: ["business-overview"] });
      router.push("/gestion/contacts");
    },
    onError: (e: Error) => setError(e.message),
  });

  if (contact.isLoading) {
    return (
      <PageShell size="wide">
        <LoadingLine label="Chargement du contact…" />
      </PageShell>
    );
  }

  if (contact.isError || !contact.data) {
    return (
      <PageShell size="wide">
        <AlertBox tone="error" title="Contact introuvable">
          <Link href="/gestion/contacts" className="underline">
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
        badge="Contacts"
        title={`Modifier — ${contact.data.name}`}
        description={`Créé le ${formatDateTime(contact.data.created_at)}`}
        actions={
          <Link href="/gestion/contacts" className="btn-link-secondary">
            ← Retour à la liste
          </Link>
        }
      />

      <SectionCard title="Fiche contact">
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) {
              setError("Le nom est obligatoire.");
              return;
            }
            save.mutate();
          }}
        >
          <label className="block text-sm sm:col-span-2">
            <span className="font-medium text-slate-700">Nom *</span>
            <input className="input-field mt-1 w-full" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Type</span>
            <select className="input-field mt-1 w-full" value={contactType} onChange={(e) => setContactType(e.target.value)}>
              {Object.entries(CONTACT_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Statut</span>
            <select className="input-field mt-1 w-full" value={status} onChange={(e) => setStatus(e.target.value)}>
              {Object.entries(CONTACT_STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Email</span>
            <input type="email" className="input-field mt-1 w-full" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Téléphone</span>
            <input className="input-field mt-1 w-full" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="font-medium text-slate-700">Structure / entreprise</span>
            <input className="input-field mt-1 w-full" value={company} onChange={(e) => setCompany(e.target.value)} />
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="font-medium text-slate-700">Tags (séparés par des virgules)</span>
            <input className="input-field mt-1 w-full" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="coach, var, fleur" />
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="font-medium text-slate-700">Notes</span>
            <textarea className="input-field mt-1 w-full" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
            <button type="submit" className="btn-primary" disabled={save.isPending}>
              {save.isPending ? "Enregistrement…" : "Enregistrer les modifications"}
            </button>
            <Link href="/gestion/contacts" className="btn-secondary">
              Annuler
            </Link>
            {error ? <p className="text-sm text-red-700">{error}</p> : null}
          </div>
        </form>
      </SectionCard>

      <SectionCard title="Historique des interactions">
        {interactions.isLoading ? <LoadingLine /> : null}
        {(interactions.data || []).length === 0 ? (
          <p className="text-sm text-slate-500">Aucune interaction enregistrée.</p>
        ) : (
          <ul className="space-y-2">
            {(interactions.data || []).map((row) => (
              <li key={row.id} className="border-l-2 border-emerald-100 pl-3 text-sm">
                <p className="font-medium text-slate-800">
                  {INTERACTION_TYPE_LABELS[row.interaction_type] || row.interaction_type}
                  {row.summary ? ` — ${row.summary}` : ""}
                </p>
                <p className="text-xs text-slate-500">{formatDateTime(row.created_at)}</p>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </PageShell>
  );
}
