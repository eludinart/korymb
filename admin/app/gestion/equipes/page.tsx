"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  AlertBox,
  EmptyState,
  LoadingLine,
  PageHeader,
  PageShell,
} from "../../../components/ui/PageChrome";
import { agentHeaders, requestJson } from "../../../lib/api";
import { IDENTITY_CARD, jobAgentGroupId, ENTERPRISE_ROLE_LABEL } from "../../../lib/agentGroupUi";
import { QK } from "../../../lib/queryClient";
import type { Job } from "../../../lib/types";

type MemberRow = {
  key: string;
  label: string;
  role?: string;
};

type GroupRow = {
  id: string;
  label: string;
  description?: string;
  status: string;
  lead_agent_key: string;
  lead_label?: string;
  member_keys: string[];
  members?: MemberRow[];
  is_system?: boolean;
};

type GroupMemory = {
  notes?: string;
  inherit_shared?: boolean;
};

function previewText(raw: string | undefined, max = 220): string {
  const t = (raw || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function memberLabels(group: GroupRow): string {
  const fromMembers = (group.members || []).map((m) => m.label).filter(Boolean);
  if (fromMembers.length) return fromMembers.join(", ");
  return (group.member_keys || []).join(", ") || "—";
}

export default function GestionEquipesPage() {
  const groupsQuery = useQuery({
    queryKey: ["agent-groups"],
    queryFn: async () => {
      const { data, res } = await requestJson("/agent-groups", { retries: 1, expectOk: false });
      if (!res.ok) throw new Error(String(data?.detail || `HTTP ${res.status}`));
      const list = (data as { groups?: unknown })?.groups;
      return Array.isArray(list) ? (list as GroupRow[]) : [];
    },
    staleTime: 30_000,
  });

  const jobsQuery = useQuery({
    queryKey: QK.jobsCards,
    queryFn: async () => {
      const { data } = await requestJson("/jobs/cards", { headers: agentHeaders(), retries: 0, timeoutMs: 15_000 });
      const list = (data as { jobs?: unknown })?.jobs;
      return Array.isArray(list) ? (list as Job[]) : [];
    },
    staleTime: 20_000,
  });

  const groups = groupsQuery.data || [];
  const enterprise = groups.find((g) => g.id === "entreprise") || null;
  const projectGroups = useMemo(
    () => groups.filter((g) => g.id !== "entreprise" && g.status !== "archived"),
    [groups],
  );

  const memories = useQueries({
    queries: projectGroups.map((g) => ({
      queryKey: ["agent-group-memory", g.id],
      queryFn: async () => {
        const { data, res } = await requestJson(`/agent-groups/${encodeURIComponent(g.id)}/memory`, {
          retries: 0,
          expectOk: false,
        });
        if (!res.ok) return { notes: "" } as GroupMemory;
        return ((data as { memory?: GroupMemory })?.memory || {}) as GroupMemory;
      },
      staleTime: 30_000,
      enabled: Boolean(g.id),
    })),
  });

  const missionCountByGroup = useMemo(() => {
    const map = new Map<string, number>();
    for (const job of jobsQuery.data || []) {
      if (String(job.source || "mission") === "chat") continue;
      const gid = jobAgentGroupId(job);
      map.set(gid, (map.get(gid) || 0) + 1);
    }
    return map;
  }, [jobsQuery.data]);

  return (
    <PageShell size="wide" className="space-y-6">
      <PageHeader
        accent="sky"
        badge="Équipes projet"
        title="Contextes de travail"
        description="Ouvrez un contexte avec une équipe dédiée (édition, terrain, R&D…). La flotte Entreprise reste le tronc commercial du module Activité. La composition se règle dans Administration."
        actions={
          <>
            <Link href="/chat" className="btn-link-primary">
              Proposer une équipe
            </Link>
            <Link href="/administration/equipes" className="btn-link-secondary">
              Composer les équipes
            </Link>
          </>
        }
      />

      {groupsQuery.isLoading ? <LoadingLine label="Chargement des équipes…" /> : null}
      {groupsQuery.isError ? (
        <AlertBox tone="error" title="Équipes indisponibles">
          Impossible de charger les groupes d’agents.{" "}
          {groupsQuery.error instanceof Error ? groupsQuery.error.message : ""}
        </AlertBox>
      ) : null}

      {enterprise ? (
        <article className={`rounded-2xl border-2 p-4 shadow-sm ${IDENTITY_CARD.orchestra}`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-base font-bold text-amber-950">Flotte Entreprise — tronc métier</p>
              <p className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-amber-800">
                Lead · {enterprise.lead_label || "CIO"}
              </p>
            </div>
            <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-bold tracking-wide text-amber-950">
              {ENTERPRISE_ROLE_LABEL}
            </span>
          </div>
          <p className="mt-2 text-sm text-slate-600">
            {enterprise.description?.trim() ||
              "Commercial, community, développement et comptable — c’est déjà le périmètre Contacts, Courrier, Planning et Devis."}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            {enterprise.members?.length ? memberLabels(enterprise) : null}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/chat?group=entreprise" className="btn-link-secondary text-xs">
              Parler au CIO
            </Link>
            <Link href="/missions?team=entreprise" className="btn-link-secondary text-xs">
              Missions Entreprise
            </Link>
            <Link href="/gestion/contacts" className="btn-link-secondary text-xs">
              Ouvrir l’activité
            </Link>
          </div>
        </article>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-xs font-extrabold uppercase tracking-wider text-sky-800">Autres groupes</h2>
        {groupsQuery.isSuccess && projectGroups.length === 0 ? (
          <EmptyState title="Aucune équipe projet pour l’instant">
            <p>
              Créez une équipe dédiée (édition, terrain, R&D…) pour isoler un brief, une mémoire et des missions hors de la
              flotte Entreprise.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href="/chat" className="btn-link-primary text-xs">
                Demander à l’Assistant
              </Link>
              <Link href="/administration/equipes" className="btn-link-secondary text-xs">
                Créer depuis un modèle
              </Link>
            </div>
          </EmptyState>
        ) : null}

        <div className="grid gap-3 lg:grid-cols-2">
          {projectGroups.map((group, index) => {
            const notes = previewText(memories[index]?.data?.notes);
            const missionCount = missionCountByGroup.get(group.id) || 0;
            return (
              <article
                key={group.id}
                className={`flex flex-col rounded-2xl border-2 p-4 shadow-sm ${IDENTITY_CARD.project}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-base font-bold text-slate-900">{group.label}</p>
                    <p className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-sky-800">
                      Lead · {group.lead_label || group.lead_agent_key}
                    </p>
                  </div>
                  <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-800">
                    Équipe projet
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-600">
                  {group.description?.trim() || "Équipe dédiée — délégation limitée à ses membres."}
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  <span className="font-semibold text-slate-700">Membres : </span>
                  {memberLabels(group)}
                </p>
                <p className="mt-2 text-xs leading-snug text-slate-500">
                  <span className="font-semibold text-slate-700">Brief d’équipe : </span>
                  {memories[index]?.isLoading ? "Chargement…" : notes || "Aucun brief enregistré pour l’instant."}
                </p>
                {jobsQuery.isSuccess ? (
                  <p className="mt-2 text-[11px] font-bold uppercase tracking-wide text-sky-800">
                    {missionCount === 1 ? "1 mission" : `${missionCount} missions`}
                  </p>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link href={`/chat?group=${encodeURIComponent(group.id)}`} className="btn-link-primary text-xs">
                    Ouvrir le contexte
                  </Link>
                  <Link
                    href={`/missions?create=1&team=${encodeURIComponent(group.id)}`}
                    className="btn-link-secondary text-xs"
                  >
                    Lancer une mission
                  </Link>
                  <Link href={`/missions?team=${encodeURIComponent(group.id)}`} className="btn-link-secondary text-xs">
                    Voir les missions
                  </Link>
                  <Link
                    href={`/administration/equipes?g=${encodeURIComponent(group.id)}`}
                    className="btn-link-secondary text-xs"
                  >
                    Composer l’équipe
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </PageShell>
  );
}
