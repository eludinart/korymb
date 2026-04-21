"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import SystemHealthDashboard from "../../../components/SystemHealthDashboard";
import WebToolsProbeCard from "../../../components/WebToolsProbeCard";
import HealthDot from "../../../components/HealthDot";
import { requestJson } from "../../../lib/api";
import { QK } from "../../../lib/queryClient";

const visibleInterval = (ms: number) =>
  typeof document !== "undefined" && document.visibilityState === "visible" ? ms : false;

export default function AdministrationDashboardPage() {
  const qc = useQueryClient();
  const health = useQuery({
    queryKey: QK.health,
    queryFn: async () => (await requestJson("/health", { retries: 1 })).data,
    refetchInterval: () => visibleInterval(15000),
  });
  const tools = useQuery({
    queryKey: ["health-tools"],
    queryFn: async () => (await requestJson("/health/tools", { retries: 1 })).data,
    refetchInterval: () => visibleInterval(20000),
  });
  const system = useQuery({
    queryKey: ["admin-system-health"],
    queryFn: async () => (await requestJson("/admin/system-health", { retries: 1 })).data,
    refetchInterval: () => visibleInterval(20000),
  });

  const retestWebTools = async () => {
    try {
      const { data } = await requestJson("/health/tools?refresh=true", { retries: 1 });
      qc.setQueryData(["health-tools"], data);
    } catch {
      void tools.refetch();
    }
  };

  const backendTone = health.isError ? "bad" : health.isSuccess ? "ok" : "neutral";
  const backendLabel = health.isError ? "Backend injoignable" : health.isSuccess ? "Backend joignable" : "Backend…";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Tableau de bord santé</h1>
        <p className="mt-1 text-sm text-slate-500">
          Vue consolidée des sondes, intégrations et métriques machine. Pastilles : vert = OK, orange = vigilance, rouge =
          critique.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <HealthDot tone={backendTone} label={backendLabel} size="md" />
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Backend</p>
          </div>
          {health.isLoading ? <p className="mt-3 text-sm text-slate-400">Chargement…</p> : null}
          {health.isError ? <p className="mt-3 text-sm text-red-700">Impossible de joindre /health.</p> : null}
          {health.isSuccess ? (
            <div className="mt-3 space-y-1 text-sm">
              <p className="font-mono text-slate-800">revision : {String(health.data?.revision || "—")}</p>
              <p className="text-xs text-slate-500">service : {String(health.data?.service || "—")}</p>
            </div>
          ) : null}
        </div>
        <WebToolsProbeCard
          data={tools.data}
          loading={tools.isLoading}
          error={tools.isError}
          onRetest={() => void retestWebTools()}
        />
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Santé système & intégrations</h2>
        <p className="mt-1 text-sm text-slate-500">
          Données issues de <code className="rounded bg-slate-100 px-1 text-xs">/admin/system-health</code> (secret agent
          côté Next).
        </p>
        <div className="mt-5">
          <SystemHealthDashboard data={system.data} loading={system.isLoading} error={system.isError} />
        </div>
      </section>
    </div>
  );
}
