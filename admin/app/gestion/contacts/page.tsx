"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ContactReachabilityBadge from "../../../components/gestion/ContactReachabilityBadge";
import { AlertBox, LoadingLine, PageHeader, PageShell, SectionCard } from "../../../components/ui/PageChrome";
import { businessApi, type BizContact } from "../../../lib/business";
import {
  CONTACT_PROFILE_DEFS,
  contactMatchesProfile,
  contactProfileKeys,
  extraProfileTags,
} from "../../../lib/contactProfiles";
import { getContactReachability } from "../../../lib/contactReachability";
import { CONTACT_TYPE_LABELS, formatDateTime, INTERACTION_TYPE_LABELS } from "../_shared";

type ReachFilter = "all" | "complete" | "partial" | "unreachable";

function ContactInteractions({ contactId }: { contactId: string }) {
  const interactions = useQuery({
    queryKey: ["business-interactions", contactId],
    queryFn: () => businessApi.listInteractions(contactId),
  });

  if (interactions.isLoading) return <LoadingLine />;
  if (interactions.isError) {
    return <p className="text-xs text-red-700">Impossible de charger l&apos;historique.</p>;
  }
  const rows = interactions.data || [];
  if (rows.length === 0) {
    return <p className="text-xs text-slate-500">Aucune interaction enregistrée.</p>;
  }
  return (
    <ul className="mt-2 space-y-2 border-l-2 border-emerald-100 pl-3">
      {rows.map((row) => (
        <li key={row.id} className="text-xs">
          <p className="font-medium text-slate-800">
            {INTERACTION_TYPE_LABELS[row.interaction_type] || row.interaction_type}
            {row.summary ? ` — ${row.summary}` : ""}
          </p>
          <p className="text-slate-500">
            {formatDateTime(row.created_at)}
            {row.agent_key ? ` · agent ${row.agent_key}` : ""}
            {row.job_id ? ` · mission ${row.job_id}` : ""}
          </p>
          {row.details ? <p className="mt-0.5 text-slate-600 whitespace-pre-wrap">{row.details}</p> : null}
        </li>
      ))}
    </ul>
  );
}

function profileLabel(key: string): string {
  if (key.startsWith("tag:")) return key.slice(4);
  return CONTACT_PROFILE_DEFS.find((p) => p.key === key)?.label || key;
}

/** Extrait court pour la liste — le détail reste sur la fiche contact. */
function notesPreview(notes: string | undefined, max = 140): string | null {
  const raw = (notes || "").replace(/\s+/g, " ").trim();
  if (!raw) return null;
  if (raw.length <= max) return raw;
  return `${raw.slice(0, max).trimEnd()}…`;
}

