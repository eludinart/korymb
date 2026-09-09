"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertBox, LoadingLine, PageHeader, PageShell, SectionCard } from "../../../components/ui/PageChrome";
import { businessApi, type BizQuote } from "../../../lib/business";
import { QUOTE_STATUS_LABELS, contactLabel, formatEuroCents, projectLabel } from "../_shared";

export default function GestionDevisPage() {
  const qc = useQueryClient();
  const [tiimeMsg, setTiimeMsg] = useState("");

  const contacts = useQuery({ queryKey: ["business-contacts"], queryFn: () => businessApi.listContacts() });
  const projects = useQuery({ queryKey: ["business-projects"], queryFn: () => businessApi.listProjects() });
  const quotes = useQuery({ queryKey: ["business-quotes"], queryFn: () => businessApi.listQuotes() });
  const overview = useQuery({ queryKey: ["business-overview"], queryFn: () => businessApi.overview() });

  const tiimeRequest = useMutation({
    mutationFn: (quoteId: string) => businessApi.requestTiimeInvoice(quoteId),
    onSuccess: (data) => {
      setTiimeMsg(data.message);
      if (data.tiime_app_url) window.open(data.tiime_app_url, "_blank", "noopener,noreferrer");
      void qc.invalidateQueries({ queryKey: ["business-quotes"] });
    },
    onError: (e: Error) => setTiimeMsg(e.message),
  });

  return (
    <PageShell size="wide" className="space-y-6">
      <PageHeader
        accent="emerald"
        badge="Devis"
        title="Devis commerciaux"
        description="Créés dans Korymb. Facturation légale et e-facture via Tiime."
        actions={
          <Link href="/gestion/devis/nouveau" className="btn-primary">
            + Nouveau devis
          </Link>
        }
      />

      {tiimeMsg ? (
        <AlertBox tone="info" title="Tiime">
          {tiimeMsg}
        </AlertBox>
      ) : null}

      <SectionCard title={`Devis (${quotes.data?.length ?? 0})`}>
        {quotes.isLoading ? <LoadingLine /> : null}
        {!quotes.isLoading && (quotes.data || []).length === 0 ? (
          <p className="text-sm text-slate-500">
            Aucun devis.{" "}
            <Link href="/gestion/devis/nouveau" className="font-medium text-emerald-800 underline">
              Créer un devis
            </Link>
          </p>
        ) : null}
        <ul className="divide-y divide-slate-100">
          {(quotes.data || []).map((q: BizQuote) => (
            <li key={q.id} className="py-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <Link href={`/gestion/devis/${q.id}`} className="font-semibold text-slate-900 hover:text-emerald-900 hover:underline">
                    {q.quote_number} — {q.title}
                  </Link>
                  <p className="text-sm font-medium text-emerald-800">{formatEuroCents(q.total_cents)} TTC</p>
                  <p className="text-xs text-slate-500">
                    {QUOTE_STATUS_LABELS[q.status] || q.status} ·{" "}
                    {contactLabel(undefined, q.contact_id, contacts.data || [])} ·{" "}
                    {projectLabel(undefined, q.project_id, projects.data || [])}
                    {(q.external_invoices?.length ?? 0) > 0
                      ? ` · ${q.external_invoices!.length} facture(s) Tiime`
                      : ""}
                  </p>
                </div>
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
                  <Link href={`/gestion/devis/${q.id}`} className="btn-secondary w-full justify-center text-sm sm:w-auto">
                    Modifier
                  </Link>
                  <button
                    type="button"
                    className="btn-primary w-full justify-center text-sm sm:w-auto"
                    disabled={tiimeRequest.isPending}
                    onClick={() => tiimeRequest.mutate(q.id)}
                  >
                    Facture Tiime
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-slate-500">
          Webhook Make : {overview.data?.tiime.automation_configured ? "actif" : "non configuré"} —{" "}
          <a href="https://app.tiime.fr/" target="_blank" rel="noreferrer" className="underline">
            Ouvrir Tiime
          </a>
        </p>
      </SectionCard>
    </PageShell>
  );
}
