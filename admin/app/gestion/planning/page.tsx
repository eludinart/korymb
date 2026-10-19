"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertBox, LoadingLine, PageHeader, PageShell, SectionCard } from "../../../components/ui/PageChrome";
import ActivityCalendar, {
  rangeForZoom,
  type CalendarZoom,
  type NatureFilter,
} from "../../../components/gestion/ActivityCalendar";
import { businessApi, type BizEvent } from "../../../lib/business";
import { EVENT_MODALITY_LABELS, EVENT_NATURE_SHORT_LABELS, EVENT_TYPE_LABELS, EVENT_VISIBILITY_LABELS, contactLabel, formatDateTime, projectLabel, visibilityFromEvent } from "../_shared";

export default function GestionPlanningPage() {
  const qc = useQueryClient();
  const [zoom, setZoom] = useState<CalendarZoom>("month");
  const [nature, setNature] = useState<NatureFilter>("all");
  const [anchor, setAnchor] = useState(() => new Date());

  const range = useMemo(() => rangeForZoom(anchor, zoom), [anchor, zoom]);
  const fromIso = range.from.toISOString();
  const toIso = range.to.toISOString();

  const contacts = useQuery({ queryKey: ["business-contacts"], queryFn: () => businessApi.listContacts() });
  const projects = useQuery({ queryKey: ["business-projects"], queryFn: () => businessApi.listProjects() });
  const events = useQuery({
    queryKey: ["business-events", fromIso, toIso],
    queryFn: () => businessApi.listEvents(fromIso, toIso, 500),
  });

  const remove = useMutation({
    mutationFn: (id: string) => businessApi.deleteEvent(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["business-events"] });
      void qc.invalidateQueries({ queryKey: ["business-overview"] });
    },
  });

  const rows = events.data || [];

  return (
    <PageShell size="wide" className="space-y-6">
      <PageHeader
        accent="emerald"
        badge="Calendrier"
        title="Calendrier d’activité"
        description="Rendez-vous et contenus à ouvrir, sur le même calendrier. Chaque entrée a un accès : interne, nommé, inscrits, ou public."
        actions={
          <Link href="/gestion/planning/nouveau" className="btn-primary">
            + Planifier
          </Link>
        }
      />

      <SectionCard title="Vue calendrier">
        {events.isLoading ? <LoadingLine /> : null}
        {events.isError ? <AlertBox tone="error" title="Erreur">Chargement impossible.</AlertBox> : null}
        <ActivityCalendar
          events={rows}
          zoom={zoom}
          nature={nature}
          anchor={anchor}
          onZoom={setZoom}
          onNature={setNature}
          onAnchor={setAnchor}
        />
      </SectionCard>

      <SectionCard title={`Liste (${rows.length})`}>
        {rows.length === 0 && !events.isLoading ? (
          <p className="text-sm text-slate-500">
            Aucun créneau sur cette période.{" "}
            <Link href="/gestion/planning/nouveau" className="font-medium text-emerald-800 underline">
              Planifier
            </Link>
          </p>
        ) : null}
        <ul className="divide-y divide-slate-100">
          {rows.map((ev: BizEvent) => (
            <li key={ev.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
              <div>
                <Link href={`/gestion/planning/${ev.id}`} className="font-semibold text-slate-900 hover:text-emerald-900 hover:underline">
                  {ev.title}
                </Link>
                <p className="text-sm text-slate-600">{formatDateTime(ev.starts_at)}</p>
                <p className="text-xs text-slate-500">
                  {EVENT_NATURE_SHORT_LABELS[ev.nature === "matiere" ? "matiere" : "presence"]}
                  {" · "}
                  {EVENT_TYPE_LABELS[ev.event_type] || ev.event_type}
                  {ev.modality && EVENT_MODALITY_LABELS[ev.modality] ? ` · ${EVENT_MODALITY_LABELS[ev.modality]}` : ""}
                  {ev.location ? ` · ${ev.location}` : ""}
                  {` · ${EVENT_VISIBILITY_LABELS[visibilityFromEvent(ev)]}`}
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
