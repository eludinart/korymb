"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertBox, LoadingLine, PageHeader, PageShell, SectionCard } from "../../components/ui/PageChrome";
import { businessApi } from "../../lib/business";
import { groupedGestionNavLinks, gestionNavGroupCardBorderClass, gestionNavGroupHeadingClass } from "../../lib/gestionNav";

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
    if (href.includes("courrier")) return stats.email_needs_reply ?? null;
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
        title="Vue d'ensemble"
        description="Création de contenus, contextes d’équipes projet, et activité commerciale (contacts, courrier, planning, devis). Les factures légales passent par Tiime."
        actions={
          <>
            <Link href="/gestion/studio" className="btn-link-primary">
              Ouvrir le studio
            </Link>
            <Link href="/gestion/contacts/nouveau" className="btn-link-secondary">
              Nouveau contact
            </Link>
          </>
        }
      />

      {overview.isLoading ? <LoadingLine label="Chargement de la gestion…" /> : null}
      {overview.isError ? (
        <AlertBox tone="error" title="Données indisponibles">
          Impossible de charger le module gestion. Vérifiez que le backend est démarré.
        </AlertBox>
      ) : null}

      {groupedGestionNavLinks().map((group) => (
        <section key={group.id} className="space-y-3">
          <h2 className={`text-xs font-extrabold uppercase tracking-wider ${gestionNavGroupHeadingClass(group.id)}`}>
            {group.label}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {group.links.map((item) => {
              const n = statFor(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-2xl border-2 bg-white p-4 shadow-sm transition hover:shadow-md ${gestionNavGroupCardBorderClass(group.id)}`}
                >
                  <span className="text-2xl" aria-hidden>
                    {item.icon}
                  </span>
                  <p className="mt-2 text-base font-bold text-slate-900">{item.label}</p>
                  <p className="text-sm text-slate-600">{item.hint}</p>
                  {n != null ? (
                    <p className="mt-2 text-xs font-bold uppercase tracking-wide text-emerald-700">
                      {n}{" "}
                      {item.href.includes("planning")
                        ? "à venir (7 j)"
                        : item.href.includes("courrier")
                          ? "à traiter"
                          : "en cours"}
                    </p>
                  ) : null}
                </Link>
              );
            })}
          </div>
        </section>
      ))}

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
