"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertBox, LoadingLine, PageHeader, PageShell, SectionCard } from "../../../components/ui/PageChrome";
import { businessApi, type BizProject } from "../../../lib/business";
import { PROJECT_STATUS_LABELS, PROJECT_TYPE_LABELS, contactLabel } from "../_shared";

export default function GestionProjetsPage() {
  const qc = useQueryClient();

  const contacts = useQuery({ queryKey: ["business-contacts"], queryFn: () => businessApi.listContacts() });
  const projects = useQuery({ queryKey: ["business-projects"], queryFn: () => businessApi.listProjects() });

  const setProjectStatus = useMutation({
    mutationFn: ({ id, st }: { id: string; st: string }) => businessApi.updateProject(id, { status: st }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["business-projects"] }),
  });

  return (
    <PageShell size="wide" className="space-y-6">
      <PageHeader
        accent="emerald"
        badge="Projets"
        title="Suivi de projets"
        description="Séances, stages SÏvåñà, modules pro — liés à vos contacts."
        actions={
          <Link href="/gestion/projets/nouveau" className="btn-primary">
            + Nouveau projet
          </Link>
        }
      />

      <SectionCard title={`Projets (${projects.data?.length ?? 0})`}>
        {projects.isLoading ? <LoadingLine /> : null}
        {projects.isError ? <AlertBox tone="error" title="Erreur">Chargement impossible.</AlertBox> : null}
        {!projects.isLoading && (projects.data || []).length === 0 ? (
          <p className="text-sm text-slate-500">
            Aucun projet.{" "}
            <Link href="/gestion/projets/nouveau" className="font-medium text-emerald-800 underline">
              Créer un projet
            </Link>
          </p>
        ) : null}
        <ul className="divide-y divide-slate-100">
          {(projects.data || []).map((p: BizProject) => (
            <li key={p.id} className="py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <Link href={`/gestion/projets/${p.id}`} className="font-semibold text-slate-900 hover:text-emerald-900 hover:underline">
                    {p.title}
                  </Link>
                  <p className="text-xs text-slate-500">
                    {PROJECT_TYPE_LABELS[p.project_type] || p.project_type} ·{" "}
                    {PROJECT_STATUS_LABELS[p.status] || p.status}
                    {p.location ? ` · ${p.location}` : ""}
                  </p>
                  <p className="text-xs text-slate-500">
                    Contact : {contactLabel(undefined, p.contact_id, contacts.data || [])}
                  </p>
                  {p.description ? (
                    <p className="mt-1 line-clamp-2 text-sm text-slate-600">{p.description}</p>
                  ) : null}
                </div>
                <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                  <select
                    className="input-field min-w-[8rem] flex-1 text-sm sm:flex-none"
                    value={p.status}
                    onChange={(e) => setProjectStatus.mutate({ id: p.id, st: e.target.value })}
                  >
                    {Object.entries(PROJECT_STATUS_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                  <Link
                    href={`/gestion/projets/${p.id}`}
                    className="touch-target inline-flex items-center rounded-lg border border-violet-200 bg-violet-50 px-3 text-xs font-semibold text-violet-900"
                  >
                    Ouvrir
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </SectionCard>
    </PageShell>
  );
}
