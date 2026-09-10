"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ContactEmailPanel from "../../../components/gestion/ContactEmailPanel";
import { MailFlag, bucketFlag, threadListAccent } from "../../../components/gestion/mailFlags";
import { AlertBox, LoadingLine, PageHeader, PageShell } from "../../../components/ui/PageChrome";
import { businessApi, type BizContact, type MailboxThread } from "../../../lib/business";
import { formatDateTime } from "../_shared";

type Bucket = "needs_reply" | "awaiting" | "drafts" | "closed" | "all";

const BUCKETS: Array<{ id: Bucket; label: string; tone: "reply" | "wait" | "draft" | "closed" | "ready" }> = [
  { id: "needs_reply", label: "À traiter", tone: "reply" },
  { id: "awaiting", label: "En attente", tone: "wait" },
  { id: "drafts", label: "Brouillons", tone: "draft" },
  { id: "closed", label: "Clos", tone: "closed" },
  { id: "all", label: "Tous les fils", tone: "ready" },
];

function contactLabel(thread: MailboxThread): string {
  const name = (thread.contact?.name || "").replace(/^\s*\[TEST\]\s*/i, "").trim();
  return name || thread.contact?.email || thread.to_email || "Sans contact";
}

function CourrierPageInner() {
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const threadFromUrl = (searchParams.get("thread") || "").trim();
  const [bucket, setBucket] = useState<Bucket>("needs_reply");
  const [selectedId, setSelectedId] = useState(threadFromUrl);

  useEffect(() => {
    if (threadFromUrl) setSelectedId(threadFromUrl);
  }, [threadFromUrl]);

  const mailbox = useQuery({
    queryKey: ["business-mailbox"],
    queryFn: () => businessApi.listMailbox("all"),
    refetchInterval: 60_000,
  });

  const counts = mailbox.data?.counts || {};
  const threads = mailbox.data?.threads || [];
  const drafts = mailbox.data?.drafts || [];
  const syncMeta = mailbox.data?.sync;

  const visible = useMemo(() => {
    if (bucket === "drafts") return [];
    if (bucket === "all") return threads;
    return threads.filter((t) => t.bucket === bucket);
  }, [bucket, threads]);

  const selected = threads.find((t) => t.id === selectedId) || null;
  const contactId = selected?.contact_id || selected?.contact?.id || "";

  const contact = useQuery({
    queryKey: ["business-contact", contactId],
    queryFn: () => businessApi.getContact(contactId),
    enabled: Boolean(contactId) && bucket !== "drafts",
  });

  const syncAll = useMutation({
    mutationFn: () => businessApi.syncMailbox(),
    onSuccess: (data) => {
      qc.setQueryData(["business-mailbox"], data);
      void qc.invalidateQueries({ queryKey: ["business-contact-emails"] });
    },
  });

  const countFor = (id: Bucket): number => {
    if (id === "drafts") return Number(counts.drafts || drafts.length || 0);
    if (id === "all") return Number(counts.all || threads.length || 0);
    return Number(counts[id] || 0);
  };

  return (
    <PageShell size="wide" className="space-y-5">
      <PageHeader
        accent="emerald"
        badge="Gestion entreprise"
        title="Courrier"
        description="Réponses reçues, relances en attente et brouillons — sans ouvrir chaque fiche. Gmail se synchronise tout seul toutes les 15 minutes."
        actions={
          <>
            <button
              type="button"
              className="btn-secondary"
              disabled={syncAll.isPending}
              onClick={() => syncAll.mutate()}
            >
              {syncAll.isPending ? "Sync Gmail…" : "Actualiser Gmail"}
            </button>
            <Link href="/inbox" className="btn-link-secondary">
              Décisions
            </Link>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        {syncAll.isPending ? (
          <MailFlag tone="gen" pulse>
            Sync Gmail en cours
          </MailFlag>
        ) : syncMeta?.enabled ? (
          <MailFlag tone="llm">
            Sync auto {syncMeta.interval_minutes ? `${syncMeta.interval_minutes} min` : "ON"}
            {syncMeta.last_run_at ? ` · ${formatDateTime(syncMeta.last_run_at)}` : ""}
          </MailFlag>
        ) : (
          <MailFlag tone="fallback">Sync auto indisponible</MailFlag>
        )}
      </div>

      {mailbox.isError ? (
        <AlertBox tone="error" title="Courrier indisponible">
          {mailbox.error instanceof Error ? mailbox.error.message : "Impossible de charger les fils."}
        </AlertBox>
      ) : null}
      {syncAll.isError ? (
        <AlertBox tone="error" title="Sync Gmail">
          {syncAll.error instanceof Error ? syncAll.error.message : "Sync impossible."}
        </AlertBox>
      ) : null}
      {syncAll.isSuccess ? (
        <AlertBox tone="success" title="Gmail à jour">
          {syncAll.data.imported ?? 0} nouvelle(s) réponse(s), {syncAll.data.updated ?? 0} mise(s) à jour,{" "}
          {syncAll.data.contacts_synced ?? 0} contact(s) parcouru(s).
        </AlertBox>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {BUCKETS.map((b) => {
          const active = bucket === b.id;
          const n = countFor(b.id);
          return (
            <button
              key={b.id}
              type="button"
              className={
                active
                  ? "inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-bold text-white shadow-sm " +
                    (b.tone === "reply"
                      ? "bg-teal-700"
                      : b.tone === "wait"
                        ? "bg-amber-600"
                        : b.tone === "draft"
                          ? "bg-violet-700"
                          : b.tone === "closed"
                            ? "bg-slate-600"
                            : "bg-emerald-700")
                  : "inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-slate-400"
              }
              onClick={() => {
                setBucket(b.id);
                setSelectedId("");
              }}
            >
              {b.label}
              <span
                className={
                  active
                    ? "rounded-full bg-white/20 px-1.5 text-xs"
                    : "rounded-full bg-slate-100 px-1.5 text-xs text-slate-600"
                }
              >
                {n}
              </span>
            </button>
          );
        })}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          {mailbox.isLoading ? (
            <div className="p-4">
              <LoadingLine label="Chargement du courrier…" />
            </div>
          ) : null}

          {bucket === "drafts" ? (
            drafts.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">Aucun brouillon en attente de validation.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {drafts.map((d) => (
                  <li key={d.id} className={`p-4 ${threadListAccent("drafts")}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-900">{d.subject || d.title || "Brouillon e-mail"}</p>
                      <MailFlag tone="draft">À valider</MailFlag>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {d.contact?.name || d.to || "Destinataire"}
                      {d.created_at ? ` · ${formatDateTime(d.created_at)}` : ""}
                      {d.attachment_count ? ` · ${d.attachment_count} PJ` : ""}
                    </p>
                    <Link href="/inbox" className="btn-link-primary mt-2 text-xs">
                      Valider dans Décisions
                    </Link>
                  </li>
                ))}
              </ul>
            )
          ) : visible.length === 0 && !mailbox.isLoading ? (
            <p className="p-4 text-sm text-slate-500">
              {bucket === "needs_reply"
                ? "Aucune réponse en attente. Les nouveaux mails arriveront ici après la sync Gmail."
                : "Aucun fil dans ce filtre."}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {visible.map((t) => {
                const active = selectedId === t.id;
                const flag = bucketFlag(t.bucket);
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      className={`${threadListAccent(t.bucket)} w-full p-4 text-left ${
                        active ? "bg-slate-50" : "hover:bg-slate-50"
                      } ${t.bucket === "needs_reply" && !active ? "bg-teal-50/40" : ""}`}
                      onClick={() => setSelectedId(t.id)}
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span className="text-sm font-semibold text-slate-900">{contactLabel(t)}</span>
                        <MailFlag tone={flag.tone}>{flag.label}</MailFlag>
                      </span>
                      <span className="mt-0.5 block truncate text-sm text-slate-700">{t.subject || "(sans objet)"}</span>
                      {t.has_attachments ? (
                        <span className="mt-1 inline-block text-[11px] font-semibold text-slate-600">Pièce jointe</span>
                      ) : null}
                      {t.preview ? (
                        <span className="mt-1 block line-clamp-2 text-xs text-slate-500">{t.preview}</span>
                      ) : null}
                      <span className="mt-1 block text-[11px] text-slate-400">
                        {formatDateTime(t.last_message_at || t.updated_at)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="min-w-0">
          {bucket === "drafts" ? (
            <AlertBox tone="info" title="Brouillons">
              Les e-mails encore listés ici viennent d&apos;une relance CRM ou d&apos;un agent — à valider dans
              Décisions. Les messages rédigés dans Courrier s&apos;envoient directement.
            </AlertBox>
          ) : !selected ? (
            <AlertBox tone="info" title="Choisissez un fil">
              Ouvrez une conversation à gauche pour répondre, sans changer de page. L&apos;envoi se fait depuis le
              rédacteur.
            </AlertBox>
          ) : !contactId ? (
            <AlertBox tone="warn" title="Contact manquant">
              Ce fil n&apos;est plus rattaché à une fiche.{" "}
              <Link href="/gestion/contacts" className="underline">
                Contacts
              </Link>
            </AlertBox>
          ) : contact.isLoading ? (
            <LoadingLine label="Chargement du contact…" />
          ) : contact.isError || !contact.data ? (
            <AlertBox tone="error" title="Fiche introuvable">
              Impossible de charger {contactLabel(selected)}.
            </AlertBox>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-slate-800">{contactLabel(selected)}</p>
                  <MailFlag tone={bucketFlag(selected.bucket).tone}>{bucketFlag(selected.bucket).label}</MailFlag>
                </div>
                <Link
                  href={`/gestion/contacts/${encodeURIComponent(contactId)}`}
                  className="btn-link-secondary text-sm"
                >
                  Ouvrir la fiche
                </Link>
              </div>
              <ContactEmailPanel contact={contact.data as BizContact} focusThreadId={selected.id} />
            </div>
          )}
        </section>
      </div>
    </PageShell>
  );
}

export default function CourrierPage() {
  return (
    <Suspense
      fallback={
        <PageShell size="wide">
          <LoadingLine label="Chargement du courrier…" />
        </PageShell>
      }
    >
      <CourrierPageInner />
    </Suspense>
  );
}
