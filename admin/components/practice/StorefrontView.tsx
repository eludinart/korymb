"use client";

import Link from "next/link";
import { useState } from "react";
import { publicStorefrontEventCoverUrl, publicStorefrontResourceFileUrl } from "../../lib/business";
import { OFFER_KIND_LABELS } from "../../lib/practiceTheme";
import {
  formatStorefrontDate,
  modalityLabel,
  RESOURCE_TYPE_LABELS,
  type StorefrontEvent,
  type StorefrontPublic,
} from "../../lib/storefront";
import { ResourcePreviewModal } from "../espace/ResourcePreview";
import { PracticeMediaCard } from "./PracticeMediaCard";

function eventCover(slug: string, ev: StorefrontEvent) {
  return ev.has_cover ? publicStorefrontEventCoverUrl(slug, ev.id) : null;
}

export function StorefrontView({
  data,
  compact = false,
}: {
  data: StorefrontPublic;
  compact?: boolean;
}) {
  const events = data.events || [];
  const featured = events[0];
  const moreDates = events.slice(1);
  const offers = data.offers || [];
  const openResources = data.resources || [];
  const teasers = (data.resources_upcoming || []).slice(0, 3);
  const joinHref = `/p/${encodeURIComponent(data.slug)}/inscription`;
  const loginHref = `/p/${encodeURIComponent(data.slug)}/connexion`;

  return (
    <div className={compact ? "space-y-6 p-4 text-left" : "mx-auto max-w-4xl space-y-12 px-4 py-10 sm:px-6 sm:py-14"}>
      {data.cover_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={data.cover_url}
          alt=""
          className={compact ? "h-28 w-full rounded-xl object-cover" : "h-56 w-full rounded-3xl object-cover sm:h-72"}
        />
      ) : null}

      <header className="max-w-2xl">
        <p className="practice-kicker">{data.location || "Espace participant"}</p>
        <h1 className={`practice-heading mt-3 font-extrabold tracking-tight ${compact ? "text-2xl" : "text-4xl sm:text-5xl"}`}>
          {data.name}
        </h1>
        {data.tagline ? <p className={`mt-3 text-slate-700 ${compact ? "text-sm" : "text-lg"}`}>{data.tagline}</p> : null}
        {data.intro && !compact ? <p className="mt-5 text-base leading-relaxed text-slate-700">{data.intro}</p> : null}
      </header>

      {featured ? (
        <section>
          <p className="practice-kicker mb-3">Prochaine date</p>
          <PracticeMediaCard
            coverUrl={eventCover(data.slug, featured)}
            title={featured.title}
            featured
            compact={compact}
          >
            <p className="mt-2 text-sm text-slate-600">{formatStorefrontDate(featured.starts_at)}</p>
            <p className="mt-1 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--practice-ink)" }}>
              {modalityLabel(featured.modality, featured.event_type)}
              {featured.location ? ` · ${featured.location}` : ""}
              {featured.reserved ? " · inscrits" : " · ouvert à tous"}
            </p>
          </PracticeMediaCard>
        </section>
      ) : (
        <p className="text-sm text-slate-600">Aucune date ouverte pour le moment. Inscrivez-vous pour être prévenu.</p>
      )}

      {!compact ? (
        <div className="flex flex-wrap gap-3">
          <Link href={joinHref} className="btn-practice">
            Rejoindre l’espace
          </Link>
          <Link href={loginHref} className="btn-practice-secondary">
            J’ai déjà un compte
          </Link>
        </div>
      ) : (
        <p className="text-xs font-bold" style={{ color: "var(--practice-ink)" }}>
          Rejoindre l’espace
        </p>
      )}

      {offers.length ? (
        <section>
          <h2 className={`practice-heading font-extrabold ${compact ? "text-base" : "text-xl"}`}>Offres</h2>
          <ul className={`mt-4 grid gap-4 ${compact ? "grid-cols-1" : "sm:grid-cols-3"}`}>
            {offers.map((o) => (
              <li key={o.title} className="practice-card p-4">
                {o.kind && OFFER_KIND_LABELS[o.kind] ? (
                  <p className="practice-kicker">{OFFER_KIND_LABELS[o.kind]}</p>
                ) : null}
                <h3 className="mt-1 font-bold text-slate-900">{o.title}</h3>
                {o.summary ? <p className="mt-2 text-sm leading-relaxed text-slate-600">{o.summary}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {moreDates.length ? (
        <section>
          <h2 className={`practice-heading font-extrabold ${compact ? "text-base" : "text-xl"}`}>Autres dates</h2>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2">
            {moreDates.map((ev) => (
              <li key={ev.id}>
                <PracticeMediaCard coverUrl={eventCover(data.slug, ev)} title={ev.title} compact={compact}>
                  <p className="mt-1 text-sm text-slate-600">{formatStorefrontDate(ev.starts_at)}</p>
                  <p className="mt-1 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--practice-ink)" }}>
                    {modalityLabel(ev.modality, ev.event_type)}
                    {ev.location ? ` · ${ev.location}` : ""}
                    {ev.reserved ? " · inscrits" : " · ouvert à tous"}
                  </p>
                </PracticeMediaCard>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {openResources.length > 0 ? (
        <section>
          <h2 className={`practice-heading font-extrabold ${compact ? "text-base" : "text-xl"}`}>Ouvert à tous</h2>
          <p className="mt-2 text-sm text-slate-600">Documents et médias accessibles sans compte.</p>
          <ul className={`mt-4 grid gap-4 ${compact ? "grid-cols-1" : "sm:grid-cols-2"}`}>
            {openResources.map((ev) => (
              <PublicResourceRow key={ev.id} ev={ev} slug={data.slug} compact={compact} />
            ))}
          </ul>
        </section>
      ) : null}

      {teasers.length > 0 ? (
        <section>
          <h2 className={`practice-heading font-extrabold ${compact ? "text-base" : "text-xl"}`}>Dans l’espace inscrit</h2>
          <p className="mt-2 text-sm text-slate-600">Quelques ouvertures à venir — le reste s’affiche une fois connecté.</p>
          <ul className="mt-4 grid gap-4 sm:grid-cols-3">
            {teasers.map((ev) => (
              <li key={ev.id}>
                <PracticeMediaCard coverUrl={eventCover(data.slug, ev)} title={ev.title} compact>
                  <p className="mt-1 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--practice-ink)" }}>
                    {RESOURCE_TYPE_LABELS[ev.resource_type || ""] || "ressource"}
                    {compact ? null : ` · ${formatStorefrontDate(ev.starts_at)}`}
                  </p>
                </PracticeMediaCard>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {(data.contact_email || data.contact_url) && !compact ? (
        <section className="text-sm text-slate-600">
          {data.contact_email ? (
            <p>
              Écrire :{" "}
              <a className="font-semibold underline" href={`mailto:${data.contact_email}`}>
                {data.contact_email}
              </a>
            </p>
          ) : null}
          {data.contact_url ? (
            <p className="mt-1">
              <a className="font-semibold underline" href={data.contact_url} target="_blank" rel="noreferrer">
                Site ou réseau
              </a>
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function PublicResourceRow({ ev, slug, compact }: { ev: StorefrontEvent; slug: string; compact: boolean }) {
  const [open, setOpen] = useState(false);
  const download = ev.has_file ? publicStorefrontResourceFileUrl(slug, ev.id) : "";
  const inlineUrl = ev.has_file ? publicStorefrontResourceFileUrl(slug, ev.id, true) : "";
  const coverUrl = eventCover(slug, ev);
  return (
    <li>
      <PracticeMediaCard
        coverUrl={coverUrl}
        title={ev.title}
        compact={compact}
        footer={
          compact ? null : (
            <p>
              {ev.has_file ? (
                <>
                  <button
                    type="button"
                    className="mr-3 text-sm font-bold underline"
                    style={{ color: "var(--practice-ink)" }}
                    onClick={() => setOpen(true)}
                  >
                    Consulter
                  </button>
                  <a href={download} className="text-sm font-bold underline" style={{ color: "var(--practice-ink)" }}>
                    Télécharger
                  </a>
                </>
              ) : ev.resource_url ? (
                <a
                  href={ev.resource_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-bold underline"
                  style={{ color: "var(--practice-ink)" }}
                >
                  Ouvrir
                </a>
              ) : (
                <span className="text-sm text-slate-500">Lien à venir.</span>
              )}
            </p>
          )
        }
      >
        <p className="mt-1 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--practice-ink)" }}>
          {RESOURCE_TYPE_LABELS[ev.resource_type || ""] || "Ressource"}
        </p>
      </PracticeMediaCard>
      {open && inlineUrl ? (
        <ResourcePreviewModal
          title={ev.title}
          mime={ev.resource_file_mime}
          filename={ev.resource_filename}
          inlineUrl={inlineUrl}
          downloadUrl={download}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </li>
  );
}
