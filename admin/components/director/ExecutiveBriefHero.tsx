"use client";

import Link from "next/link";

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

type BriefingRitual = {
  executive_summary?: string;
  top_priorities?: ExecutivePriority[];
  memory_highlights?: MemoryHighlight[];
  ritual_status?: "clear" | "decisions_needed" | "budget_alert" | string;
  inbox_total?: number;
  budget?: {
    cost_today_usd?: number;
    cost_week_usd?: number;
    budget_exceeded?: boolean;
    alert?: boolean;
  };
  missions_running?: { job_id: string; mission?: string }[];
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
  if (urgency === "critical") return "ring-red-400 bg-red-50";
  if (urgency === "warning") return "ring-amber-400 bg-amber-50";
  return "ring-violet-200 bg-white";
}

export default function ExecutiveBriefHero({ data, userName }: Props) {
  const priorities = data.top_priorities || [];
  const memory = data.memory_highlights || [];
  const inboxTotal = Number(data.inbox_total ?? 0);
  const running = data.missions_running || [];
  const status = data.ritual_status || "clear";
  const budget = data.budget || {};

  const statusBanner =
    status === "budget_alert"
      ? "border-amber-300 bg-amber-50 text-amber-950"
      : status === "decisions_needed"
        ? "border-violet-300 bg-violet-50 text-violet-950"
        : "border-emerald-200 bg-emerald-50/80 text-emerald-950";

  const name = greetingName(userName);

  return (
    <section className="overflow-hidden rounded-3xl border-2 border-violet-200 bg-gradient-to-br from-white via-violet-50/40 to-white shadow-lg">
      <div className="border-b border-violet-100/80 px-5 py-5 sm:px-8 sm:py-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-widest text-violet-600">Rituel du jour</p>
            <h2 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
              {name ? `Bonjour, ${name}` : "Bonjour"}
            </h2>
            <p className="mt-1 text-sm capitalize text-slate-500">{formatDateFr()}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {inboxTotal > 0 ? (
              <Link
                href="/inbox?triage=1"
                className="inline-flex items-center rounded-2xl bg-violet-700 px-4 py-2.5 text-sm font-bold text-white shadow-md hover:bg-violet-800"
              >
                Traiter l&apos;inbox ({inboxTotal}) — ~2 min
              </Link>
            ) : (
              <span className="inline-flex items-center rounded-2xl border-2 border-emerald-300 bg-emerald-100 px-4 py-2.5 text-sm font-bold text-emerald-900">
                Inbox vide ✓
              </span>
            )}
            <Link
              href="/missions?create=1"
              className="inline-flex items-center rounded-2xl border-2 border-violet-300 bg-white px-4 py-2.5 text-sm font-bold text-violet-900 hover:bg-violet-50"
            >
              Lancer une mission
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
        </p>
      </div>

      {priorities.length > 0 ? (
        <div className="px-5 py-5 sm:px-8">
          <h3 className="text-xs font-extrabold uppercase tracking-widest text-slate-500">Vos priorités</h3>
          <ol className="mt-3 space-y-2">
            {priorities.map((p, i) => (
              <li key={p.id}>
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

      {memory.length > 0 ? (
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
