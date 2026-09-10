"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useSubscriberSpace } from "../../../lib/subscriberHome";
import {
  ResourceList,
  SessionList,
  SubscriberSpaceStatus,
  UpcomingList,
  subscriberCounts,
} from "../../../components/espace/SubscriberLists";
import { accountFirstName, type AuthMeResponse } from "../../../lib/authSession";
import { formatStorefrontDate, modalityLabel, type StorefrontEvent } from "../../../lib/storefront";

function byVisibility(items: StorefrontEvent[], vis: string) {
  return items.filter((ev) => (ev.visibility || "participants") === vis);
}

export default function SubscriberHomePage() {
  const { slug } = useParams<{ slug: string }>();
  const home = useSubscriberSpace(slug);
  const me = useQuery({
    queryKey: ["auth-me-espace"],
    queryFn: async () => {
      const r = await fetch("/api/auth/me", { cache: "no-store" });
      if (!r.ok) return null;
      return r.json() as Promise<AuthMeResponse>;
    },
    staleTime: 300_000,
  });

  if (home.isLoading) {
    return <SubscriberSpaceStatus loading slug={slug} error={null} />;
  }
  if (home.isError || !home.data) {
    return <SubscriberSpaceStatus loading={false} slug={slug} error={home.error} />;
  }

  const data = home.data;
  const counts = subscriberCounts(data);
  const events = data.events || [];
  const resources = data.resources || [];
  const hello = accountFirstName(me.data);
  const isOperator = me.data?.role === "admin" || me.data?.role === "member";

  return (
    <div className="space-y-8">
      <header>
        <p className="practice-kicker">Chez {data.name}</p>
        <h1 className="practice-heading mt-2 text-3xl font-extrabold">{hello ? `Bonjour ${hello}` : "Bienvenue"}</h1>
        <p className="mt-2 text-slate-600">Séances et ressources qui vous sont destinées.</p>
      </header>

      {isOperator ? (
        <div className="rounded-2xl border-2 border-violet-200 bg-violet-50 px-4 py-4">
          <p className="text-sm font-bold text-violet-950">Aperçu de l’espace participant</p>
          <p className="mt-1 text-sm text-violet-800">
            C’est ce que voient les inscrits. Pour piloter l’activité, ouvrez le cockpit dirigeant.
          </p>
          <Link href="/briefing" className="mt-3 inline-flex rounded-xl bg-violet-700 px-4 py-2 text-sm font-bold text-white hover:bg-violet-800">
            Ouvrir le cockpit dirigeant
          </Link>
        </div>
      ) : null}

      {!isOperator && data.membership_status === "pending" ? (
        <div className="rounded-2xl border-2 border-amber-200 bg-amber-50 px-4 py-4">
          <p className="text-sm font-bold text-amber-950">Inscription en attente de validation</p>
          <p className="mt-1 text-sm text-amber-900">
            Votre demande a bien été envoyée. Les séances et ressources réservées aux inscrits apparaîtront ici une fois l’accès validé. Les contenus publics restent visibles sur la vitrine, sans compte.
          </p>
        </div>
      ) : null}

      {events[0] ? (
        <section className="practice-card p-5">
          <p className="practice-kicker">Prochaine séance</p>
          <h2 className="practice-heading mt-2 text-xl font-bold">{events[0].title}</h2>
          <p className="mt-2 text-sm text-slate-600">{formatStorefrontDate(events[0].starts_at)}</p>
          <p className="mt-1 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--practice-ink)" }}>
            {modalityLabel(events[0].modality, events[0].event_type)}
            {events[0].location ? ` · ${events[0].location}` : ""}
          </p>
        </section>
      ) : (
        <p className="text-sm text-slate-600">Rien de prévu pour le moment dans Mes séances.</p>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Link href={`/a/${encodeURIComponent(data.slug)}/seances`} className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm">
          <p className="text-xs font-extrabold uppercase tracking-wide text-emerald-800">Mes séances</p>
          <p className="mt-2 text-2xl font-extrabold text-slate-900">{counts.sessions}</p>
        </Link>
        <Link href={`/a/${encodeURIComponent(data.slug)}/ressources`} className="rounded-2xl border border-violet-100 bg-white p-4 shadow-sm">
          <p className="text-xs font-extrabold uppercase tracking-wide text-violet-800">Mes ressources</p>
          <p className="mt-2 text-2xl font-extrabold text-slate-900">{counts.resources}</p>
        </Link>
        <Link href={`/a/${encodeURIComponent(data.slug)}/compte`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Mon compte</p>
          <p className="mt-2 truncate text-lg font-extrabold text-slate-900">{me.data?.user?.email || "Profil"}</p>
        </Link>
      </div>

      <section className="rounded-2xl border border-amber-100 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold text-slate-900">Pour vous</h2>
        <p className="mt-1 text-sm text-slate-600">Contenus attribués nommément.</p>
        <SessionList events={byVisibility(events, "selected")} hideEmpty />
        <ResourceList resources={byVisibility(resources, "selected")} hideEmpty />
        {byVisibility(events, "selected").length + byVisibility(resources, "selected").length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">Rien de nominatif pour le moment.</p>
        ) : null}
      </section>

      <section className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold text-slate-900">Pour les inscrits</h2>
        <p className="mt-1 text-sm text-slate-600">Catalogue commun à tous les comptes participants.</p>
        <SessionList events={byVisibility(events, "participants")} hideEmpty />
        <ResourceList resources={byVisibility(resources, "participants")} hideEmpty />
        {byVisibility(events, "participants").length + byVisibility(resources, "participants").length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">Pas encore de catalogue commun.</p>
        ) : null}
      </section>

      <section className="rounded-2xl border border-emerald-100 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold text-slate-900">Ouvert à tous</h2>
        <p className="mt-1 text-sm text-slate-600">Également visible sur la vitrine, sans compte.</p>
        <SessionList events={byVisibility(events, "public")} hideEmpty />
        <ResourceList resources={byVisibility(resources, "public")} hideEmpty />
        {byVisibility(events, "public").length + byVisibility(resources, "public").length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">Rien n’est ouvert au public pour l’instant.</p>
        ) : null}
      </section>

      <UpcomingList upcoming={data.resources_upcoming || []} />
    </div>
  );
}
