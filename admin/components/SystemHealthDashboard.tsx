"use client";

import { useMemo, useState } from "react";
import HealthDot from "./HealthDot";
import SimpleAccordion from "./SimpleAccordion";
import type { HealthTone } from "../lib/healthTone";
import {
  compareByStatusThenName,
  healthStatusLabel,
  healthToneForCpuPercent,
  healthToneForDiskPercent,
  healthToneForIntegration,
  healthToneForMemoryPercent,
  integrationDisplayName,
  type IntegrationRow,
  type StatusSortOrder,
} from "../lib/integrationHealth";
import { buildToolProbeRows, type ToolProbeRowData } from "../lib/systemHealthToolProbe";

function formatBytes(n: number | undefined): string {
  if (n == null || Number.isNaN(n) || n < 0) return "—";
  const units = ["o", "Ko", "Mo", "Go", "To"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const rounded = i === 0 ? Math.round(v) : v < 10 ? Math.round(v * 10) / 10 : Math.round(v);
  return `${rounded} ${units[i]}`;
}

function worstTone(a: HealthTone, b: HealthTone): HealthTone {
  const rank: Record<HealthTone, number> = { bad: 3, warn: 2, ok: 1, neutral: 0 };
  return rank[a] >= rank[b] ? a : b;
}

function StatusSortSelect({
  value,
  onChange,
  id,
}: {
  value: StatusSortOrder;
  onChange: (v: StatusSortOrder) => void;
  id: string;
}) {
  return (
    <label htmlFor={id} className="inline-flex items-center gap-2 text-xs text-slate-600">
      <span className="sr-only">Trier par</span>
      <span className="hidden sm:inline">Trier</span>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as StatusSortOrder)}
        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 shadow-sm focus:border-violet-300 focus:outline-none focus:ring-2 focus:ring-violet-100"
      >
        <option value="status-desc">Statut — problèmes d&apos;abord</option>
        <option value="status-asc">Statut — opérationnels d&apos;abord</option>
        <option value="name">Nom (A → Z)</option>
      </select>
    </label>
  );
}

function ToolProbeRowBody({ row }: { row: ToolProbeRowData }) {
  return (
    <>
      <p className="text-sm font-medium text-slate-800">
        {row.title}
        {row.providerBadge ? (
          <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
            {row.providerBadge}
          </span>
        ) : null}
      </p>
      {row.webChain ? (
        <p className="mt-0.5 text-[11px] text-slate-500">
          Chaîne :{" "}
          {row.webChain.tavily ? (
            <span className="font-medium text-emerald-600">Tavily ✓</span>
          ) : (
            <span className="text-slate-400">Tavily —</span>
          )}
          {" → "}
          {row.webChain.brave ? (
            <span className="font-medium text-emerald-600">Brave ✓</span>
          ) : (
            <span className="text-slate-400">Brave —</span>
          )}
          {" → "}
          <span className="text-slate-600">DuckDuckGo ✓</span>
        </p>
      ) : (
        <p className="mt-0.5 text-[11px] text-slate-500">{row.description}</p>
      )}
    </>
  );
}

function aggregateIntegrationsTone(integrations: Record<string, IntegrationRow> | undefined): HealthTone {
  if (!integrations) return "neutral";
  let t: HealthTone = "neutral";
  for (const [id, row] of Object.entries(integrations)) {
    t = worstTone(t, healthToneForIntegration(id, row));
  }
  return t;
}

type Props = {
  data: Record<string, unknown> | null | undefined;
  loading?: boolean;
  error?: boolean;
};

