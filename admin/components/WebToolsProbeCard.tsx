"use client";

import HealthDot from "./HealthDot";
import type { HealthTone } from "../lib/healthTone";

type Probe = {
  checked_at?: string;
  cached?: boolean;
  cache_ttl_s?: number;
  cache_age_s?: number;
  web_search?: { ok?: boolean; message?: string | null };
  read_webpage?: { ok?: boolean; message?: string | null };
  search_linkedin?: { ok?: boolean; note?: string };
};

function formatProbeWhen(iso: string | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("fr-FR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function rowTone(ok: boolean | undefined): HealthTone {
  if (ok === true) return "ok";
  if (ok === false) return "bad";
  return "neutral";
}

function linkedinTone(data: Probe): HealthTone {
  if (data.web_search?.ok === false) return "bad";
  if (data.web_search?.ok === true) return "warn";
  return "neutral";
}

type Props = {
  data: Probe | null | undefined;
  loading?: boolean;
  error?: boolean;
  onRetest: () => void;
};

export default function WebToolsProbeCard({ data, loading, error, onRetest }: Props) {
  const ttl = Number(data?.cache_ttl_s ?? 120);
  const cached = Boolean(data?.cached);
  const age = data?.cache_age_s != null ? Number(data.cache_age_s) : null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3 mb-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-sky-700">Outils web (hors LLM)</h2>
        <button
          type="button"
          onClick={onRetest}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
        >
          Retester
        </button>
      </div>
      {loading ? <p className="text-sm text-slate-500">Sonde en cours…</p> : null}
      {error ? <p className="text-sm text-red-700">Impossible de joindre la sonde.</p> : null}
      {!loading && !error && data ? (
        <ul className="space-y-3 text-sm text-slate-800">
          <li className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2">
              <HealthDot tone={rowTone(data.web_search?.ok)} label="Recherche web DuckDuckGo" />
              Recherche web (DuckDuckGo)
            </span>
            <span className={`font-semibold ${data.web_search?.ok ? "text-emerald-700" : "text-red-700"}`}>
              {data.web_search?.ok ? "D'accord" : "Problème"}
            </span>
          </li>
          <li className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2">
              <HealthDot tone={rowTone(data.read_webpage?.ok)} label="Lecture HTTP" />
              Lecture HTTP (page de test)
            </span>
            <span className={`font-semibold ${data.read_webpage?.ok ? "text-emerald-700" : "text-red-700"}`}>
              {data.read_webpage?.ok ? "D'accord" : "Problème"}
            </span>
          </li>
          <li className="flex flex-wrap items-start gap-2 text-slate-600">
            <HealthDot tone={linkedinTone(data)} label="LinkedIn via même pile que la recherche web" />
            <div>
              <span className="text-slate-800">LinkedIn (DDG)</span>
              <span className="text-slate-500">
                {" "}
                — {data.search_linkedin?.note || "Même pile que la recherche web (déduit OK si recherche OK)."}
              </span>
            </div>
          </li>
        </ul>
      ) : null}
      {!loading && !error && data?.web_search?.ok === false && data.web_search?.message ? (
        <p className="mt-2 text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-2 py-1.5">{data.web_search.message}</p>
      ) : null}
      {!loading && !error && data?.read_webpage?.ok === false && data.read_webpage?.message ? (
        <p className="mt-2 text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-2 py-1.5">{data.read_webpage.message}</p>
      ) : null}
      <p className="mt-4 text-[11px] text-slate-400">
        Sonde : {formatProbeWhen(data?.checked_at)}
        {cached ? (
          <>
            {" "}
            · Cache ~{ttl}s{age != null ? ` (âge ${age}s)` : ""}
          </>
        ) : (
          <> · Résultat direct (non servi depuis le cache)</>
        )}
      </p>
    </div>
  );
}
