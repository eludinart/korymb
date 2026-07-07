"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { GESTION_NAV_LINKS } from "../../lib/gestionNav";
import { businessApi } from "../../lib/business";

/** Raccourcis gestion pour le briefing — accès en 1 clic aux modules métier. */
export default function GestionShortcuts() {
  const overview = useQuery({
    queryKey: ["business-overview"],
    queryFn: () => businessApi.overview(),
    staleTime: 120_000,
  });

  const stats = overview.data?.stats;

  return (
    <section
      className="rounded-2xl border-2 border-emerald-200 bg-gradient-to-br from-emerald-50/90 via-white to-white p-4 shadow-sm sm:p-5"
      aria-labelledby="gestion-shortcuts-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="gestion-shortcuts-heading" className="text-base font-bold text-emerald-950">
            Gestion entreprise
          </h2>
          <p className="mt-0.5 text-sm text-emerald-900/80">
            Contacts, projets, planning et devis — votre activité hors missions IA.
          </p>
        </div>
        <Link href="/gestion" className="btn-success text-xs sm:text-sm">
          Ouvrir le cockpit →
        </Link>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {GESTION_NAV_LINKS.map((item) => {
          const statKey =
            item.href === "/gestion/contacts"
              ? stats?.contacts_active
              : item.href === "/gestion/projets"
                ? stats?.projects_active
                : item.href === "/gestion/devis"
                  ? stats?.quotes_pending
                  : item.href === "/gestion/planning"
                    ? stats?.events_this_week
                    : null;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="group flex min-h-[4.5rem] flex-col justify-between rounded-xl border border-emerald-100 bg-white/90 px-3 py-3 shadow-sm transition hover:border-emerald-300 hover:shadow-md"
            >
              <span className="text-lg" aria-hidden>
                {item.icon}
              </span>
              <div>
                <p className="text-sm font-bold text-slate-900 group-hover:text-emerald-900">{item.label}</p>
                <p className="text-[11px] leading-snug text-slate-500">{item.hint}</p>
                {statKey != null && overview.isSuccess ? (
                  <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                    {statKey} {item.href.includes("planning") ? "à venir" : "actif(s)"}
                  </p>
                ) : null}
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
