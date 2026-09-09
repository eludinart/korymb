"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader, PageShell, SectionCard } from "../../../../components/ui/PageChrome";
import ContactProfileChips from "../../../../components/gestion/ContactProfileChips";
import { businessApi } from "../../../../lib/business";
import { CONTACT_TYPE_LABELS } from "../../_shared";

export default function GestionContactNouveauPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [website, setWebsite] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [contactType, setContactType] = useState("prospect");
  const [profileTags, setProfileTags] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  const create = useMutation({
    mutationFn: () =>
      businessApi.createContact({
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        company: company.trim(),
        website: website.trim(),
        linkedin_url: linkedinUrl.trim(),
        address: address.trim(),
        city: city.trim(),
        postal_code: postalCode.trim(),
        contact_type: contactType,
        tags: profileTags,
        notes: notes.trim(),
      }),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: ["business-contacts"] });
      void qc.invalidateQueries({ queryKey: ["business-overview"] });
      router.push(`/gestion/contacts/${created.id}`);
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <PageShell size="wide" className="space-y-6">
      <PageHeader
        accent="emerald"
        badge="Contacts"
        title="Nouveau contact"
        description="Ajoutez un prospect, client ou partenaire à la base CRM."
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
            create.mutate();
          }}
        >
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Nom *</span>
            <input className="input-field mt-1 w-full" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
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
          <div className="sm:col-span-2">
            <p className="text-sm font-medium text-slate-700">Profil</p>
            <p className="mt-0.5 text-xs text-slate-500">Métier / cible — utilisé pour filtrer la liste.</p>
            <div className="mt-1.5">
              <ContactProfileChips tags={profileTags} onChange={setProfileTags} />
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
            <span className="font-medium text-slate-700">Notes</span>
            <textarea className="input-field mt-1 w-full" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
            <button type="submit" className="btn-primary" disabled={create.isPending}>
              {create.isPending ? "Enregistrement…" : "Enregistrer le contact"}
            </button>
            <Link href="/gestion/contacts" className="btn-secondary">
              Annuler
            </Link>
            {error ? <p className="text-sm text-red-700">{error}</p> : null}
          </div>
        </form>
      </SectionCard>
    </PageShell>
  );
}
