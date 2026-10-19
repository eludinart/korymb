"use client";

import { useState, type ReactNode } from "react";
import FactNotesView from "./FactNotesView";
import OutreachSuggestionsView from "./OutreachSuggestionsView";
import { CONTACT_STATUS_LABELS, CONTACT_TYPE_LABELS } from "../../app/gestion/_shared";
import type { BizContact } from "../../lib/business";
import { httpHref, mailtoHref, mapsHref, telHref } from "../../lib/contactLinks";

function Field({
  label,
  children,
  empty = false,
}: {
  label: string;
  children: ReactNode;
  empty?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <div className={empty ? "mt-0.5 text-sm text-slate-400" : "mt-0.5 text-sm text-slate-800"}>{children}</div>
    </div>
  );
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  if (!href) return <>{children}</>;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="break-all font-medium text-emerald-800 underline">
      {children}
    </a>
  );
}

function Action({ href, label }: { href: string; label: string }) {
  if (!href) return null;
  return (
    <a href={href} className="btn-secondary px-3 py-1.5 text-xs">
      {label}
    </a>
  );
}

export default function ContactProfileView({ contact }: { contact: BizContact }) {
  const mail = mailtoHref(contact.email);
  const tel = telHref(contact.phone);
  const site = httpHref(contact.website);
  const linkedin = httpHref(contact.linkedin_url);
  const socials = contact.socials || {};
  const instagram = httpHref(socials.instagram);
  const facebook = httpHref(socials.facebook);
  const youtube = httpHref(socials.youtube);
  const resalib = httpHref(socials.resalib);
  const maps = mapsHref([contact.address, contact.postal_code, contact.city]);
  const tags = contact.tags || [];
  const [showEmpty, setShowEmpty] = useState(false);
  const optional = [
    { label: "LinkedIn", href: linkedin, text: contact.linkedin_url || "" },
    { label: "Instagram", href: instagram, text: socials.instagram || "" },
    { label: "Facebook", href: facebook, text: socials.facebook || "" },
    { label: "YouTube", href: youtube, text: socials.youtube || "" },
    { label: "Fiche en ligne", href: resalib, text: socials.resalib || "" },
  ];
  const filledOptional = optional.filter((row) => row.href);
  const emptyOptional = optional.filter((row) => !row.href);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {mail ? <Action href={mail} label="Écrire un e-mail" /> : null}
        {tel ? <Action href={tel} label="Appeler" /> : null}
        {site ? <Action href={site} label="Ouvrir le site" /> : null}
        {maps ? <Action href={maps} label="Voir sur la carte" /> : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nom">{contact.name}</Field>
        <Field label="Type / statut">
          {CONTACT_TYPE_LABELS[contact.contact_type] || contact.contact_type}
          {" · "}
          {CONTACT_STATUS_LABELS[contact.status] || contact.status}
        </Field>
        <Field label="E-mail" empty={!contact.email}>
          {mail ? <ExternalLink href={mail}>{contact.email}</ExternalLink> : "—"}
        </Field>
        <Field label="Téléphone" empty={!contact.phone}>
          {tel ? <a href={tel} className="font-medium text-emerald-800 underline">{contact.phone}</a> : "—"}
        </Field>
        <Field label="Structure" empty={!contact.company}>
          {contact.company || "—"}
        </Field>
        <Field label="Site web" empty={!site}>
          {site ? <ExternalLink href={site}>{contact.website}</ExternalLink> : "—"}
        </Field>
        {filledOptional.map((row) => (
          <Field key={row.label} label={row.label}>
            <ExternalLink href={row.href}>{row.text}</ExternalLink>
          </Field>
        ))}
        {showEmpty
          ? emptyOptional.map((row) => (
              <Field key={row.label} label={row.label} empty>
                —
              </Field>
            ))
          : null}
        <Field label="Adresse" empty={!contact.address && !contact.city}>
          {maps ? (
            <ExternalLink href={maps}>
              {[contact.address, contact.postal_code, contact.city].filter(Boolean).join(", ")}
            </ExternalLink>
          ) : (
            "—"
          )}
        </Field>
      </div>

      {emptyOptional.length > 0 ? (
        <button
          type="button"
          onClick={() => setShowEmpty((v) => !v)}
          className="text-sm font-bold text-emerald-800 underline-offset-2 hover:underline"
        >
          {showEmpty ? "Masquer les champs vides" : "Compléter la fiche"}
        </button>
      ) : null}

      {tags.length ? (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span key={tag} className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-900">
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      <div>
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Notes factuelles</p>
        {contact.notes?.trim() ? (
          <div className="mt-2">
            <FactNotesView source={contact.notes} />
          </div>
        ) : (
          <p className="mt-1 text-sm text-slate-400">—</p>
        )}
      </div>

      {contact.outreach_suggestions?.trim() ? (
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Suggestions d’approche</p>
          <div className="mt-2">
            <OutreachSuggestionsView source={contact.outreach_suggestions} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