export default function GestionContactsPage() {
  const qc = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reachFilter, setReachFilter] = useState<ReachFilter>("all");
  const [profileFilter, setProfileFilter] = useState("all");
  const [relationFilter, setRelationFilter] = useState("all");

  const contacts = useQuery({
    queryKey: ["business-contacts"],
    queryFn: () => businessApi.listContacts(),
  });

  const extraTags = useMemo(() => extraProfileTags(contacts.data || []), [contacts.data]);

  const filtered = useMemo(() => {
    let rows = contacts.data || [];
    if (profileFilter !== "all") {
      rows = rows.filter((c) => contactMatchesProfile(c, profileFilter));
    }
    if (relationFilter !== "all") {
      rows = rows.filter((c) => c.contact_type === relationFilter);
    }
    if (reachFilter !== "all") {
      rows = rows.filter((c) => getContactReachability(c).level === reachFilter);
    }
    return rows;
  }, [contacts.data, profileFilter, relationFilter, reachFilter]);

  const filtersActive = profileFilter !== "all" || relationFilter !== "all" || reachFilter !== "all";

  const remove = useMutation({
    mutationFn: (id: string) => businessApi.deleteContact(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["business-contacts"] });
      void qc.invalidateQueries({ queryKey: ["business-overview"] });
    },
  });

  return (
    <PageShell size="wide" className="space-y-6">
      <PageHeader
        accent="emerald"
        badge="Contacts"
        title="Contacts & relations"
        description="Base CRM Élude In Art — filtrer par profil (coach, thérapeute, éditeur…) et par relation (prospect, client…). Les agents proposent des enrichissements à valider."
        actions={
          <Link href="/gestion/contacts/nouveau" className="btn-primary">
            + Nouveau contact
          </Link>
        }
      />

      <SectionCard
        title={`Liste (${filtered.length}${filtersActive ? ` / ${contacts.data?.length ?? 0}` : ""})`}
      >
        <div className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-3 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,1fr))_auto] lg:items-end">
          <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-slate-600">
            Profil
            <select
              className="input-field w-full py-2.5 text-sm"
              value={profileFilter}
              onChange={(e) => setProfileFilter(e.target.value)}
            >
              <option value="all">Tous les profils</option>
              {CONTACT_PROFILE_DEFS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
              {extraTags.length ? (
                <optgroup label="Autres tags">
                  {extraTags.map((tag) => (
                    <option key={tag} value={`tag:${tag}`}>
                      {tag}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-slate-600">
            Relation
            <select
              className="input-field w-full py-2.5 text-sm"
              value={relationFilter}
              onChange={(e) => setRelationFilter(e.target.value)}
            >
              <option value="all">Toutes les relations</option>
              {Object.entries(CONTACT_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-slate-600">
            Joignabilité
            <select
              className="input-field w-full py-2.5 text-sm"
              value={reachFilter}
              onChange={(e) => setReachFilter(e.target.value as ReachFilter)}
            >
              <option value="all">Tous</option>
              <option value="complete">Complet</option>
              <option value="partial">Partiel</option>
              <option value="unreachable">Injoignable</option>
            </select>
          </label>
          {filtersActive ? (
            <button
              type="button"
              className="touch-target text-xs font-medium text-slate-600 underline-offset-2 hover:text-slate-900 hover:underline sm:self-end"
              onClick={() => {
                setProfileFilter("all");
                setRelationFilter("all");
                setReachFilter("all");
              }}
            >
              Réinitialiser
            </button>
          ) : null}
        </div>

        {contacts.isLoading ? <LoadingLine /> : null}
        {contacts.isError ? (
          <AlertBox tone="error" title="Erreur">
            Impossible de charger les contacts.
          </AlertBox>
        ) : null}
        {!contacts.isLoading && (contacts.data || []).length === 0 ? (
          <p className="text-sm text-slate-500">
            Aucun contact pour l&apos;instant.{" "}
            <Link href="/gestion/contacts/nouveau" className="font-medium text-emerald-800 underline">
              Ajouter un contact
            </Link>
          </p>
        ) : null}
        {!contacts.isLoading && (contacts.data || []).length > 0 && filtered.length === 0 ? (
          <p className="text-sm text-slate-500">
            Aucun contact pour ces filtres
            {profileFilter !== "all" ? ` (profil « ${profileLabel(profileFilter)} »)` : ""}.
            Posez un profil via les tags sur la fiche contact.
          </p>
        ) : null}
        <ul className="divide-y divide-slate-100">
          {filtered.map((c: BizContact) => {
            const expanded = expandedId === c.id;
            const profiles = contactProfileKeys(c);
            const preview = notesPreview(c.notes);
            return (
              <li key={c.id} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-900">
                        <Link href={`/gestion/contacts/${c.id}`} className="hover:text-emerald-900 hover:underline">
                          {c.name}
                        </Link>
                      </p>
                      <ContactReachabilityBadge contact={c} compact />
                    </div>
                    <p className="text-xs text-slate-500">
                      {CONTACT_TYPE_LABELS[c.contact_type] || c.contact_type}
                      {profiles.length
                        ? ` · ${profiles.map((k) => CONTACT_PROFILE_DEFS.find((p) => p.key === k)?.label || k).join(", ")}`
                        : ""}
                      {c.email ? ` · ${c.email}` : ""}
                      {c.company ? ` · ${c.company}` : ""}
                      {c.website ? ` · ${c.website}` : ""}
                    </p>
                    {preview ? <p className="mt-1 line-clamp-2 text-sm text-slate-600">{preview}</p> : null}
                  </div>
                  <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
                    <Link
                      href={`/gestion/contacts/${c.id}`}
                      className="touch-target inline-flex items-center rounded-lg border border-violet-200 bg-violet-50 px-3 text-xs font-semibold text-violet-900"
                    >
                      Ouvrir
                    </Link>
                    <button
                      type="button"
                      className="touch-target inline-flex items-center rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-900"
                      onClick={() => setExpandedId(expanded ? null : c.id)}
                    >
                      {expanded ? "Masquer" : "Interactions"}
                    </button>
                    <button
                      type="button"
                      className="touch-target inline-flex items-center rounded-lg border border-red-200 bg-red-50 px-3 text-xs font-semibold text-red-800 disabled:opacity-50"
                      disabled={remove.isPending}
                      onClick={() => {
                        if (window.confirm(`Supprimer ${c.name} ?`)) remove.mutate(c.id);
                      }}
                    >
                      Supprimer
                    </button>
                  </div>
                </div>
                {expanded ? <ContactInteractions contactId={c.id} /> : null}
              </li>
            );
          })}
        </ul>
      </SectionCard>
    </PageShell>
  );
}
