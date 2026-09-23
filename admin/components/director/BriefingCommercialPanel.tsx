"use client";

import Link from "next/link";

export type CommercialMorningSnapshot = {
  counts?: {
    follow_ups_due_today?: number;
    follow_ups_overdue?: number;
    follow_ups_due_tomorrow?: number;
    stale_quotes?: number;
    weak_contacts?: number;
    email_threads_open?: number;
    email_threads_needs_reply?: number;
    email_threads_replied_recent?: number;
    email_drafts_pending?: number;
  };
  follow_ups_due_today?: Array<{
    id?: string;
    title?: string;
    starts_at?: string;
    overdue?: boolean;
    contact_id?: string;
    contact_name?: string;
    has_email?: boolean;
  }>;
  stale_quotes?: Array<{
    id?: string;
    quote_number?: string;
    title?: string;
    days_stale?: number;
    contact_id?: string;
  }>;
  weak_contacts?: Array<{
    id?: string;
    name?: string;
    email?: string;
    reachability?: { level?: string; label?: string };
  }>;
  email_threads_open?: Array<{
    id?: string;
    contact_id?: string;
    subject?: string;
    to_email?: string;
    last_message_at?: string;
  }>;
  follow_ups_due_tomorrow_count?: number;
};

type Props = {
  data?: CommercialMorningSnapshot | null;
};

