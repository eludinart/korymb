"use client";

import Link from "next/link";
import { useUiMode } from "../../lib/uiMode";

export type ExecutivePriority = {
  id: string;
  label: string;
  href: string;
  kind?: string;
  urgency?: string;
  job_id?: string;
};

export type MemoryHighlight = {
  key: string;
  label: string;
  snippet: string;
};

export type MemoryDigest = {
  lines?: string[];
  pending_count?: number;
  href?: string;
};

export type DayAnticipation = {
  lines?: string[];
  events?: Array<{ id?: string; title?: string; when_label?: string; href?: string }>;
  href?: string;
};

type BriefingRitual = {
  executive_summary?: string;
  top_priorities?: ExecutivePriority[];
  memory_highlights?: MemoryHighlight[];
  memory_digest?: MemoryDigest | null;
  day_anticipation?: DayAnticipation | null;
  inbox_severity?: { critical?: number; high?: number; medium?: number; low?: number } | null;
  ritual_status?: "clear" | "decisions_needed" | "budget_alert" | "config_blocked" | string;
  llm_readiness?: {
    ready?: boolean;
    provider?: string | null;
    blocker?: string | null;
  };
  recent_errors?: { job_id?: string; mission?: string; error?: string }[];
  inbox_total?: number;
  budget?: {
    cost_today_usd?: number;
    cost_week_usd?: number;
    budget_exceeded?: boolean;
    alert?: boolean;
  };
  missions_running?: { job_id: string; mission?: string }[];
  unconsulted_results_count?: number;
};

type Props = {
  data: BriefingRitual;
  userName?: string;
};

function greetingName(userName?: string) {
  if (userName?.trim()) return userName.trim();
  return null;
}

