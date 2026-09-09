"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ContactEnrichmentPanel from "../../../../components/gestion/ContactEnrichmentPanel";
import ContactOutreachSuggestionsField from "../../../../components/gestion/ContactOutreachSuggestionsField";
import ContactProfileChips from "../../../../components/gestion/ContactProfileChips";
import ContactProfileView from "../../../../components/gestion/ContactProfileView";
import ContactReachabilityBadge from "../../../../components/gestion/ContactReachabilityBadge";
import { AlertBox, LoadingLine, PageHeader, PageShell, SectionCard } from "../../../../components/ui/PageChrome";
import { businessApi } from "../../../../lib/business";
import { CONTACT_STATUS_LABELS, CONTACT_TYPE_LABELS, formatDateTime, INTERACTION_TYPE_LABELS } from "../../_shared";

function parseTagsInput(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export default function GestionContactEditPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [website, setWebsite] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [instagram, setInstagram] = useState("");
  const [facebook, setFacebook] = useState("");
  const [resalib, setResalib] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [contactType, setContactType] = useState("prospect");
  const [status, setStatus] = useState("active");
  const [tags, setTags] = useState("");
  const [notes, setNotes] = useState("");
  const [outreachSuggestions, setOutreachSuggestions] = useState("");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");

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
    if (!contact.data) return;
    const c = contact.data;
    setName(c.name || "");
    setEmail(c.email || "");
    setPhone(c.phone || "");
    setCompany(c.company || "");
    setWebsite(c.website || "");
    setLinkedinUrl(c.linkedin_url || "");
    setInstagram(c.socials?.instagram || "");
    setFacebook(c.socials?.facebook || "");
    setResalib(c.socials?.resalib || "");
    setAddress(c.address || "");
    setCity(c.city || "");
    setPostalCode(c.postal_code || "");
    setContactType(c.contact_type || "prospect");
    setStatus(c.status || "active");
    setTags((c.tags || []).join(", "));
    setNotes(c.notes || "");
    setOutreachSuggestions(c.outreach_suggestions || "");
  }, [contact.data]);

  const save = useMutation({
    mutationFn: () =>
      businessApi.updateContact(id, {
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        company: company.trim(),
        website: website.trim(),
        linkedin_url: linkedinUrl.trim(),
        socials: {
          ...(contact.data?.socials || {}),
          instagram: instagram.trim(),
          facebook: facebook.trim(),
          resalib: resalib.trim(),
        },
        address: address.trim(),
        city: city.trim(),
        postal_code: postalCode.trim(),
        contact_type: contactType,
        status,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        notes: notes.trim(),
        outreach_suggestions: outreachSuggestions.trim(),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["business-contacts"] });
      void qc.invalidateQueries({ queryKey: ["business-contact", id] });
      void qc.invalidateQueries({ queryKey: ["business-overview"] });
      setEditing(false);
      setError("");
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
        title={contact.data.name}
        description={`Créé le ${formatDateTime(contact.data.created_at)}`}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <ContactReachabilityBadge contact={contact.data} />
            {editing ? (
              <button type="button" className="btn-secondary" onClick={() => setEditing(false)}>
                Annuler
              </button>
            ) : (
              <button type="button" className="btn-secondary" onClick={() => setEditing(true)}>
                Modifier la fiche
              </button>
            )}
            <Link href="/gestion/contacts" className="btn-link-secondary">
              ← Retour à la liste
            </Link>
          </div>
        }
      />

      <SectionCard title="Exploration détaillée">
        <ContactEnrichmentPanel contact={contact.data} />
      </SectionCard>

      <SectionCard title={editing ? "Modifier la fiche" : "Fiche contact"}>
        {!editing ? (
          <div className="space-y-5">
            <ContactProfileView contact={contact.data} />
            <ContactOutreachSuggestionsField
              contactId={id}
              value={contact.data.outreach_suggestions || ""}
              onChange={setOutreachSuggestions}
              readOnly
            />
          </div>
        ) : (
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
            <span className="font-medium text-slate-700">Relation</span>
            <select className="input-field mt-1 w-full" value={contactType} onChange={(e) => setContactType(e.target.value)}>
              {Object.entries(CONTACT_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <span className="mt-0.5 block text-xs text-slate-500">Prospect, client, partenaire…</span>
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
          <div className="sm:col-span-2">
            <p className="text-sm font-medium text-slate-700">Profil</p>
            <p className="mt-0.5 text-xs text-slate-500">Métier / cible — coach, thérapeute, éditeur, écolieu…</p>
            <div className="mt-1.5">
              <ContactProfileChips
                tags={parseTagsInput(tags)}
                onChange={(next) => setTags(next.join(", "))}
              />
            </div>
          </div>
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
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Site web</span>
            <input className="input-field mt-1 w-full" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">LinkedIn</span>
            <input className="input-field mt-1 w-full" value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} placeholder="https://linkedin.com/in/…" />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Instagram</span>
            <input className="input-field mt-1 w-full" value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="https://instagram.com/…" />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Facebook</span>
            <input className="input-field mt-1 w-full" value={facebook} onChange={(e) => setFacebook(e.target.value)} placeholder="https://facebook.com/…" />
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="font-medium text-slate-700">Resalib / fiche métier</span>
            <input className="input-field mt-1 w-full" value={resalib} onChange={(e) => setResalib(e.target.value)} placeholder="https://www.resalib.fr/…" />
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="font-medium text-slate-700">Adresse</span>
            <input className="input-field mt-1 w-full" value={address} onChange={(e) => setAddress(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Ville</span>
            <input className="input-field mt-1 w-full" value={city} onChange={(e) => setCity(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Code postal</span>
            <input className="input-field mt-1 w-full" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="font-medium text-slate-700">Tags libres (séparés par des virgules)</span>
            <input className="input-field mt-1 w-full" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Var, Fleur d'ÅmÔurs…" />
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="font-medium text-slate-700">Notes sur le contact</span>
            <p className="mt-0.5 text-xs text-slate-500">Faits : spécialité, SIRET, contexte métier, sources — pas l’angle de vente.</p>
            <textarea className="input-field mt-1 w-full" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <ContactOutreachSuggestionsField
            contactId={id}
            value={outreachSuggestions}
            onChange={setOutreachSuggestions}
          />
          {contact.data.verified_at ? (
            <p className="sm:col-span-2 text-xs text-emerald-800">
              Dernière validation enrichissement : {formatDateTime(contact.data.verified_at)}
            </p>
          ) : null}
          <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
            <button type="submit" className="btn-primary" disabled={save.isPending}>
              {save.isPending ? "Enregistrement…" : "Enregistrer les modifications"}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setEditing(false)}>
              Annuler
            </button>
            {error ? <p className="text-sm text-red-700">{error}</p> : null}
          </div>
        </form>
        )}
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
