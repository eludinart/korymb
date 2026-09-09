"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertBox, LoadingLine, PageHeader, PageShell, SectionCard } from "../../../components/ui/PageChrome";
import { businessApi, type BizEvent } from "../../../lib/business";
import { EVENT_TYPE_LABELS, contactLabel, formatDateTime, projectLabel } from "../_shared";

export default function GestionPlanningPage() {
  const qc = useQueryClient();

  const weekStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }, []);
  const weekEnd = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString();
  }, []);

  const contacts = useQuery({ queryKey: ["business-contacts"], queryFn: () => businessApi.listContacts() });
  const projects = useQuery({ queryKey: ["business-projects"], queryFn: () => businessApi.listProjects() });
  const events = useQuery({
    queryKey: ["business-events", weekStart],
    queryFn: () => businessApi.listEvents(weekStart, weekEnd),
  });

  const remove = useMutation({
    mutationFn: (id: string) => businessApi.deleteEvent(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["business-events"] });
      void qc.invalidateQueries({ queryKey: ["business-overview"] });
    },
  });

  return (
    <PageShell size="wide" className="space-y-6">
      <PageHeader
        accent="emerald"
        badge="Planning"
        title="Séances & stages"
        description="Calendrier métier des 30 prochains jours — séances, ateliers, stages SÏvåñà."
        actions={
          <Link href="/gestion/planning/nouveau" className="btn-primary">
            + Planifier un créneau
          </Link>
        }
      />

      <SectionCard title={`Agenda (${events.data?.length ?? 0} événements)`}>
        {events.isLoading ? <LoadingLine /> : null}
        {events.isError ? <AlertBox tone="error" title="Erreur">Chargement impossible.</AlertBox> : null}
        {!events.isLoading && (events.data || []).length === 0 ? (
          <p className="text-sm text-slate-500">
            Aucun créneau planifié.{" "}
            <Link href="/gestion/planning/nouveau" className="font-medium text-emerald-800 underline">
              Planifier un créneau
            </Link>
          </p>
        ) : null}
        <ul className="divide-y divide-slate-100">
          {(events.data || []).map((ev: BizEvent) => (
            <li key={ev.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
              <div>
                <Link href={`/gestion/planning/${ev.id}`} className="font-semibold text-slate-900 hover:text-emerald-900 hover:underline">
                  {ev.title}
                </Link>
                <p className="text-sm text-slate-600">{formatDateTime(ev.starts_at)}</p>
                <p className="text-xs text-slate-500">
                  {EVENT_TYPE_LABELS[ev.event_type] || ev.event_type}
                  {ev.location ? ` · ${ev.location}` : ""}
                </p>
                <p className="text-xs text-slate-500">
                  {contactLabel(undefined, ev.contact_id, contacts.data || [])} ·{" "}
                  {projectLabel(undefined, ev.project_id, projects.data || [])}
                </p>
              </div>
              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                <Link href={`/gestion/planning/${ev.id}`} className="touch-target inline-flex items-center rounded-lg border border-violet-200 bg-violet-50 px-3 text-xs font-semibold text-violet-900">
                  Modifier
                </Link>
                <button
                  type="button"
                  className="touch-target inline-flex items-center rounded-lg border border-red-200 bg-red-50 px-3 text-xs font-semibold text-red-800"
                  onClick={() => {
                    if (window.confirm("Supprimer ce créneau ?")) remove.mutate(ev.id);
                  }}
                >
                  Supprimer
                </button>
              </div>
            </li>
          ))}
        </ul>
      </SectionCard>
    </PageShell>
  );
}
