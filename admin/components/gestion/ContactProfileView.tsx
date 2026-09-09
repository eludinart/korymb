"use client";

import type { ReactNode } from "react";
import AgentMessageMarkdown from "../AgentMessageMarkdown";
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
        <Field label="LinkedIn" empty={!linkedin}>
          {linkedin ? <ExternalLink href={linkedin}>{contact.linkedin_url}</ExternalLink> : "—"}
        </Field>
        <Field label="Instagram" empty={!instagram}>
          {instagram ? <ExternalLink href={instagram}>{socials.instagram}</ExternalLink> : "—"}
        </Field>
        <Field label="Facebook" empty={!facebook}>
          {facebook ? <ExternalLink href={facebook}>{socials.facebook}</ExternalLink> : "—"}
        </Field>
        <Field label="YouTube" empty={!youtube}>
          {youtube ? <ExternalLink href={youtube}>{socials.youtube}</ExternalLink> : "—"}
        </Field>
        <Field label="Resalib / fiche métier" empty={!resalib}>
          {resalib ? <ExternalLink href={resalib}>{socials.resalib}</ExternalLink> : "—"}
        </Field>
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
          <div className="mt-1 text-sm text-slate-800 whitespace-pre-wrap">{contact.notes}</div>
        ) : (
          <p className="mt-1 text-sm text-slate-400">—</p>
        )}
      </div>

      {contact.outreach_suggestions?.trim() ? (
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Suggestions d’approche</p>
          <div className="mt-1 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2 text-sm">
            <AgentMessageMarkdown source={contact.outreach_suggestions} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
