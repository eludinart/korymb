"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { businessApi, type BizContact, type ContactEmailThread, type EmailAttachment } from "../../lib/business";
import { formatDateTime } from "../../app/gestion/_shared";
import { isolateDisplayedReply, unescapeEmailText } from "../../lib/emailDisplay";
import { AlertBox, LoadingLine } from "../ui/PageChrome";
import { EmailAttachmentList } from "./EmailAttachments";
import {
  MailFlag,
  SUGGEST_SKELETONS,
  bucketFlag,
  suggestCardClass,
  suggestTone,
} from "./mailFlags";

type ReplySuggestion = {
  id: string;
  label: string;
  angle: string;
  subject: string;
  body: string;
};

type Props = {
  contact: BizContact;
  focusThreadId?: string;
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

function replySubject(subject: string): string {
  const raw = (subject || "").trim() || "votre message";
  return /^re:\s*/i.test(raw) ? raw : `Re: ${raw}`;
}

function composerBodyFromSuggestion(raw: string): string {
  return isolateDisplayedReply(raw || "").reply || unescapeEmailText(raw || "");
}

const CRM_DELETE_HINT =
  "Ceci retire le suivi dans Korymb, pas Gmail. Une sync Gmail peut réimporter une réponse encore présente dans la boîte.";

const FILE_ACCEPT =
  ".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv,.md,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp";
const MAX_ATTACHMENTS = 5;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

export default function ContactEmailPanel({ contact, focusThreadId }: Props) {
  const qc = useQueryClient();
  const composerRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const focusedOnce = useRef("");
  const [subject, setSubject] = useState(() => defaultProspectSubject(contact));
  const [body, setBody] = useState(contact.outreach_suggestions || "");
  const [replyThreadId, setReplyThreadId] = useState("");
  const [replyInReplyTo, setReplyInReplyTo] = useState("");
  const [replyGmailThreadId, setReplyGmailThreadId] = useState("");
  const [replyMessageId, setReplyMessageId] = useState("");
  const [guidance, setGuidance] = useState("");
  const [useCurrentDraft, setUseCurrentDraft] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState<ReplySuggestion[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState("");
  const [suggestSource, setSuggestSource] = useState("");
  const [pendingFiles, setPendingFiles] = useState<EmailAttachment[]>([]);
  const [uploadBusy, setUploadBusy] = useState(false);

  const threads = useQuery({
    queryKey: ["business-contact-emails", contact.id],
    queryFn: () => businessApi.listContactEmails(contact.id),
    enabled: Boolean(contact.id),
  });

  const applyThreads = (next?: ContactEmailThread[]) => {
    if (next) {
      qc.setQueryData(["business-contact-emails", contact.id], next);
    } else {
      void qc.invalidateQueries({ queryKey: ["business-contact-emails", contact.id] });
    }
    void qc.invalidateQueries({ queryKey: ["business-mailbox"] });
  };

  const resetComposer = () => {
    setReplyThreadId("");
    setReplyInReplyTo("");
    setReplyGmailThreadId("");
    setReplyMessageId("");
    setGuidance("");
    setUseCurrentDraft(false);
    setSuggestions([]);
    setSelectedSuggestion("");
    setSuggestSource("");
    setPendingFiles([]);
    setSubject(defaultProspectSubject(contact));
    setBody(contact.outreach_suggestions || "");
  };

  const scrollToComposer = () => {
    composerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const send = useMutation({
    mutationFn: () =>
      businessApi.sendContactEmail(contact.id, {
        subject: subject.trim(),
        body: composerBodyFromSuggestion(body),
        thread_id: replyThreadId || undefined,
        in_reply_to: replyInReplyTo || undefined,
        gmail_thread_id: replyGmailThreadId || undefined,
        attachment_ids: pendingFiles.map((f) => f.id),
      }),
    onSuccess: (data) => {
      setError("");
      const steps = data.chain?.steps?.join(" · ") || "E-mail envoyé";
      setMessage(steps);
      setPendingFiles([]);
      setGuidance("");
      setSuggestions([]);
      setSelectedSuggestion("");
      setSuggestSource("");
      setBody("");
      applyThreads(data.threads);
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
        `Sync Gmail : ${data.imported ?? 0} nouvelle(s), ${data.updated ?? 0} mise(s) à jour, ${data.skipped ?? 0} déjà connue(s).`,
      );
      applyThreads(data.threads);
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

  const suggest = useMutation({
    mutationFn: (payload: {
      thread_id?: string;
      message_id?: string;
      guidance?: string;
      seed_body?: string;
      seed_subject?: string;
    }) => businessApi.suggestContactEmailReplies(contact.id, payload),
    onSuccess: (data) => {
      const items = (data.suggestions || []) as ReplySuggestion[];
      setSuggestions(items);
      setSuggestSource(String(data.source || ""));
      const first = items[0];
      if (first) {
        setSelectedSuggestion(first.id);
        setSubject(first.subject || subject);
        setBody(composerBodyFromSuggestion(first.body || ""));
      }
      setError("");
      setMessage("");
      scrollToComposer();
    },
    onError: (e: Error) => {
      setSuggestions([]);
      setSelectedSuggestion("");
      setMessage("");
      const raw = e.message || "";
      setError(
        raw.includes("Not Found") || raw.includes("404")
          ? "API suggestions indisponible (404) — le backend n'a pas encore chargé la nouvelle route. Redémarrez le backend (start-dev) puis réessayez."
          : raw || "Impossible de générer des suggestions.",
      );
    },
  });

  const removeMessage = useMutation({
    mutationFn: (messageId: string) => businessApi.deleteContactEmailMessage(contact.id, messageId),
    onSuccess: (data) => {
      setError("");
      setMessage(data.thread_deleted ? "Envoi retiré — le fil vide a été fermé." : "E-mail envoyé retiré du suivi.");
      applyThreads(data.threads);
    },
    onError: (e: Error) => {
      setMessage("");
      setError(e.message || "Suppression impossible.");
    },
  });

  const removeThread = useMutation({
    mutationFn: (threadId: string) => businessApi.deleteContactEmailThread(contact.id, threadId),
    onSuccess: (data, threadId) => {
      if (replyThreadId === threadId) resetComposer();
      setError("");
      setMessage("Fil retiré du suivi CRM.");
      applyThreads(data.threads);
    },
    onError: (e: Error) => {
      setMessage("");
      setError(e.message || "Suppression du fil impossible.");
    },
  });

  const hasEmail = Boolean((contact.email || "").trim());
  const listAll = (threads.data || []) as ContactEmailThread[];
  const list = focusThreadId ? listAll.filter((t) => t.id === focusThreadId) : listAll;
  const isReply = Boolean(replyThreadId);
  const busyDelete = removeMessage.isPending || removeThread.isPending;
  const suggestToneName = suggestions.find((s) => s.id === selectedSuggestion)?.label || "";

  useEffect(() => {
    if (!focusThreadId || focusedOnce.current === focusThreadId) return;
    const thread = listAll.find((t) => t.id === focusThreadId);
    if (!thread) return;
    focusedOnce.current = focusThreadId;
    const lastIn = [...(thread.messages || [])].reverse().find((m) => m.direction === "inbound");
    if (lastIn) {
      setSubject(replySubject(thread.subject || lastIn.subject || ""));
      setReplyThreadId(thread.id);
      setReplyInReplyTo(lastIn.message_id_header || "");
      setReplyGmailThreadId(thread.gmail_thread_id || "");
      setReplyMessageId(lastIn.id);
    }
  }, [focusThreadId, listAll]);

  return (
    <div className="space-y-6">
      {!hasEmail ? (
        <AlertBox tone="warn" title="E-mail manquant">
          Ajoutez une adresse sur la fiche pour rédiger et envoyer un e-mail.
        </AlertBox>
      ) : (
        <form
          ref={composerRef}
          className={`space-y-4 rounded-xl border p-4 shadow-sm ${
            suggest.isPending
              ? "border-2 border-violet-400 bg-violet-50/40"
              : isReply
                ? "border-2 border-teal-200 bg-white"
                : "border-slate-200 bg-white"
          }`}
          onSubmit={(e) => {
            e.preventDefault();
            if (!subject.trim() || !composerBodyFromSuggestion(body)) {
              setError("Objet et message sont requis pour envoyer.");
              return;
            }
            const dest = contact.email || "le destinataire";
            if (
              !window.confirm(
                `Envoyer maintenant à ${dest} ?\n\nObjet : ${subject.trim()}${
                  pendingFiles.length ? `\n${pendingFiles.length} pièce(s) jointe(s)` : ""
                }`,
              )
            ) {
              return;
            }
            send.mutate();
          }}
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                {isReply ? "Répondre dans le fil" : "Nouveau message"}
              </h3>
              <p className="mt-1 text-sm text-slate-600">
                À <span className="font-medium text-slate-800">{contact.email}</span>
                {" — "}vous pouvez orienter les pistes, puis envoyer depuis cet écran.
              </p>
            </div>
            {isReply ? (
              <button type="button" className="btn-link-secondary text-sm" onClick={resetComposer}>
                Nouveau message (sans réponse)
              </button>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2" aria-live="polite">
            <MailFlag tone={isReply ? "reply" : "new"}>{isReply ? "Réponse" : "Nouveau"}</MailFlag>
            {suggest.isPending ? (
              <MailFlag tone="gen" pulse>
                Génération des 3 pistes…
              </MailFlag>
            ) : null}
            {suggestions.length > 0 && !suggest.isPending ? (
              <MailFlag tone={suggestSource === "llm" ? "llm" : "fallback"}>
                {suggestSource === "llm" ? "3 pistes selon le fil" : "3 pistes de repli"}
              </MailFlag>
            ) : null}
            {selectedSuggestion && !suggest.isPending ? (
              <MailFlag tone={suggestTone(suggestToneName) === "other" ? "chosen" : suggestTone(suggestToneName)}>
                Dans l&apos;éditeur : {suggestToneName || "version choisie"}
              </MailFlag>
            ) : null}
            {send.isPending ? (
              <MailFlag tone="inbox" pulse>
                Envoi en cours…
              </MailFlag>
            ) : null}
          </div>

          {suggest.isPending ? (
            <div className="space-y-2 rounded-xl border-2 border-violet-200 bg-violet-50/80 p-3">
              <p className="text-sm font-semibold text-violet-950">Rédaction en cours</p>
              <p className="text-xs text-violet-800">
                Lecture du fil, puis 3 versions (chaleureux, concret, prudent). Ça peut prendre quelques secondes.
              </p>
              <ol className="mt-2 space-y-1 text-xs font-semibold text-violet-900">
                <li>1. Contexte du message reçu — fait</li>
                <li className="animate-pulse">2. Rédaction des 3 pistes…</li>
                <li className="text-violet-400">3. Choix dans l&apos;éditeur</li>
              </ol>
              <ul className="mt-3 space-y-2">
                {SUGGEST_SKELETONS.map((s) => (
                  <li key={s.id} className={`${suggestCardClass(s.label, false)} opacity-80`}>
                    <span className="flex items-center justify-between gap-2">
                      <MailFlag tone={s.label.toLowerCase() as "chaleureux" | "concret" | "prudent"}>{s.label}</MailFlag>
                      <span className="text-xs font-semibold text-violet-800 animate-pulse">Rédaction…</span>
                    </span>
                    <span className="mt-2 block h-16 rounded-lg bg-white/70 animate-pulse" />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {suggestions.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-slate-800">3 pistes générées</p>
              <p className="text-xs text-slate-500">
                Cliquez une carte pour l&apos;éditer ci-dessous, puis envoyez.
              </p>
              <ul className="space-y-3">
                {suggestions.map((s) => {
                  const active = selectedSuggestion === s.id;
                  const tone = suggestTone(s.label);
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        className={suggestCardClass(s.label, active)}
                        onClick={() => {
                          setSelectedSuggestion(s.id);
                          setSubject(s.subject);
                          setBody(composerBodyFromSuggestion(s.body));
                        }}
                      >
                        <span className="flex flex-wrap items-center justify-between gap-2">
                          <MailFlag tone={tone === "other" ? "draft" : tone}>{s.label}</MailFlag>
                          {active ? (
                            <MailFlag tone="chosen">Version utilisée</MailFlag>
                          ) : (
                            <span className="text-xs font-semibold text-slate-500">Utiliser cette version</span>
                          )}
                        </span>
                        {s.angle ? <span className="mt-1 block text-sm text-slate-600">{s.angle}</span> : null}
                        <span className="mt-3 block whitespace-pre-wrap text-sm leading-relaxed text-slate-900">
                          {composerBodyFromSuggestion(s.body)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          <label className="block text-sm">
            <span className="font-medium text-slate-700">Ce que vous voulez dire</span>
            <textarea
              className="input-field mt-1 min-h-[88px] w-full"
              value={guidance}
              onChange={(e) => setGuidance(e.target.value)}
              placeholder={
                isReply
                  ? "Ex. : proposer un appel mardi matin, remercier pour l’atelier, ne pas parler de tarif."
                  : "Ex. : se présenter via Fleur d’ÅmÔurs, proposer un module autour du corps, rester court."
              }
            />
            <span className="mt-1 block text-xs text-slate-500">
              {isReply
                ? "Les pistes tiennent compte du fil précédent et du profil du contact."
                : "Les pistes s’appuient sur la fiche du prospect (notes, tags, angle déjà noté)."}
            </span>
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="rounded border-slate-300"
                checked={useCurrentDraft}
                onChange={(e) => setUseCurrentDraft(e.target.checked)}
              />
              S&apos;inspirer du texte déjà écrit
            </label>
            <button
              type="button"
              className="btn-secondary"
              disabled={suggest.isPending || !hasEmail}
              onClick={() => {
                setError("");
                setMessage("");
                const threadId = replyThreadId || focusThreadId || "";
                const thread = listAll.find((t) => t.id === threadId);
                let messageId = replyMessageId || "";
                if (threadId && !messageId) {
                  const lastIn = [...(thread?.messages || [])]
                    .reverse()
                    .find((item) => item.direction === "inbound");
                  messageId = lastIn?.id || "";
                }
                const draft = composerBodyFromSuggestion(body);
                const outreach = (contact.outreach_suggestions || "").trim();
                const useSeed = useCurrentDraft && Boolean(draft) && !(isReply && draft === outreach);
                suggest.mutate({
                  thread_id: threadId || undefined,
                  message_id: messageId || undefined,
                  guidance: guidance.trim() || undefined,
                  seed_body: useSeed ? draft : undefined,
                  seed_subject: subject.trim() || undefined,
                });
              }}
            >
              {suggest.isPending ? "Génération…" : "Générer 3 pistes"}
            </button>
          </div>

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
            <span className="font-medium text-slate-700">
              {isReply ? "Votre réponse (modifiable)" : "Corps"}
            </span>
            <textarea
              className="input-field mt-1 min-h-[180px] w-full"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Message de prospection…"
            />
          </label>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept={FILE_ACCEPT}
                multiple
                onChange={async (e) => {
                  const picked = Array.from(e.target.files || []);
                  e.target.value = "";
                  if (!picked.length) return;
                  setError("");
                  const room = MAX_ATTACHMENTS - pendingFiles.length;
                  if (room <= 0) {
                    setError(`Maximum ${MAX_ATTACHMENTS} pièces jointes.`);
                    return;
                  }
                  const next = picked.slice(0, room);
                  setUploadBusy(true);
                  try {
                    const uploaded: EmailAttachment[] = [];
                    for (const file of next) {
                      if (file.size > MAX_FILE_BYTES) {
                        throw new Error(`${file.name} dépasse 8 Mo.`);
                      }
                      uploaded.push(await businessApi.uploadEmailFile(file));
                    }
                    setPendingFiles((prev) => [...prev, ...uploaded]);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Upload impossible");
                  } finally {
                    setUploadBusy(false);
                  }
                }}
              />
              <button
                type="button"
                className="btn-secondary"
                disabled={uploadBusy || pendingFiles.length >= MAX_ATTACHMENTS}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploadBusy ? "Ajout…" : "Joindre un document"}
              </button>
              <span className="text-xs text-slate-500">PDF, images, Office, texte — 8 Mo max, {MAX_ATTACHMENTS} fichiers</span>
            </div>
            <EmailAttachmentList
              attachments={pendingFiles}
              onRemove={(id) => setPendingFiles((prev) => prev.filter((f) => f.id !== id))}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="btn-primary" disabled={send.isPending || suggest.isPending || !hasEmail}>
              {send.isPending ? "Envoi…" : isReply ? "Envoyer la réponse" : "Envoyer l'e-mail"}
            </button>
            {send.isSuccess && !send.isPending ? <MailFlag tone="ready">Envoyé</MailFlag> : null}
          </div>
        </form>
      )}

      {error ? (
        <AlertBox tone="error" title="Action impossible">
          {error}
        </AlertBox>
      ) : null}
      {message ? (
        <AlertBox tone="success" title="OK">
          {message}
        </AlertBox>
      ) : null}

      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Fils e-mail</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Suivi Korymb uniquement. Retirer un envoi ne l&apos;efface pas dans Gmail.
            </p>
          </div>
          {hasEmail ? (
            <button
              type="button"
              className="btn-secondary"
              disabled={sync.isPending}
              onClick={() => sync.mutate()}
            >
              {sync.isPending ? "Sync…" : "Synchroniser Gmail"}
            </button>
          ) : null}
        </div>
        {threads.isLoading ? <LoadingLine label="Chargement des fils…" /> : null}
        {!threads.isLoading && list.length === 0 ? (
          <p className="text-sm text-slate-500">Aucun envoi tracé pour ce contact.</p>
        ) : null}
        <ul className="space-y-4">
          {list.map((thread) => {
            const msgs = thread.messages || [];
            const last = msgs[msgs.length - 1];
            const bucket =
              thread.status === "closed"
                ? "closed"
                : last?.direction === "inbound"
                  ? "needs_reply"
                  : "awaiting";
            const flag = bucketFlag(bucket);
            return (
              <li
                key={thread.id}
                className={`rounded-xl border border-slate-200 bg-slate-50/80 p-4 ${
                  bucket === "needs_reply"
                    ? "border-l-4 border-l-teal-500"
                    : bucket === "closed"
                      ? "border-l-4 border-l-slate-400"
                      : "border-l-4 border-l-amber-400"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">{thread.subject || "(sans objet)"}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Dernier message : {formatDateTime(thread.last_message_at || thread.updated_at)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <MailFlag tone={flag.tone}>{flag.label}</MailFlag>
                    <button
                      type="button"
                      className="btn-danger"
                      disabled={busyDelete}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Retirer ce fil du suivi ?\n\n${thread.subject || "(sans objet)"}\n\n${CRM_DELETE_HINT}`,
                          )
                        ) {
                          removeThread.mutate(thread.id);
                        }
                      }}
                    >
                      {removeThread.isPending && removeThread.variables === thread.id
                        ? "Retrait…"
                        : "Retirer le fil"}
                    </button>
                  </div>
                </div>
                <ul className="mt-4 space-y-3">
                  {(thread.messages || []).map((m) => {
                    const isIn = m.direction === "inbound";
                    const split = isolateDisplayedReply(m.body || m.reply_text || "");
                    const replyText = split.reply;
                    const quoted = split.quoted || (m.quoted_text ? unescapeEmailText(m.quoted_text) : "");
                    const outboundText = composerBodyFromSuggestion(m.body || m.subject || "");
                    return (
                      <li
                        key={m.id}
                        className={
                          isIn
                            ? "rounded-xl border-2 border-teal-300 bg-teal-50 p-3 text-sm"
                            : "rounded-xl border border-slate-200 bg-white p-3 text-sm"
                        }
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <MailFlag tone={isIn ? "reply" : "ready"}>{isIn ? "Reçu" : "Envoyé"}</MailFlag>
                            {(m.attachments || []).length ? (
                              <MailFlag tone="draft">{(m.attachments || []).length} PJ</MailFlag>
                            ) : null}
                            <p className="text-xs text-slate-500">
                              {isIn && m.from_email ? `${m.from_email} · ` : ""}
                              {formatDateTime(m.created_at)}
                            </p>
                          </div>
                          {!isIn ? (
                            <button
                              type="button"
                              className="touch-target inline-flex items-center rounded-lg px-2 text-sm font-semibold text-red-800 hover:bg-red-50 disabled:opacity-50"
                              disabled={busyDelete}
                              onClick={() => {
                                if (window.confirm(`Retirer cet e-mail envoyé du suivi ?\n\n${CRM_DELETE_HINT}`)) {
                                  removeMessage.mutate(m.id);
                                }
                              }}
                            >
                              {removeMessage.isPending && removeMessage.variables === m.id
                                ? "Retrait…"
                                : "Retirer l'envoi"}
                            </button>
                          ) : null}
                        </div>
                        <p
                          className={`mt-2 whitespace-pre-wrap ${isIn ? "text-base font-medium text-slate-950" : "text-slate-800"}`}
                        >
                          {(isIn ? replyText : outboundText) || "(sans texte)"}
                        </p>
                        <EmailAttachmentList attachments={m.attachments || []} messageId={m.id} />
                        {isIn && quoted ? (
                          <details className="mt-2 text-xs text-slate-600">
                            <summary className="cursor-pointer select-none text-slate-500 hover:text-slate-700">
                              Message cité
                            </summary>
                            <p className="mt-1 whitespace-pre-wrap text-slate-500">{quoted}</p>
                          </details>
                        ) : null}
                        {isIn ? (
                          <button
                            type="button"
                            className="btn-secondary mt-3"
                            disabled={suggest.isPending}
                            onClick={() => {
                              setSubject(replySubject(thread.subject || m.subject || ""));
                              setReplyThreadId(thread.id);
                              setReplyInReplyTo(m.message_id_header || "");
                              setReplyGmailThreadId(thread.gmail_thread_id || "");
                              setReplyMessageId(m.id);
                              setBody("");
                              setUseCurrentDraft(false);
                              setSuggestions([]);
                              setSelectedSuggestion("");
                              setError("");
                              setMessage("");
                              scrollToComposer();
                            }}
                          >
                            Répondre
                          </button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