function formatDateFr() {
  return new Date().toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function urgencyRing(urgency?: string) {
  if (urgency === "critical") return "ring-red-400 bg-red-50 dark:bg-red-950 dark:ring-red-500";
  if (urgency === "warning") return "ring-amber-400 bg-amber-50 dark:bg-amber-950 dark:ring-amber-500";
  return "ring-violet-200 bg-white dark:bg-slate-900 dark:ring-violet-700";
}

export default function ExecutiveBriefHero({ data, userName }: Props) {
  const { isPlatformOwner } = useUiMode();
  const priorities = data.top_priorities || [];
  const memory = data.memory_highlights || [];
  const digest = data.memory_digest;
  const digestLines = digest?.lines || [];
  const day = data.day_anticipation;
  const dayLines = day?.lines || [];
  const severity = data.inbox_severity || {};
  const criticalHigh = Number(severity.critical || 0) + Number(severity.high || 0);
  const inboxTotal = Number(data.inbox_total ?? 0);
  const running = data.missions_running || [];
  const unconsultedCount = Number(data.unconsulted_results_count ?? 0);
  const status = data.ritual_status || "clear";
  const llm = data.llm_readiness || {};
  const recentErrors = data.recent_errors || [];
  const budget = data.budget || {};

  const statusBanner =
    status === "config_blocked"
      ? "border-rose-300 bg-rose-50 text-rose-950 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-100"
      : status === "budget_alert"
        ? "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
        : status === "decisions_needed"
          ? "border-violet-300 bg-violet-50 text-violet-950 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-100"
          : "border-emerald-200 bg-emerald-50/80 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-100";

  const name = greetingName(userName);

  return (
    <section className="overflow-hidden rounded-3xl border-2 border-violet-200 bg-gradient-to-br from-white via-violet-50/40 to-white shadow-lg dark:border-violet-800 dark:from-slate-900 dark:via-violet-950/40 dark:to-slate-900">
      <div className="border-b border-violet-100/80 px-5 py-5 dark:border-violet-900/60 sm:px-8 sm:py-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-widest text-violet-600 dark:text-violet-300">Mode Cerveau</p>
            <h2 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-50 sm:text-3xl">
              {name ? `Bonjour, ${name}` : "Bonjour"}
            </h2>
            <p className="mt-1 text-sm capitalize text-slate-500 dark:text-slate-400">{formatDateFr()}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {llm.ready === false && isPlatformOwner ? (
              <Link
                href="/configuration"
                className="inline-flex items-center rounded-2xl bg-rose-700 px-4 py-2.5 text-sm font-bold text-white shadow-md hover:bg-rose-800"
              >
                Ajouter la clé LLM
              </Link>
            ) : null}
            {inboxTotal > 0 ? (
              <Link
                href={criticalHigh > 0 ? "/inbox?severity=critical" : "/inbox?triage=1"}
                className="inline-flex items-center rounded-2xl bg-violet-700 px-4 py-2.5 text-sm font-bold text-white shadow-md hover:bg-violet-800"
              >
                {criticalHigh > 0
                  ? `Traiter les urgentes (${criticalHigh})`
                  : `Traiter les décisions (${inboxTotal})`}
              </Link>
            ) : (
              <span className="inline-flex items-center rounded-2xl border-2 border-emerald-300 bg-emerald-100 px-4 py-2.5 text-sm font-bold text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200">
                Aucune décision en attente ✓
              </span>
            )}
            <Link
              href="/missions?create=1"
              className="inline-flex items-center rounded-2xl border-2 border-violet-300 bg-white px-4 py-2.5 text-sm font-bold text-violet-900 hover:bg-violet-50 dark:border-violet-600 dark:bg-slate-900 dark:text-violet-200 dark:hover:bg-violet-950"
            >
              Une intention
            </Link>
          </div>
        </div>
      </div>

      <div className={`mx-5 mt-5 rounded-2xl border-2 px-4 py-4 sm:mx-8 ${statusBanner}`}>
        <p className="text-base font-semibold leading-relaxed sm:text-lg">
          {data.executive_summary || "Votre cockpit est prêt."}
        </p>
        <p className="mt-2 text-sm opacity-80">
          Aujourd&apos;hui ${Number(budget.cost_today_usd || 0).toFixed(2)} · Semaine $
          {Number(budget.cost_week_usd || 0).toFixed(2)}
          {budget.budget_exceeded || budget.alert ? " · Alerte budget active" : ""}
          {running.length > 0 ? ` · ${running.length} mission(s) en cours` : ""}
          {unconsultedCount > 0
            ? ` · ${unconsultedCount} résultat(s) non consulté(s)`
            : ""}
        </p>
        {llm.ready === false && llm.blocker ? (
          <p className="mt-2 text-sm font-bold">
            {llm.blocker}. Ouvrez Configuration, collez la clé du fournisseur actif
            {llm.provider ? ` (${llm.provider})` : ""}, puis relancez.
          </p>
        ) : null}
      </div>

      {recentErrors.length > 0 ? (
        <div className="px-5 pt-4 sm:px-8">
          <h3 className="text-xs font-extrabold uppercase tracking-widest text-rose-700">Échecs récents</h3>
          <ul className="mt-2 space-y-1.5">
            {recentErrors.map((err) => (
              <li key={String(err.job_id || err.error)} className="text-sm text-slate-700">
                <span className="font-bold text-slate-900">{err.mission || err.job_id} :</span>{" "}
                {err.error || "échec"}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {priorities.length > 0 ? (
        <div className="px-5 py-5 sm:px-8">
          <h3 className="text-xs font-extrabold uppercase tracking-widest text-slate-500">Vos priorités</h3>
          <ol className="mt-3 space-y-2">
            {priorities.map((p, i) => (
              <li key={`${String(p.id)}:${i}`}>
                <Link
                  href={p.href}
                  className={`flex items-center gap-3 rounded-2xl border-2 p-3 ring-2 transition hover:shadow-md ${urgencyRing(p.urgency)}`}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-700 text-sm font-extrabold text-white">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 text-sm font-bold text-slate-900">{p.label}</span>
                  <span className="shrink-0 text-sm font-bold text-violet-700">Agir →</span>
                </Link>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {dayLines.length > 0 ? (
        <div className="border-t border-violet-100 px-5 py-4 sm:px-8">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-extrabold uppercase tracking-widest text-slate-500">Bientôt</h3>
            <Link href={day?.href || "/gestion/planning"} className="text-xs font-bold text-violet-700 hover:underline">
              Planning →
            </Link>
          </div>
          <ul className="mt-2 space-y-1.5">
            {dayLines.slice(0, 3).map((line, i) => (
              <li key={`${i}-${line.slice(0, 20)}`} className="text-sm text-slate-700">
                • {line}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {digestLines.length > 0 ? (
        <div className="border-t border-violet-100 px-5 py-4 sm:px-8">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-extrabold uppercase tracking-widest text-slate-500">
              Mémoire du jour
            </h3>
            <Link
              href={digest?.href || "/administration/memory"}
              className="text-xs font-bold text-violet-700 hover:underline"
            >
              {Number(digest?.pending_count || 0) > 0 ? "Traiter →" : "Modifier →"}
            </Link>
          </div>
          <ul className="mt-2 space-y-1.5">
            {digestLines.slice(0, 3).map((line, i) => (
              <li key={`${i}-${line.slice(0, 20)}`} className="text-sm text-slate-700">
                • {line}
              </li>
            ))}
          </ul>
        </div>
      ) : memory.length > 0 ? (
        <div className="border-t border-violet-100 px-5 py-4 sm:px-8">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-extrabold uppercase tracking-widest text-slate-500">
              Ce que Korymb retient
            </h3>
            <Link href="/administration/memory" className="text-xs font-bold text-violet-700 hover:underline">
              Modifier
            </Link>
          </div>
          <ul className="mt-2 space-y-1.5">
            {memory.map((m) => (
              <li key={m.key} className="text-sm text-slate-700">
                <span className="font-bold text-slate-900">{m.label} :</span> {m.snippet}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