/** Tableau de bord commercial du matin — relances, devis, joignabilité. */
export default function BriefingCommercialPanel({ data }: Props) {
  if (!data) return null;
  const counts = data.counts || {};
  const followUps = data.follow_ups_due_today || [];
  const staleQuotes = data.stale_quotes || [];
  const weak = data.weak_contacts || [];
  const openMails = data.email_threads_open || [];
  const totalSignal =
    Number(counts.follow_ups_due_today || 0) +
    Number(counts.stale_quotes || 0) +
    Number(counts.weak_contacts || 0) +
    Number(counts.email_threads_open || openMails.length || 0) +
    Number(counts.email_threads_needs_reply || 0);
  if (totalSignal === 0 && !Number(counts.follow_ups_due_tomorrow || 0)) {
    return (
      <section
        className="rounded-2xl border-2 border-teal-200 bg-gradient-to-br from-teal-50/90 via-white to-white p-4 shadow-sm sm:p-5"
        aria-labelledby="briefing-commercial-heading"
      >
        <h2 id="briefing-commercial-heading" className="text-base font-bold text-teal-950">
          Commercial du matin
        </h2>
        <p className="mt-1 text-sm text-teal-900/80">
          Rien d&apos;urgent — aucune relance due, devis en attente ni fiche injoignable.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/gestion/studio" className="btn-link-secondary text-sm">
            Studio
          </Link>
          <Link href="/gestion/courrier" className="btn-link-secondary text-sm">
            Messages
          </Link>
          <Link href="/inbox?triage=1" className="btn-link-secondary text-sm">
            À valider
          </Link>
          <Link href="/gestion/devis" className="btn-link-secondary text-sm">
            Devis
          </Link>
          <Link href="/gestion/planning" className="btn-link-secondary text-sm">
            Calendrier
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section
      className="rounded-2xl border-2 border-teal-200 bg-gradient-to-br from-teal-50/90 via-white to-white p-4 shadow-sm sm:p-5"
      aria-labelledby="briefing-commercial-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="briefing-commercial-heading" className="text-base font-bold text-teal-950">
            Commercial du matin
          </h2>
          <p className="mt-0.5 text-sm text-teal-900/80">
            Relances dues, devis sans réponse, fiches à compléter — votre tableau de bord avant les décisions.
          </p>
        </div>
        <Link href="/gestion/courrier" className="btn-success text-xs sm:text-sm">
          Ouvrir le courrier →
        </Link>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <div className="rounded-xl border border-teal-100 bg-white/90 px-3 py-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-teal-700">Relances aujourd&apos;hui</p>
          <p className="mt-1 text-2xl font-extrabold text-slate-900">{counts.follow_ups_due_today || 0}</p>
          {Number(counts.follow_ups_overdue || 0) > 0 ? (
            <p className="text-xs font-semibold text-amber-800">{counts.follow_ups_overdue} en retard</p>
          ) : null}
        </div>
        <div className="rounded-xl border border-teal-100 bg-white/90 px-3 py-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-teal-700">Devis &gt; 7 j</p>
          <p className="mt-1 text-2xl font-extrabold text-slate-900">{counts.stale_quotes || 0}</p>
          <p className="text-xs text-slate-500">envoyés sans suite</p>
        </div>
        <div className="rounded-xl border border-teal-100 bg-white/90 px-3 py-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-teal-700">Joignabilité</p>
          <p className="mt-1 text-2xl font-extrabold text-slate-900">{counts.weak_contacts || 0}</p>
          <p className="text-xs text-slate-500">
            demain : {counts.follow_ups_due_tomorrow ?? data.follow_ups_due_tomorrow_count ?? 0} relance(s)
          </p>
        </div>
      </div>

      {followUps.length > 0 ? (
        <div className="mt-4">
          <p className="text-xs font-bold uppercase tracking-wide text-teal-800">À traiter aujourd&apos;hui</p>
          <ul className="mt-2 space-y-2">
            {followUps.slice(0, 5).map((ev) => (
              <li
                key={ev.id || ev.title}
                className="flex flex-col gap-1 rounded-lg border border-teal-100 bg-white/80 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-900">
                    {ev.title || "Relance"}
                    {ev.contact_name ? ` — ${ev.contact_name}` : ""}
                  </p>
                  {ev.overdue ? <p className="text-xs font-semibold text-amber-800">En retard</p> : null}
                </div>
                <div className="flex shrink-0 gap-2">
                  {ev.id ? (
                    <Link
                      href={`/inbox?triage=1&focus=${encodeURIComponent(ev.id)}`}
                      className="btn-link-primary text-xs"
                    >
                      À valider
                    </Link>
                  ) : null}
                  {ev.contact_id ? (
                    <Link
                      href={`/gestion/contacts/${encodeURIComponent(ev.contact_id)}`}
                      className="btn-link-secondary text-xs"
                    >
                      Fiche
                    </Link>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {staleQuotes.length > 0 ? (
        <div className="mt-4">
          <p className="text-xs font-bold uppercase tracking-wide text-teal-800">Devis à relancer</p>
          <ul className="mt-2 space-y-2">
            {staleQuotes.slice(0, 4).map((q) => (
              <li
                key={q.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-100 bg-amber-50/60 px-3 py-2"
              >
                <span className="text-sm font-semibold text-slate-900">
                  {q.quote_number || q.title || q.id}
                  {q.days_stale != null ? (
                    <span className="ml-2 text-xs font-medium text-amber-800">{q.days_stale} j</span>
                  ) : null}
                </span>
                <Link href="/gestion/devis" className="btn-link-secondary text-xs">
                  Devis
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {weak.length > 0 ? (
        <div className="mt-4">
          <p className="text-xs font-bold uppercase tracking-wide text-teal-800">Fiches peu joignables</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {weak.slice(0, 6).map((c) => (
              <Link
                key={c.id}
                href={`/gestion/contacts/${encodeURIComponent(c.id || "")}`}
                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-800 hover:border-teal-300"
              >
                {c.name || "Contact"}
              </Link>
            ))}
          </ul>
        </div>
      ) : null}

      {openMails.length > 0 ? (
        <div className="mt-4">
          <p className="text-xs font-bold uppercase tracking-wide text-teal-800">
            E-mails en attente de réponse ({counts.email_threads_open ?? openMails.length})
          </p>
          <ul className="mt-2 space-y-2">
            {openMails.slice(0, 5).map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-teal-100 bg-white/80 px-3 py-2"
              >
                <span className="truncate text-sm font-semibold text-slate-900">
                  {t.subject || t.to_email || "Fil e-mail"}
                </span>
                <Link href="/gestion/courrier" className="btn-link-secondary text-xs">
                  Messages
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
