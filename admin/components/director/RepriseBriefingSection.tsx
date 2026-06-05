"use client";

import Link from "next/link";
import { AlertBox, PageLink, SectionCard } from "../ui/PageChrome";
import {
  formatCoveragePct,
  repriseDomainHref,
  STATUS_DOT,
  STATUS_LABELS,
  useRepriseCoverage,
  type RepriseDomain,
} from "../../lib/repriseCoverage";

function DomainRow({ domain }: { domain: RepriseDomain }) {
  const missing = domain.checklist_missing.length;
  return (
    <li>
      <Link
        href={repriseDomainHref(domain.id)}
        className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 shadow-sm transition hover:border-violet-300 hover:bg-violet-50"
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[domain.status]}`} aria-hidden />
        <span className="min-w-0 flex-1">{domain.label}</span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700">
          {STATUS_LABELS[domain.status]}
        </span>
        {missing > 0 ? (
          <span className="text-xs font-medium text-slate-500">
            {missing} point{missing > 1 ? "s" : ""} à traiter
          </span>
        ) : null}
      </Link>
    </li>
  );
}

export default function RepriseBriefingSection() {
  const coverage = useRepriseCoverage();
  const data = coverage.data;
  const gaps = data?.gaps ?? [];
  const attention = (data?.domains ?? []).filter((d) => d.status !== "covered");
  const tone = gaps.length > 0 || coverage.isError ? "alert" : undefined;

  return (
    <SectionCard
      title="Reprise d'entreprise"
      tone={tone}
      action={
        <PageLink href="/administration/reprise" variant="secondary">
          Audit complet
        </PageLink>
      }
    >
      {coverage.isLoading ? (
        <p className="text-sm font-medium text-slate-500">Scan reprise en cours…</p>
      ) : null}

      {coverage.isError ? (
        <AlertBox tone="warn" title="Scan reprise indisponible">
          Le briefing reste utilisable.{" "}
          <Link href="/administration/reprise" className="font-bold underline">
            Ouvrir l&apos;audit reprise
          </Link>{" "}
          pour relancer le scan.
        </AlertBox>
      ) : null}

      {data ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Couverture</p>
              <p className="text-2xl font-extrabold text-slate-900">{formatCoveragePct(data.coverage_score)}</p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
              <p className="text-xs font-bold uppercase text-emerald-700">Couvert</p>
              <p className="text-xl font-bold text-emerald-900">{data.summary.covered}</p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-xs font-bold uppercase text-amber-700">Partiel</p>
              <p className="text-xl font-bold text-amber-900">{data.summary.partial}</p>
            </div>
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2">
              <p className="text-xs font-bold uppercase text-red-700">Manquant</p>
              <p className="text-xl font-bold text-red-900">{data.summary.missing}</p>
            </div>
          </div>

          {!data.has_reprise_context ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              Peu de contexte reprise en mémoire —{" "}
              <Link href="/administration/memory" className="font-bold underline">
                enrichir la mémoire
              </Link>
              .
            </p>
          ) : null}

          {attention.length > 0 ? (
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                Domaines à suivre
              </p>
              <ul className="space-y-2">
                {attention.slice(0, 6).map((d) => (
                  <DomainRow key={d.id} domain={d} />
                ))}
              </ul>
              {attention.length > 6 ? (
                <p className="mt-2 text-xs text-slate-500">
                  + {attention.length - 6} autre(s) —{" "}
                  <Link href="/administration/reprise" className="font-semibold text-violet-800 underline">
                    voir tout
                  </Link>
                </p>
              ) : null}
            </div>
          ) : (
            <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900">
              Tous les domaines reprise semblent couverts dans votre contexte actuel.
            </p>
          )}

          {gaps.length > 0 ? (
            <p className="text-sm text-slate-600">
              <Link href="/administration/reprise" className="font-bold text-violet-800 underline">
                Générer des missions
              </Link>{" "}
              pour les {gaps.length} lacune{gaps.length > 1 ? "s" : ""} identifiée{gaps.length > 1 ? "s" : ""}.
            </p>
          ) : null}
        </div>
      ) : null}
    </SectionCard>
  );
}
