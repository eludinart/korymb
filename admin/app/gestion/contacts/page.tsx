"use client";

import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ContactReachabilityBadge from "../../../components/gestion/ContactReachabilityBadge";
import { AlertBox, LoadingLine, PageHeader, PageShell, SectionCard } from "../../../components/ui/PageChrome";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "../../../components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
import { businessApi, type BizContact } from "../../../lib/business";
import { CONTACT_PROFILE_DEFS, contactMatchesProfile, extraProfileTags } from "../../../lib/contactProfiles";
import { getContactReachability } from "../../../lib/contactReachability";
import { CONTACT_TYPE_LABELS, formatDateTime, INTERACTION_TYPE_LABELS } from "../_shared";
import { useUndoRibbon } from "../../../lib/undoRibbon";

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

function isFlaggedTestContact(c: BizContact): boolean {
  const name = (c.name || "").toUpperCase();
  const tags = (c.tags || []).map((t) => t.trim().toLowerCase());
  return name.includes("[TEST]") || tags.includes("test") || tags.includes("test-prospection");
}

export default function GestionContactsPage() {
  const qc = useQueryClient();
  const { pushUndo } = useUndoRibbon();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string[]>([]);
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
    if (pendingDelete.length) {
      rows = rows.filter((c) => !pendingDelete.includes(c.id));
    }
    // Contacts marqués TEST en tête de liste
    return [...rows].sort((a, b) => Number(isFlaggedTestContact(b)) - Number(isFlaggedTestContact(a)));
  }, [contacts.data, profileFilter, relationFilter, reachFilter, pendingDelete]);

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
        badge="Personnes"
        title="Personnes"
        description="Les personnes et organisations que vous suivez. Les mots de classement sont les vôtres. Les enrichissements restent à valider."
        actions={
          <Link href="/gestion/contacts/nouveau" className="btn-primary">
            + Nouvelle personne
          </Link>
        }
      />

      <SectionCard
        title={`Liste (${filtered.length}${filtersActive ? ` / ${contacts.data?.length ?? 0}` : ""})`}
      >
        <div className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-3 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,1fr))_auto] lg:items-end">
          <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-slate-600">
            Classement
            <select
              className="input-field w-full py-2.5 text-sm"
              value={profileFilter}
              onChange={(e) => setProfileFilter(e.target.value)}
            >
              <option value="all">Tous</option>
              {extraTags.map((tag) => (
                <option key={tag} value={`tag:${tag}`}>
                  {tag}
                </option>
              ))}
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
          <Empty className="border border-dashed border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-900">
            <EmptyHeader>
              <EmptyTitle>Personne pour l&apos;instant</EmptyTitle>
              <EmptyDescription>Ajoutez quelqu&apos;un pour le retrouver ici.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Link href="/gestion/contacts/nouveau" className="btn-primary">
                Ajouter quelqu&apos;un
              </Link>
            </EmptyContent>
          </Empty>
        ) : null}
        {!contacts.isLoading && (contacts.data || []).length > 0 && filtered.length === 0 ? (
          <Empty className="border border-dashed border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-900">
            <EmptyHeader>
              <EmptyTitle>Personne pour ces filtres</EmptyTitle>
              <EmptyDescription>
                {profileFilter !== "all" ? `Classement « ${profileLabel(profileFilter)} ».` : "Élargissez un filtre pour revoir la liste."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
        {filtered.length > 0 ? (
        <Table className="min-w-[40rem]">
          <TableHeader>
            <TableRow>
              <TableHead>Personne</TableHead>
              <TableHead>Relation</TableHead>
              <TableHead>Joignabilité</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
          {filtered.map((c: BizContact) => {
            const expanded = expandedId === c.id;
            const tagLine = (c.tags || []).filter(Boolean).join(", ");
            const preview = notesPreview(c.notes);
            const flagged = isFlaggedTestContact(c);
            return (
              <Fragment key={c.id}>
              <TableRow
                className={flagged ? "bg-amber-50/80 dark:bg-amber-950/30" : undefined}
              >
                <TableCell className="align-top">
                  <div className="flex flex-wrap items-center gap-2">
                    {flagged ? (
                      <span className="rounded-md bg-amber-500 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-white">
                        Test
                      </span>
                    ) : null}
                    <Link href={`/gestion/contacts/${c.id}`} className="font-extrabold text-slate-950 hover:text-emerald-900 hover:underline dark:text-slate-50">
                      {c.name}
                    </Link>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {c.email || c.company || c.website || "Sans coordonnée affichée"}
                    {tagLine ? ` · ${tagLine}` : ""}
                  </p>
                  {preview ? <p className="mt-1 line-clamp-2 text-sm text-slate-600 dark:text-slate-300">{preview}</p> : null}
                </TableCell>
                <TableCell className="align-top text-slate-700 dark:text-slate-200">
                  {CONTACT_TYPE_LABELS[c.contact_type] || c.contact_type}
                </TableCell>
                <TableCell className="align-top">
                  <ContactReachabilityBadge contact={c} compact />
                </TableCell>
                <TableCell className="align-top text-right">
                  <div className="flex flex-col items-end gap-1">
                    <Link href={`/gestion/contacts/${c.id}`} className="btn-primary px-3 py-1.5 text-xs">
                      Ouvrir
                    </Link>
                    <button
                      type="button"
                      className="text-xs font-semibold text-slate-600 underline-offset-2 hover:underline dark:text-slate-300"
                      onClick={() => setExpandedId(expanded ? null : c.id)}
                    >
                      {expanded ? "Masquer" : "Interactions"}
                    </button>
                    <button
                      type="button"
                      className="text-xs font-semibold text-red-800 underline-offset-2 hover:underline disabled:opacity-50 dark:text-red-300"
                      disabled={remove.isPending}
                      onClick={() => {
                        setPendingDelete((prev) => (prev.includes(c.id) ? prev : [...prev, c.id]));
                        pushUndo(
                          `Suppression de ${c.name}`,
                          () => setPendingDelete((prev) => prev.filter((id) => id !== c.id)),
                          () => {
                            remove.mutate(c.id, {
                              onError: () => setPendingDelete((prev) => prev.filter((id) => id !== c.id)),
                              onSuccess: () => setPendingDelete((prev) => prev.filter((id) => id !== c.id)),
                            });
                          },
                        );
                      }}
                    >
                      Supprimer
                    </button>
                  </div>
                </TableCell>
              </TableRow>
              {expanded ? (
                <TableRow key={`${c.id}-notes`}>
                  <TableCell colSpan={4} className="pb-3">
                    <ContactInteractions contactId={c.id} />
                  </TableCell>
                </TableRow>
              ) : null}
              </Fragment>
            );
          })}
          </TableBody>
        </Table>
        ) : null}
      </SectionCard>
    </PageShell>
  );
}
