"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ContactReachabilityBadge from "../../../components/gestion/ContactReachabilityBadge";
import { AlertBox, LoadingLine, PageHeader, PageShell, SectionCard } from "../../../components/ui/PageChrome";
import { businessApi, type BizContact } from "../../../lib/business";
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

export default function GestionContactsPage() {
  const qc = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reachFilter, setReachFilter] = useState<ReachFilter>("all");

  const contacts = useQuery({
    queryKey: ["business-contacts"],
    queryFn: () => businessApi.listContacts(),
  });

  const filtered = useMemo(() => {
    const rows = contacts.data || [];
    if (reachFilter === "all") return rows;
    return rows.filter((c) => getContactReachability(c).level === reachFilter);
  }, [contacts.data, reachFilter]);

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
        description="Base CRM Élude In Art — coachs, thérapeutes, clients, partenaires. Les agents enrichissent automatiquement les fiches et journalisent leurs actions."
        actions={
          <Link href="/gestion/contacts/nouveau" className="btn-primary">
            + Nouveau contact
          </Link>
        }
      />

      <SectionCard
        title={`Liste (${filtered.length}${reachFilter !== "all" ? ` / ${contacts.data?.length ?? 0}` : ""})`}
        action={
          <label className="flex items-center gap-2 text-xs text-slate-600">
            Joignabilité
            <select
              className="input-field py-1 text-xs"
              value={reachFilter}
              onChange={(e) => setReachFilter(e.target.value as ReachFilter)}
            >
              <option value="all">Tous</option>
              <option value="complete">Complet</option>
              <option value="partial">Partiel</option>
              <option value="unreachable">Injoignable</option>
            </select>
          </label>
        }
      >
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
          <p className="text-sm text-slate-500">Aucun contact pour ce filtre de joignabilité.</p>
        ) : null}
        <ul className="divide-y divide-slate-100">
          {filtered.map((c: BizContact) => {
            const expanded = expandedId === c.id;
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
                      {c.email ? ` · ${c.email}` : ""}
                      {c.company ? ` · ${c.company}` : ""}
                      {c.website ? ` · ${c.website}` : ""}
                    </p>
                    {c.notes ? <p className="mt-1 text-sm text-slate-600 whitespace-pre-wrap">{c.notes}</p> : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/gestion/contacts/${c.id}`}
                      className="text-xs font-medium text-violet-800 hover:underline"
                    >
                      Explorer / modifier
                    </Link>
                    <button
                      type="button"
                      className="text-xs font-medium text-emerald-800 hover:underline"
                      onClick={() => setExpandedId(expanded ? null : c.id)}
                    >
                      {expanded ? "Masquer l'historique" : "Voir interactions"}
                    </button>
                    <button
                      type="button"
                      className="text-xs font-medium text-red-700 hover:underline"
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
