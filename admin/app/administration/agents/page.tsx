"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import HealthDot from "../../../components/HealthDot";
import { requestJson } from "../../../lib/api";
import { QK } from "../../../lib/queryClient";

const visibleInterval = (ms: number) =>
  typeof document !== "undefined" && document.visibilityState === "visible" ? ms : false;

export default function AdministrationAgentsPage() {
  const agents = useQuery({
    queryKey: QK.agents,
    queryFn: async () => (await requestJson("/agents", { retries: 1 })).data.agents || [],
    refetchInterval: () => visibleInterval(30000),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Agents métiers</h1>
          <p className="mt-1 text-sm text-slate-500">
            Rôles Korymb : ouvrez la fiche pour les outils, la mémoire entreprise et — pour les agents personnalisés —
            la définition complète (prompt, outils). Le CIO peut déléguer à tout rôle listé ici (hors orchestrateur).
          </p>
        </div>
        <Link
          href="/administration/agents/nouveau"
          className="shrink-0 rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-violet-800"
        >
          + Nouvel agent
        </Link>
      </div>
      {agents.isLoading ? <p className="text-sm text-slate-400">Chargement…</p> : null}
      {agents.isError ? <p className="text-sm text-red-700">Impossible de charger les agents.</p> : null}
      {agents.isSuccess ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {(agents.data || []).map(
            (a: {
              key: string;
              label: string;
              role?: string;
              tools?: string[];
              is_manager?: boolean;
              builtin?: boolean;
            }) => (
            <li key={a.key}>
              <Link
                href={`/administration/agents/${encodeURIComponent(a.key)}`}
                className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:border-violet-200 hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">{a.label}</p>
                    <p className="mt-0.5 font-mono text-xs text-slate-500">{a.key}</p>
                  </div>
                  <HealthDot tone="ok" label="Définition chargée" size="md" />
                </div>
                <p className="mt-2 text-sm text-slate-600">{a.role || "—"}</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {a.is_manager ? (
                    <p className="text-[11px] font-medium uppercase tracking-wide text-violet-700">Orchestrateur</p>
                  ) : null}
                  {a.builtin === false ? (
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-900">
                      Personnalisé
                    </span>
                  ) : null}
                </div>
                <div className="mt-3 flex flex-wrap gap-1">
                  {(a.tools || []).length ? (
                    (a.tools || []).map((t: string) => (
                      <span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700">
                        {t}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-slate-400">Aucun outil déclaré</span>
                  )}
                </div>
                <span className="mt-4 text-sm font-medium text-violet-700">Ouvrir la fiche →</span>
              </Link>
            </li>
          ),
          )}
        </ul>
      ) : null}
    </div>
  );
}
