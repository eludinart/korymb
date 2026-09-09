"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { businessApi, type BizContact, type ContactEmailThread } from "../../lib/business";
import { formatDateTime } from "../../app/gestion/_shared";
import { AlertBox, LoadingLine } from "../ui/PageChrome";

type Props = {
  contact: BizContact;
};

function displayContactName(raw: string): string {
  return (raw || "")
    .replace(/^\s*\[TEST\]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Objet prospection réaliste (sans préfixe [TEST]). */
export function defaultProspectSubject(contact: BizContact): string {
  const name = displayContactName(contact.name || "");
  const company = (contact.company || "").trim();
  const tags = (contact.tags || []).map((t) => t.toLowerCase());
  const isCoachLike = tags.some((t) =>
    ["coach", "thérapeute", "therapeute", "bien-être", "bien-etre"].includes(t),
  );
  if (isCoachLike || company) {
    const angle = company || name || "votre pratique";
    return `Proposition Fleur d'ÅmÔurs — enrichir ${angle}`.slice(0, 160);
  }
  if (name) return `Élude In Art — échange avec ${name}`.slice(0, 160);
  return "Élude In Art — proposition de collaboration";
}

export default function ContactEmailPanel({ contact }: Props) {
  const qc = useQueryClient();
  const [subject, setSubject] = useState(() => defaultProspectSubject(contact));
  const [body, setBody] = useState(contact.outreach_suggestions || "");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const threads = useQuery({
    queryKey: ["business-contact-emails", contact.id],
    queryFn: () => businessApi.listContactEmails(contact.id),
    enabled: Boolean(contact.id),
  });

  const prepare = useMutation({
    mutationFn: () =>
      businessApi.prepareContactEmail(contact.id, {
        subject: subject.trim(),
        body: body.trim(),
      }),
    onSuccess: (data) => {
      setError("");
      const steps = data.chain?.steps?.join(" · ") || "Brouillon prêt dans l'inbox";
      setMessage(steps);
      void qc.invalidateQueries({ queryKey: ["business-contact-emails", contact.id] });
    },
    onError: (e: Error) => {
      setMessage("");
      setError(
        e.message.includes("404")
          ? "API e-mail indisponible (404) — redémarrez le backend pour charger les nouvelles routes."
          : e.message,
      );
    },
  });

  const sync = useMutation({
    mutationFn: () => businessApi.syncContactEmails(contact.id),
    onSuccess: (data) => {
      setError("");
      setMessage(
        `Sync Gmail : ${data.imported ?? 0} réponse(s) importée(s), ${data.skipped ?? 0} déjà connue(s).`,
      );
      void qc.invalidateQueries({ queryKey: ["business-contact-emails", contact.id] });
      void qc.invalidateQueries({ queryKey: ["business-interactions", contact.id] });
    },
    onError: (e: Error) => {
      setMessage("");
      setError(
        e.message.includes("404")
          ? "API e-mail indisponible (404) — redémarrez le backend pour charger les nouvelles routes."
          : e.message,
      );
    },
  });

  const hasEmail = Boolean((contact.email || "").trim());
  const list = (threads.data || []) as ContactEmailThread[];

  return (
    <div className="space-y-5">
      {!hasEmail ? (
        <AlertBox tone="warn" title="E-mail manquant">
          Ajoutez une adresse sur la fiche pour préparer un envoi (validation inbox avant envoi réel).
        </AlertBox>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            prepare.mutate();
          }}
        >
          <p className="text-sm text-slate-600">
            Destinataire : <span className="font-medium text-slate-800">{contact.email}</span>
            {" — "}l&apos;envoi réel reste soumis à validation dans l&apos;inbox.
          </p>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Objet</span>
            <input
              className="input-field mt-1 w-full"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={defaultProspectSubject(contact)}
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Corps</span>
            <textarea
              className="input-field mt-1 min-h-[140px] w-full"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Message de prospection…"
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="btn-primary" disabled={prepare.isPending || !hasEmail}>
              {prepare.isPending ? "Préparation…" : "Préparer l'e-mail (inbox)"}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={sync.isPending || !hasEmail}
              onClick={() => sync.mutate()}
            >
              {sync.isPending ? "Sync…" : "Synchroniser réponses Gmail"}
            </button>
            <Link href="/inbox" className="btn-link-secondary text-sm">
              Ouvrir l&apos;inbox
            </Link>
          </div>
        </form>
      )}

      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-800">{message}</p> : null}

      <div>
        <h3 className="text-sm font-semibold text-slate-800">Fils e-mail</h3>
        {threads.isLoading ? <LoadingLine label="Chargement des fils…" /> : null}
        {!threads.isLoading && list.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Aucun envoi tracé pour ce contact.</p>
        ) : null}
        <ul className="mt-3 space-y-4">
          {list.map((thread) => (
            <li key={thread.id} className="rounded-lg border border-slate-200 bg-slate-50/80 p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium text-slate-900">{thread.subject || "(sans objet)"}</p>
                <span className="text-xs uppercase tracking-wide text-slate-500">
                  {thread.status === "replied"
                    ? "Répondu"
                    : thread.status === "closed"
                      ? "Clos"
                      : "En attente"}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                Dernier message : {formatDateTime(thread.last_message_at || thread.updated_at)}
              </p>
              <ul className="mt-3 space-y-2">
                {(thread.messages || []).map((m) => (
                  <li
                    key={m.id}
                    className={
                      m.direction === "inbound"
                        ? "border-l-2 border-teal-400 pl-3 text-sm"
                        : "border-l-2 border-emerald-200 pl-3 text-sm"
                    }
                  >
                    <p className="text-xs font-medium text-slate-600">
                      {m.direction === "inbound" ? "Réponse reçue" : "Envoyé"}
                      {" · "}
                      {formatDateTime(m.created_at)}
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap text-slate-800">
                      {(m.body || m.subject || "").slice(0, 600)}
                      {(m.body || "").length > 600 ? "…" : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
