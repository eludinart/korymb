"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertBox, LoadingLine, PageHeader, PageShell, SectionCard } from "../../components/ui/PageChrome";
import { businessApi } from "../../lib/business";
import { GESTION_NAV_LINKS } from "../../lib/gestionNav";

export default function GestionHubPage() {
  const overview = useQuery({
    queryKey: ["business-overview"],
    queryFn: () => businessApi.overview(),
    staleTime: 60_000,
  });

  const stats = overview.data?.stats;
  const tiime = overview.data?.tiime;

  const statFor = (href: string): number | null => {
    if (!stats) return null;
    if (href.includes("contacts")) return stats.contacts_active;
    if (href.includes("projets")) return stats.projects_active;
    if (href.includes("devis")) return stats.quotes_pending;
    if (href.includes("planning")) return stats.events_this_week;
    return null;
  };

  return (
    <PageShell size="wide" className="space-y-6">
      <PageHeader
        accent="emerald"
        badge="Gestion entreprise"
        title="Cockpit métier"
        description="Contacts, projets, planning et devis. Les factures légales sont émises dans Tiime (facturation électronique)."
        actions={
          <>
            <Link href="/gestion/contacts/nouveau" className="btn-link-primary">
              Nouveau contact
            </Link>
            <Link href="/gestion/devis/nouveau" className="btn-link-secondary">
              Nouveau devis
            </Link>
          </>
        }
      />

      {overview.isLoading ? <LoadingLine label="Chargement du cockpit métier…" /> : null}
      {overview.isError ? (
        <AlertBox tone="error" title="Données indisponibles">
          Impossible de charger le module gestion. Vérifiez que le backend est démarré.
        </AlertBox>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {GESTION_NAV_LINKS.filter((l) => !l.exact).map((item) => {
          const n = statFor(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-2xl border-2 border-emerald-100 bg-white p-4 shadow-sm transition hover:border-emerald-300 hover:shadow-md"
            >
              <span className="text-2xl" aria-hidden>
                {item.icon}
              </span>
              <p className="mt-2 text-base font-bold text-slate-900">{item.label}</p>
              <p className="text-sm text-slate-600">{item.hint}</p>
              {n != null ? (
                <p className="mt-2 text-xs font-bold uppercase tracking-wide text-emerald-700">
                  {n} {item.href.includes("planning") ? "à venir (7 j)" : "en cours"}
                </p>
              ) : null}
            </Link>
          );
        })}
      </div>

      {stats ? (
        <SectionCard title="Synthèse">
          <p className="text-sm text-slate-600">
            <strong>{stats.invoices_unpaid}</strong> facture(s) Tiime non soldée(s) · utilisez le menu{" "}
            <strong>Devis</strong> pour le suivi commercial.
          </p>
        </SectionCard>
      ) : null}

      <SectionCard title="Tiime — facturation électronique">
        <p className="text-sm text-slate-600">
          Korymb gère les <strong>devis</strong>. Les <strong>factures conformes</strong> sont créées dans{" "}
          <a href={tiime?.app_url || "https://app.tiime.fr/"} target="_blank" rel="noreferrer" className="text-emerald-800 underline">
            Tiime
          </a>{" "}
          (plateforme agréée).
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Automatisation Make :{" "}
          {tiime?.automation_configured ? (
            <span className="font-semibold text-emerald-700">webhook configuré</span>
          ) : (
            <Link href="/administration/integrations" className="font-medium text-emerald-800 underline">
              Administration → Intégrations → Tiime
            </Link>
          )}
        </p>
      </SectionCard>
    </PageShell>
  );
}