export default function SystemHealthDashboard({ data, loading, error }: Props) {
  const [statusSort, setStatusSort] = useState<StatusSortOrder>("status-desc");
  const integrations = data?.integrations as Record<string, IntegrationRow> | undefined;
  const toolsProbe = data?.tools_probe as Record<string, unknown> | undefined;
  const system = data?.system as Record<string, unknown> | undefined;
  const summary = data?.summary as Record<string, unknown> | undefined;
  const database = data?.database as Record<string, unknown> | undefined;

  const cpu = system?.cpu_percent != null ? Number(system.cpu_percent) : null;
  const mem = system?.memory as Record<string, unknown> | undefined;
  const memPct = mem?.used_percent != null ? Number(mem.used_percent) : null;
  const disk = system?.disk as Record<string, unknown> | undefined;
  const diskPct = disk?.used_percent != null ? Number(disk.used_percent) : null;

  const headerTone = useMemo(() => {
    if (error) return "bad" as const;
    if (loading || !data) return "neutral" as const;
    let t = aggregateIntegrationsTone(integrations);
    t = worstTone(t, healthToneForCpuPercent(cpu));
    t = worstTone(t, healthToneForMemoryPercent(memPct));
    t = worstTone(t, healthToneForDiskPercent(diskPct));
    const ws = toolsProbe?.web_search as { ok?: boolean } | undefined;
    const rp = toolsProbe?.read_webpage as { ok?: boolean } | undefined;
    if (ws?.ok === false || rp?.ok === false) t = worstTone(t, "bad");
    return t;
  }, [data, loading, error, integrations, cpu, memPct, diskPct, toolsProbe]);

  const integrationEntries = useMemo(() => {
    if (!integrations) return [] as Array<[string, IntegrationRow]>;
    return Object.entries(integrations).sort(([idA, rowA], [idB, rowB]) => {
      const nameA = integrationDisplayName(idA);
      const nameB = integrationDisplayName(idB);
      return compareByStatusThenName(
        healthToneForIntegration(idA, rowA),
        healthToneForIntegration(idB, rowB),
        nameA,
        nameB,
        statusSort,
      );
    });
  }, [integrations, statusSort]);

  const toolProbeEntries = useMemo(() => {
    if (!toolsProbe) return [] as ToolProbeRowData[];
    return [...buildToolProbeRows(toolsProbe)].sort((a, b) =>
      compareByStatusThenName(a.tone, b.tone, a.title, b.title, statusSort),
    );
  }, [toolsProbe, statusSort]);

  const headerMsg =
    headerTone === "bad"
      ? "Au moins une intégration est en panne (pastilles rouges)."
      : headerTone === "warn"
        ? "Des clés API manquent ou la configuration est incomplète (pastilles orange)."
        : headerTone === "ok"
          ? "Intégrations configurées et opérationnelles."
          : "État en cours d’analyse…";

  if (loading) {
    return <p className="text-sm text-slate-500">Analyse de la santé système…</p>;
  }
  if (error) {
    return (
      <div className="rounded-2xl border border-red-100 bg-red-50/90 p-4 text-sm text-red-800">
        Santé admin indisponible (secret agent ou backend).
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="space-y-5">
      <div
        className={`flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 ${
          headerTone === "bad"
            ? "border-red-200 bg-red-50/90"
            : headerTone === "warn"
              ? "border-amber-200 bg-amber-50/80"
              : headerTone === "ok"
                ? "border-emerald-200 bg-emerald-50/70"
                : "border-slate-200 bg-slate-50"
        }`}
      >
        <HealthDot tone={headerTone} label={headerMsg} size="md" />
        <p className="min-w-0 flex-1 text-sm font-medium text-slate-800">{headerMsg}</p>
        <p className="text-xs text-slate-500">
          v{String(data.version || "—")} · {String(data.service || "backend")}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1">
          <HealthDot tone="ok" label="Opérationnel" />
          Opérationnel
        </span>
        <span className="text-slate-300">|</span>
        <span className="inline-flex items-center gap-1">
          <HealthDot tone="warn" label="Clé manquante" />
          Clé manquante
        </span>
        <span className="text-slate-300">|</span>
        <span className="inline-flex items-center gap-1">
          <HealthDot tone="bad" label="Indisponible" />
          Indisponible
        </span>
        <span className="text-slate-300">|</span>
        <span className="inline-flex items-center gap-1">
          <HealthDot tone="neutral" label="Non concerné" />
          Non concerné
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <HealthDot tone={healthToneForCpuPercent(cpu)} label="Charge CPU" />
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">CPU</p>
          </div>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">{cpu != null ? `${cpu.toFixed(0)} %` : "—"}</p>
          <p className="mt-1 text-xs text-slate-500">Cœurs : {String(system?.cpu_count ?? "—")}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <HealthDot tone={healthToneForMemoryPercent(memPct)} label="Mémoire vive" />
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Mémoire</p>
          </div>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">{memPct != null ? `${memPct.toFixed(0)} %` : "—"}</p>
          <p className="mt-1 text-xs text-slate-500">
            Dispo. {formatBytes(mem?.available_bytes != null ? Number(mem.available_bytes) : undefined)} /{" "}
            {formatBytes(mem?.total_bytes != null ? Number(mem.total_bytes) : undefined)}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:col-span-2 lg:col-span-1">
          <div className="flex items-center gap-2">
            <HealthDot tone={healthToneForDiskPercent(diskPct)} label="Disque" />
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Disque</p>
          </div>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">{diskPct != null ? `${diskPct.toFixed(1)} %` : "—"}</p>
          <p className="mt-1 truncate text-xs text-slate-500" title={String(disk?.path || "")}>
            Libre {formatBytes(disk?.free_bytes != null ? Number(disk.free_bytes) : undefined)} ·{" "}
            {String(disk?.path || "—")}
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
          <HealthDot tone={database?.connected === true ? "ok" : database?.connected === false ? "bad" : "neutral"} label="Base de données active" />
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Base de données</p>
        </div>
        <div className="mt-3 space-y-1.5 text-sm">
          <p className="text-slate-700">
            Moteur actif :{" "}
            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-800">
              {String(database?.engine || "—")}
            </span>
            {" "}
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                String(database?.runtime_env || "").includes("prod")
                  ? "bg-violet-100 text-violet-700"
                  : "bg-emerald-100 text-emerald-700"
              }`}
            >
              {String(database?.runtime_env || "").includes("prod") ? "PROD" : "DEV"}
            </span>
          </p>
          {"database" in (database || {}) ? (
            <p className="text-xs text-slate-600">
              Base : <span className="font-mono text-slate-700">{String(database?.database || "—")}</span>
            </p>
          ) : null}
          {"host" in (database || {}) ? (
            <p className="text-xs text-slate-600">
              Hôte : <span className="font-mono text-slate-700">{String(database?.host || "—")}:{String(database?.port || "—")}</span>
            </p>
          ) : null}
          {"user" in (database || {}) ? (
            <p className="text-xs text-slate-600">
              User : <span className="font-mono text-slate-700">{String(database?.user || "—")}</span>
            </p>
          ) : null}
          {"path" in (database || {}) ? (
            <p className="truncate text-xs text-slate-600" title={String(database?.path || "")}>
              Fichier SQLite : <span className="font-mono text-slate-700">{String(database?.path || "—")}</span>
            </p>
          ) : null}
          {database?.connected === true ? (
            <p className="text-xs font-medium text-emerald-700">Connexion DB OK</p>
          ) : database?.connected === false ? (
            <p className="text-xs font-medium text-red-700">
              Connexion DB KO{database?.probe_detail ? ` — ${String(database.probe_detail)}` : ""}
            </p>
          ) : null}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Intégrations & clés</p>
          <div className="flex flex-wrap items-center gap-3">
            {summary ? (
              <p className="text-xs text-slate-500">
                Configurées :{" "}
                <span className="font-medium text-slate-800">{String(summary.configured_count ?? "—")}</span> /{" "}
                {String(summary.total_integrations ?? "—")}
              </p>
            ) : null}
            <StatusSortSelect id="integration-status-sort" value={statusSort} onChange={setStatusSort} />
          </div>
        </div>
        <ul className="mt-3 divide-y divide-slate-100">
          {integrationEntries.map(([id, row]) => {
            const tone = healthToneForIntegration(id, row);
            return (
              <li key={id} className="flex flex-wrap items-start gap-3 py-2.5 first:pt-0">
                <HealthDot tone={tone} label={integrationDisplayName(id)} className="mt-1.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-slate-800">{integrationDisplayName(id)}</p>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                        tone === "ok"
                          ? "bg-emerald-100 text-emerald-700"
                          : tone === "warn"
                            ? "bg-amber-100 text-amber-800"
                            : tone === "bad"
                              ? "bg-red-100 text-red-700"
                              : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {healthStatusLabel(tone)}
                    </span>
                  </div>
                  <p className="mt-0.5 font-mono text-[11px] text-slate-500">{id}</p>
                  {"note" in row && row.note && !("probe_detail" in row && row.probe_detail) ? (
                    <p className="mt-1 text-[11px] text-slate-400">{String(row.note).slice(0, 220)}</p>
                  ) : null}
                  {"probe_detail" in row && row.probe_detail ? (
                    <p className="mt-1 text-xs text-amber-900">{String(row.probe_detail).slice(0, 220)}</p>
                  ) : null}
                  {"active_provider" in row && row.active_provider ? (
                    <p className="mt-1 text-[11px] text-emerald-700">
                      Provider actif : <span className="font-semibold">{String(row.active_provider)}</span>
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {toolsProbe ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Sonde outils — état en direct
            </p>
            <StatusSortSelect id="tools-status-sort" value={statusSort} onChange={setStatusSort} />
          </div>
          <ul className="divide-y divide-slate-100">
            {toolProbeEntries.map((item) => (
              <li key={item.key} className="flex flex-wrap items-start gap-3 py-2.5 first:pt-0">
                <HealthDot tone={item.tone} label={item.title} className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <ToolProbeRowBody row={item} />
                  <span
                    className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      item.tone === "ok"
                        ? "bg-emerald-100 text-emerald-700"
                        : item.tone === "warn"
                          ? "bg-amber-100 text-amber-800"
                          : item.tone === "bad"
                            ? "bg-red-100 text-red-700"
                            : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {healthStatusLabel(item.tone)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <SimpleAccordion
        className="rounded-2xl border border-slate-200 bg-slate-50/80 shadow-sm"
        triggerClassName="cursor-pointer rounded-2xl px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-100/80"
        panelClassName="border-t border-slate-200 px-4 py-3"
        title="Données brutes (JSON)"
        defaultOpen={false}
      >
        <pre className="max-h-80 overflow-auto rounded-xl bg-slate-900 p-3 text-xs text-emerald-100/95">
          {JSON.stringify(data, null, 2)}
        </pre>
      </SimpleAccordion>
    </div>
  );
}
