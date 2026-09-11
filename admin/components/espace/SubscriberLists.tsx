"use client";

import Link from "next/link";
import { useState } from "react";
import { subscriberEventCoverUrl, subscriberResourceFileUrl } from "../../lib/business";
import { PracticeMediaCard } from "../practice/PracticeMediaCard";
import { ResourcePreviewModal } from "./ResourcePreview";
import {
  formatStorefrontDate,
  modalityLabel,
  resourceDisplayName,
  RESOURCE_TYPE_LABELS,
  type StorefrontEvent,
  type StorefrontPublic,
} from "../../lib/storefront";

export function SubscriberSpaceStatus({
  loading,
  error,
  slug,
}: {
  loading: boolean;
  error: unknown;
  slug?: string;
}) {
  if (loading) {
    return <p className="text-sm text-slate-500">Chargement de votre espace…</p>;
  }
  return (
    <div className="rounded-2xl border border-red-100 bg-red-50 p-6">
      <h1 className="text-lg font-bold text-red-900">Espace inaccessible</h1>
      <p className="mt-2 text-sm text-red-800">
        {error instanceof Error ? error.message : "Connectez-vous avec un compte participant."}
      </p>
      <Link href={slug ? `/p/${encodeURIComponent(slug)}` : "/"} className="mt-4 inline-block font-semibold underline">
        Voir la vitrine
      </Link>
    </div>
  );
}

function ResourceActions({ ev }: { ev: StorefrontEvent }) {
  const [open, setOpen] = useState(false);
  const label = resourceDisplayName(ev);
  const download = ev.has_file ? (
    <a
      href={subscriberResourceFileUrl(ev.id)}
      className="mt-2 mr-3 inline-block text-sm font-bold text-violet-800 underline"
    >
      Télécharger
    </a>
  ) : null;
  const consult = ev.has_file ? (
    <button
      type="button"
      className="mt-2 mr-3 inline-block text-sm font-bold text-violet-800 underline"
      onClick={() => setOpen(true)}
    >
      Consulter
    </button>
  ) : null;
  const external = ev.resource_url ? (
    <a
      href={ev.resource_url}
      target="_blank"
      rel="noreferrer"
      className="mt-2 inline-block text-sm font-bold text-violet-800 underline"
    >
      Ouvrir le lien
    </a>
  ) : null;
  if (!consult && !download && !external) {
    return <p className="mt-2 text-sm text-slate-500">Fichier ou lien à venir.</p>;
  }
  return (
    <>
      <p>
        {consult}
        {download}
        {external}
      </p>
      {open ? (
        <ResourcePreviewModal
          title={label}
          mime={ev.resource_file_mime}
          filename={ev.resource_filename}
          inlineUrl={subscriberResourceFileUrl(ev.id, true)}
          downloadUrl={subscriberResourceFileUrl(ev.id)}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function coverOf(ev: StorefrontEvent) {
  return ev.has_cover ? subscriberEventCoverUrl(ev.id) : null;
}

export function SessionList({ events, hideEmpty }: { events: StorefrontEvent[]; hideEmpty?: boolean }) {
  if (events.length === 0) {
    if (hideEmpty) return null;
    return <p className="mt-3 text-sm text-slate-600">Aucune séance, atelier ou visio n’est encore ouvert.</p>;
  }
  return (
    <ul className="mt-4 grid gap-4 sm:grid-cols-2">
      {events.map((ev) => (
        <li key={ev.id}>
          <PracticeMediaCard coverUrl={coverOf(ev)} title={ev.title}>
            <p className="mt-1 text-sm text-slate-600">{formatStorefrontDate(ev.starts_at)}</p>
            <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-emerald-800">
              {modalityLabel(ev.modality, ev.event_type)}
              {ev.location ? ` · ${ev.location}` : ""}
              {ev.visibility === "selected" ? " · pour vous" : ev.visibility === "public" ? " · ouvert à tous" : ""}
            </p>
          </PracticeMediaCard>
        </li>
      ))}
    </ul>
  );
}

export function ResourceList({ resources, hideEmpty }: { resources: StorefrontEvent[]; hideEmpty?: boolean }) {
  if (resources.length === 0) {
    if (hideEmpty) return null;
    return (
      <p className="mt-3 text-sm text-slate-600">
        Aucun module ouvert pour l’instant. Les vidéos, podcasts et documents apparaissent ici à leur date de mise à
        disposition.
      </p>
    );
  }
  return (
    <ul className="mt-4 grid gap-4 sm:grid-cols-2">
      {resources.map((ev) => (
        <li key={ev.id}>
          <PracticeMediaCard
            coverUrl={coverOf(ev)}
            title={resourceDisplayName(ev)}
            footer={<ResourceActions ev={ev} />}
          >
            <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-violet-800">
              {RESOURCE_TYPE_LABELS[ev.resource_type || ""] || "Ressource"} · ouvert le {formatStorefrontDate(ev.starts_at)}
              {ev.visibility === "selected" ? " · pour vous" : ev.visibility === "public" ? " · ouvert à tous" : ""}
            </p>
          </PracticeMediaCard>
        </li>
      ))}
    </ul>
  );
}

export function UpcomingList({ upcoming }: { upcoming: StorefrontEvent[] }) {
  if (upcoming.length === 0) return null;
  return (
    <section className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-5">
      <h2 className="text-base font-bold text-slate-900">Bientôt disponibles</h2>
      <ul className="mt-4 grid gap-3 sm:grid-cols-3">
        {upcoming.map((ev) => (
          <li key={ev.id}>
            <PracticeMediaCard coverUrl={coverOf(ev)} title={ev.title} compact>
              <p className="mt-1 text-sm text-slate-600">{formatStorefrontDate(ev.starts_at)}</p>
            </PracticeMediaCard>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function subscriberCounts(data: StorefrontPublic) {
  return {
    sessions: (data.events || []).length,
    resources: (data.resources || []).length,
    upcoming: (data.resources_upcoming || []).length,
  };
}
