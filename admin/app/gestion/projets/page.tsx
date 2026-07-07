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
                  {p.description ? <p className="mt-1 text-sm text-slate-600">{p.description}</p> : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    className="input-field text-xs"
                    value={p.status}
                    onChange={(e) => setProjectStatus.mutate({ id: p.id, st: e.target.value })}
                  >
                    {Object.entries(PROJECT_STATUS_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                  <Link href={`/gestion/projets/${p.id}`} className="text-xs font-medium text-violet-800 hover:underline">
                    Modifier
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
