"use client";

import { ChangeEvent, FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import AgentMessageMarkdown from "../AgentMessageMarkdown";
import ChoiceQuestionnaire from "../ChoiceQuestionnaire";
import ChatAgentMacaron from "./ChatAgentMacaron";
import ChatMessageDeliverables from "./ChatMessageDeliverables";
import ChatSourceNote from "./ChatSourceNote";
import ChatMessageFiles from "./ChatMessageFiles";
import TeamBlueprintCard from "./TeamBlueprintCard";
import { extractJobIdFromMessageId, fetchJobAgentKeys } from "../../lib/chatJobAgents";
import { chatTextIsDegraded } from "../../lib/chatDegraded";
import { chatBubbleDisplayText } from "../../lib/chatMirrorDisplay";
import {
  formatChoiceAnswersAsMessage,
  parseChoiceQuestionnaireFromText,
  stripChoiceQuestionnaireFences,
} from "../../lib/choiceQuestionnaire";
import { resourceFileUrl } from "../../lib/business";
import { chatReplyExcerpt, type ChatReplyTarget } from "../../lib/chatReply";
import type { DriveArtifact } from "../../lib/types";
import {
  CHAT_ACCEPT_CAMERA,
  CHAT_ACCEPT_MEDIA,
  CHAT_FILE_ACCEPT,
  CHAT_FILE_MAX,
  chatFileKind,
  filesFromClipboard,
  filesFromDataTransfer,
  formatChatFileSize,
  type ChatFile,
} from "../../lib/chatAttachments";

export type { ChatFile };

export type ChatMsg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Agents mobilisés pour cette réponse (CIO ou sous-agents). */
  agentKeys?: string[];
  /** Job chat associé (`a-{jobId}`). */
  jobId?: string;
  driveArtifacts?: DriveArtifact[];
  deliverablesMarkdown?: string;
  attachments?: ChatFile[];
  pendingBlueprintId?: string;
  /** Résultat UI après confirm/reject (persiste dans le fil). */
  blueprintOutcome?: { status: "created" | "rejected"; label?: string };
  /** Réponse locale : le modèle (crédit, quota ou délai) n'a pas répondu. */
  degraded?: boolean;
  /** Contrôle des précisions (e-mail, montant, lien) contre les données du tour. */
  claimGuard?: { status?: string; intent?: string; dropped_count?: number };
  /** Action proposée, en attente de confirmation. */
  pendingAction?: { message: string; attachments?: ChatFile[]; label?: string };
  /** QCM déjà répondu (résumé affiché à la place du formulaire). */
  choiceAnsweredSummary?: string;
  /** Message du fil auquel celui-ci répond (citation affichée, contexte envoyé à l'agent). */
  replyTo?: ChatReplyTarget;
};

export type { ChatReplyTarget };

function claimGuardLabel(guard: ChatMsg["claimGuard"]): { label: string; title: string; className: string } | null {
  const status = String(guard?.status || "");
  if (status === "partial") {
    return {
      label: "Partiel",
      title: "Des précisions absentes des données de ce tour ont été retirées.",
      className: "bg-amber-100 text-amber-950 dark:bg-amber-900/40 dark:text-amber-100",
    };
  }
  if (status === "unknown") {
    return {
      label: "Donnée absente",
      title: "La réponse ne s'appuyait pas sur une donnée vérifiée.",
      className: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100",
    };
  }
  if (status === "anchored" && (guard?.intent === "crm" || guard?.intent === "status" || guard?.intent === "platform")) {
    return {
      label: "Ancré",
      title: "Les e-mails, montants, liens et dates de cette réponse figurent dans les données du tour.",
      className: "bg-emerald-100 text-emerald-950 dark:bg-emerald-900/40 dark:text-emerald-100",
    };
  }
  return null;
}

type Props = {
  messages: ChatMsg[];
  draft: string;
  onDraftChange: (v: string) => void;
  onSend: (replyTo?: ChatReplyTarget | null) => void;
  pending: boolean;
  backgroundJobCount?: number;
  /** Progression réelle agrégée des jobs en arrière-plan (0–100). */
  backgroundProgress?: { percent: number; label: string; status?: string } | null;
  className?: string;
  agentLabels?: Record<string, string>;
  onPatchMessage?: (id: string, patch: Partial<ChatMsg>) => void;
  onConvertToMission?: () => void;
  convertBusy?: boolean;
  canConvertToMission?: boolean;
  convertBrief?: string | null;
  onConvertBriefChange?: (v: string) => void;
  onConfirmConvert?: () => void;
  onCancelConvert?: () => void;
  attachments?: ChatFile[];
  onAddFiles?: (files: File[]) => void;
  onRemoveFile?: (id: string) => void;
  uploadBusy?: boolean;
  uploadError?: string;
  onTeamCreated?: (groupId: string) => void;
  onConfirmAction?: (message: string, attachments?: ChatFile[]) => void;
  /** Envoie tout de suite le texte d'une pastille. */
  onQuickSend?: (text: string) => void;
  /** Propose de transmettre la demande à l'équipe. */
  teamOffer?: boolean;
  onHandOffToTeam?: () => void;
  onDismissTeamOffer?: () => void;
  onDismissAction?: (messageId: string) => void;
  onStopReply?: () => void;
  /** Envoie une réponse QCM comme message utilisateur. */
  onSubmitChoiceAnswers?: (messageId: string, text: string) => void;
  /** Mode quotidien : chrome ops réduit + chips de reformulation. */
  chatUseMode?: "quotidien" | "operationnel";
  reformChips?: ReadonlyArray<{ label: string; text: string }>;
};

function messagePromisesMissingTeamButton(text: string): boolean {
  const mentionsButton = /bouton|clique|valide|interface/i.test(text);
  const mentionsCreate = /cr[eé]er\s+l\W{0,3}équipe/i.test(text);
  return mentionsButton && mentionsCreate;
}

function displayAgentKeys(msg: ChatMsg): string[] {
  if (msg.agentKeys?.length) return msg.agentKeys;
  if (msg.id.startsWith("ack-")) return ["coordinateur"];
  return [];
}

function splitLead(text: string, maxLines = 5): { lead: string; rest: string } {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return { lead: text, rest: "" };
  return { lead: lines.slice(0, maxLines).join("\n"), rest: lines.slice(maxLines).join("\n") };
}

function focusQuotedMessage(id: string) {
  const el = document.getElementById(`chat-msg-${id}`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function copyPlainText(text: string): Promise<boolean> {
  const value = text.trim();
  if (!value) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = value;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.left = "-9999px";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function ChatQuoteChip({
  reply,
  onSurface,
}: {
  reply: ChatReplyTarget;
  /** Bulle utilisateur violette : le contraste s'inverse. */
  onSurface: "user" | "assistant";
}) {
  const who = reply.role === "assistant" ? "Agent" : "Vous";
  return (
    <button
      type="button"
      onClick={() => focusQuotedMessage(reply.id)}
      className={
        onSurface === "user"
          ? "mb-1.5 block w-full rounded-md border-l-2 border-white/80 bg-white/15 px-2 py-1 text-left"
          : "mb-1.5 block w-full rounded-md border-l-2 border-violet-500 bg-white/80 px-2 py-1 text-left dark:bg-slate-900/50"
      }
    >
      <span
        className={
          onSurface === "user"
            ? "block text-[10px] font-semibold uppercase tracking-wide text-white/80"
            : "block text-[10px] font-semibold uppercase tracking-wide text-violet-800 dark:text-violet-300"
        }
      >
        {who}
      </span>
      <span
        className={
          onSurface === "user"
            ? "line-clamp-2 text-[12px] leading-snug text-white/95"
            : "line-clamp-2 text-[12px] leading-snug text-slate-600 dark:text-slate-300"
        }
      >
        {reply.excerpt}
      </span>
    </button>
  );
}

function ChatReplyPending({
  count,
  percent,
  label,
  onStop,
}: {
  count: number;
  percent?: number | null;
  label?: string;
  onStop?: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const id = window.setInterval(() => {
      setElapsed(Math.max(0, Math.floor((Date.now() - started) / 1000)));
    }, 250);
    return () => window.clearInterval(id);
  }, []);

  const known = typeof percent === "number" && percent > 0;
  const dots = ".".repeat((Math.floor(elapsed * 2) % 3) + 1);
  const statusLabel = label || (count > 1 ? `${count} réponses en cours` : "Je prépare");

  return (
    <div
      className="overflow-hidden rounded-xl border border-violet-100 bg-violet-50"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex min-h-8 items-center gap-2.5 px-3 py-2 text-xs font-medium text-violet-900">
        <span className="flex items-center gap-0.5" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="chat-typing-dot h-1.5 w-1.5 rounded-full bg-violet-600"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </span>
        <span className="min-w-0 truncate">
          {statusLabel}
          <span className="inline-block w-4 text-left tracking-tight">{dots}</span>
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {onStop ? (
            <button
              type="button"
              onClick={onStop}
              className="rounded-full border border-red-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-50"
            >
              Arrêter
            </button>
          ) : null}
          <span className="tabular-nums text-[11px] text-violet-700">
            {known ? `${Math.round(percent)}%` : elapsed >= 1 ? `${elapsed} s` : ""}
          </span>
        </span>
      </div>
      <div className="relative h-0.5 w-full overflow-hidden bg-violet-100" aria-hidden>
        {known ? (
          <div
            className="h-full bg-violet-600 transition-[width] duration-500"
            style={{ width: `${Math.max(0, Math.min(100, percent || 0))}%` }}
          />
        ) : (
          <span className="busy-indeterminate absolute inset-y-0 w-1/3 bg-violet-600" />
        )}
      </div>
    </div>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
      <path d="M3.4 20.4 21 12 3.4 3.6v6.7L15 12 3.4 13.7z" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path strokeLinecap="round" d="M5 15V5h10" />
    </svg>
  );
}

function ReplyIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 14 4 9l5-5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 9h8a8 8 0 0 1 8 8v2" />
    </svg>
  );
}

export default function ChatShell({
  messages,
  draft,
  onDraftChange,
  onSend,
  pending,
  backgroundJobCount = 0,
  backgroundProgress = null,
  className = "",
  agentLabels = {},
  onPatchMessage,
  onConvertToMission,
  convertBusy = false,
  canConvertToMission = false,
  convertBrief = null,
  onConvertBriefChange,
  onConfirmConvert,
  onCancelConvert,
  attachments = [],
  onAddFiles,
  onRemoveFile,
  uploadBusy = false,
  uploadError = "",
  onTeamCreated,
  onConfirmAction,
  onDismissAction,
  onStopReply,
  onSubmitChoiceAnswers,
  onQuickSend,
  teamOffer = false,
  onHandOffToTeam,
  onDismissTeamOffer,
  chatUseMode = "operationnel",
  reformChips = [],
}: Props) {
  const isQuotidien = chatUseMode === "quotidien";
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrolledAssistantIdRef = useRef<string>("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const hydratingRef = useRef<Set<string>>(new Set());
  const userMinHeightRef = useRef(0);
  const [localAgents, setLocalAgents] = useState<Record<string, string[]>>({});
  const [expandedReply, setExpandedReply] = useState<Record<string, boolean>>({});
  const [dragging, setDragging] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [portalReady, setPortalReady] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ChatReplyTarget | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const userTurns = messages.filter((m) => m.role === "user").length;
  const isFirstTurn = userTurns === 0 && !pending && backgroundJobCount === 0;
  const hasAssistantReply = messages.some(
    (m) => m.role === "assistant" && Boolean(m.content.trim()) && !m.pendingAction,
  );
  const stickyHitl = [...messages].reverse().find((m) => m.role === "assistant" && m.pendingAction);
  const showPendingBar = pending || backgroundJobCount > 0;

  useEffect(() => {
    // Pendant l'attente : garder la barre de progression visible.
    if (pending || backgroundJobCount > 0) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      return;
    }
    // Réponse prête : positionner au début de la dernière réponse assistant (pas à la fin).
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    if (!lastAssistant) return;
    if (scrolledAssistantIdRef.current === lastAssistant.id) return;
    scrolledAssistantIdRef.current = lastAssistant.id;
    const el = document.getElementById(`chat-msg-${lastAssistant.id}`);
    requestAnimationFrame(() => {
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [messages, pending, backgroundJobCount]);

  useEffect(() => setPortalReady(true), []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    // Ne pas toucher la hauteur pendant la frappe ou la dictée : height=0 casse Gboard.
    if (document.activeElement === el && draft.trim()) return;
    const minH = Math.max(40, userMinHeightRef.current);
    const desktop = window.matchMedia("(min-width: 1024px)").matches;
    const keyboard = document.documentElement.dataset.keyboardOpen === "1";
    const maxH = desktop ? 280 : keyboard ? 72 : 120;
    el.style.height = "0px";
    const needed = Math.max(el.scrollHeight, 40);
    const next = Math.min(Math.max(needed, minH), maxH);
    el.style.height = `${next}px`;
    el.style.overflowY = needed > maxH || next >= maxH ? "auto" : "hidden";
    if (!draft.trim()) userMinHeightRef.current = 0;
  }, [draft]);

  useEffect(() => {
    for (const m of messages) {
      if (m.role !== "assistant" || m.agentKeys?.length) continue;
      const jobId = extractJobIdFromMessageId(m.id);
      if (!jobId || hydratingRef.current.has(m.id) || localAgents[m.id]) continue;
      hydratingRef.current.add(m.id);
      void fetchJobAgentKeys(jobId)
        .then((keys) => {
          const delegated = keys.filter((k) => k !== "coordinateur");
          const resolved = delegated.length
            ? delegated
            : m.id.startsWith("ack-")
              ? ["coordinateur"]
              : keys.includes("coordinateur")
                ? ["coordinateur"]
                : delegated;
          if (!resolved.length) return;
          setLocalAgents((prev) => ({ ...prev, [m.id]: resolved }));
          onPatchMessage?.(m.id, { agentKeys: resolved });
        })
        .catch(() => {
          /* ignore */
        })
        .finally(() => {
          hydratingRef.current.delete(m.id);
        });
    }
  }, [messages, localAgents, onPatchMessage]);

  useEffect(() => {
    if (!replyingTo) return;
    if (!messages.some((m) => m.id === replyingTo.id)) setReplyingTo(null);
  }, [messages, replyingTo]);

  const dispatchSend = () => {
    if (uploadBusy || pending) return;
    if (!draft.trim() && attachments.length === 0) return;
    const reply = replyingTo;
    setReplyingTo(null);
    onSend(reply);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape" && replyingTo) {
      e.preventDefault();
      setReplyingTo(null);
      return;
    }
    // Entrée passe à la ligne. Ctrl ou Cmd + Entrée envoie.
    if (e.key !== "Enter" || e.shiftKey || !(e.ctrlKey || e.metaKey)) return;
    if (uploadBusy) return;
    if (!draft.trim() && attachments.length === 0) return;
    e.preventDefault();
    dispatchSend();
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    dispatchSend();
  };

  const beginReply = (target: ChatReplyTarget) => {
    setReplyingTo(target);
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const copyMessage = (id: string, text: string) => {
    void copyPlainText(text).then((ok) => {
      if (!ok) return;
      setCopiedId(id);
      window.setTimeout(() => {
        setCopiedId((current) => (current === id ? null : current));
      }, 1600);
    });
  };

  const takeFiles = (list: File[]) => {
    if (!list.length || !onAddFiles) return;
    onAddFiles(list.slice(0, CHAT_FILE_MAX));
  };

  const onPickFromInput = (e: ChangeEvent<HTMLInputElement>) => {
    takeFiles(Array.from(e.target.files || []));
    e.target.value = "";
    setAttachOpen(false);
  };

  const openAttachMenu = () => {
    const mobile =
      typeof window !== "undefined" &&
      (window.matchMedia("(pointer: coarse)").matches || window.matchMedia("(max-width: 1023px)").matches);
    if (mobile) {
      setAttachOpen(true);
      return;
    }
    fileInputRef.current?.click();
  };

  const pickInputClass =
    "pointer-events-none absolute left-0 top-0 h-px w-px overflow-hidden opacity-0";

  return (
    <div className={`chat-root relative mx-auto flex min-h-0 w-full flex-col ${className || "h-full"}`}>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-2 py-2 sm:px-4 sm:py-4">
        <div className="mx-auto max-w-3xl space-y-3 sm:space-y-5">
          {isFirstTurn ? (
            <div className="px-2 pt-6 text-center sm:pt-10">
              <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50 sm:text-3xl">
                {isQuotidien ? "Comment puis-je vous aider ?" : "Qu'est-ce qui vous préoccupe ?"}
              </h1>
              <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400 sm:mt-3 sm:text-base">
                {isQuotidien
                  ? "Posez une question, demandez un brouillon, ou collez un texte à retravailler."
                  : "Dites ce que vous voulez obtenir. Je réponds par la décision, le prochain pas, et ce qui manque."}
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {(isQuotidien
                  ? [
                      {
                        label: "Résumer",
                        text: "Résume clairement le texte ou le contexte que je vais coller.",
                      },
                      {
                        label: "Brouillon e-mail",
                        text: "Prépare un e-mail court et poli, prêt à copier.",
                      },
                      {
                        label: "Idées",
                        text: "Donne-moi 5 idées concrètes et actionnables.",
                      },
                    ]
                  : [
                      {
                        label: "Préparer un message client",
                        text: "Prépare un message clair pour un client, prêt à copier.",
                      },
                      {
                        label: "Résumer cette pièce jointe",
                        text: "Résume cette pièce jointe : la décision, le prochain pas, ce qui manque.",
                      },
                      {
                        label: "Décider et me dire quoi faire",
                        text: "Décide avec moi et dis-moi quoi faire ensuite.",
                      },
                    ]
                ).map((chip) => (
                  <button
                    key={chip.label}
                    type="button"
                    disabled={pending || uploadBusy}
                    onClick={() => {
                      if (onQuickSend) {
                        onQuickSend(chip.text);
                        return;
                      }
                      onDraftChange(chip.text);
                      window.setTimeout(() => textareaRef.current?.focus(), 0);
                    }}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:border-violet-300 hover:text-violet-800 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-violet-500"
                  >
                    {chip.label}
                  </button>
                ))}              </div>
            </div>
          ) : null}

          {messages.map((m, index) => {
            const isLast = index === messages.length - 1;
            const agents = localAgents[m.id] || displayAgentKeys(m);
            const degraded = Boolean(m.degraded) || chatTextIsDegraded(m.content);
            const claim = claimGuardLabel(m.claimGuard);
            const qcm =
              m.role === "assistant" && !m.choiceAnsweredSummary
                ? parseChoiceQuestionnaireFromText(m.content)
                : null;
            const displaySource =
              m.role === "assistant"
                ? stripChoiceQuestionnaireFences(chatBubbleDisplayText(m.id, m.content))
                : m.content;
            const folded = m.role === "assistant" ? splitLead(displaySource) : { lead: displaySource, rest: "" };
            const replyOpen = Boolean(expandedReply[m.id]);
            const shownSource = replyOpen || !folded.rest.trim() ? displaySource : folded.lead;
            const copySource =
              (m.role === "assistant" ? displaySource : m.content).trim() ||
              (m.attachments?.map((file) => file.filename).join(", ") || "");
            const quotable = chatReplyExcerpt(copySource);
            const actionLabel = m.pendingAction?.label || "Confirmer";
            const quoted = replyingTo?.id === m.id;
            return (
              <div
                key={m.id}
                id={`chat-msg-${m.id}`}
                className={`flex scroll-mt-12 lg:scroll-mt-4 ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={
                    m.role === "user"
                      ? "max-w-[min(100%,28rem)] w-auto sm:max-w-[85%]"
                      : "w-full max-w-none sm:max-w-[92%]"
                  }
                >
                  <div
                    className={`chat-bubble-text overflow-hidden leading-snug sm:leading-relaxed ${
                      m.role === "user"
                        ? "chat-bubble-user rounded-[1.15rem] rounded-br-md px-3.5 py-2 sm:rounded-3xl sm:px-5 sm:py-3"
                        : "chat-bubble-assistant rounded-[1.15rem] rounded-bl-md px-3.5 py-2.5 sm:px-5 sm:py-3"
                    }${quoted ? " ring-2 ring-violet-400 ring-offset-2 ring-offset-white dark:ring-offset-slate-950" : ""}`}
                    style={{ fontSize: "var(--chat-text-size, 1rem)" }}
                  >
                    {m.role === "user" ? (
                      <>
                        {m.replyTo ? <ChatQuoteChip reply={m.replyTo} onSurface="user" /> : null}
                        {m.content.trim() ? <span className="whitespace-pre-wrap">{m.content}</span> : null}
                        <ChatMessageFiles files={m.attachments} />
                      </>
                    ) : (
                      <>
                        {degraded ? (
                          <p className="mb-2 inline-flex items-center rounded-full bg-amber-200/80 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-950">
                            Mode dégradé
                          </p>
                        ) : null}
                        {claim ? (
                          <p
                            className={`mb-2 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${claim.className}`}
                            title={claim.title}
                          >
                            {claim.label}
                          </p>
                        ) : null}
                        {m.replyTo ? <ChatQuoteChip reply={m.replyTo} onSurface="assistant" /> : null}
                        {shownSource.trim() ? <AgentMessageMarkdown source={shownSource} /> : null}
                        {folded.rest.trim() ? (
                          <button
                            type="button"
                            onClick={() => setExpandedReply((prev) => ({ ...prev, [m.id]: !replyOpen }))}
                            className="mt-2 text-xs font-semibold text-violet-800 hover:underline dark:text-violet-300"
                          >
                            {replyOpen ? "Replier le détail" : "Voir le détail"}
                          </button>
                        ) : null}
                      </>
                    )}
                  </div>
                  {quotable ? (
                    <div className={`mt-1 flex gap-0.5 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                      <button
                        type="button"
                        onClick={() => copyMessage(m.id, copySource)}
                        className="inline-flex min-h-8 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                        aria-label={copiedId === m.id ? "Copié" : "Copier le message"}
                      >
                        <CopyIcon />
                        {copiedId === m.id ? "Copié" : "Copier"}
                      </button>
                      <button
                        type="button"
                        onClick={() => beginReply({ id: m.id, role: m.role, excerpt: quotable })}
                        className="inline-flex min-h-8 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                        aria-label="Répondre à ce message"
                      >
                        <ReplyIcon />
                        Répondre
                      </button>
                    </div>
                  ) : null}
                  {m.role === "assistant" && agents.length > 0 ? (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                        Qui a répondu
                      </summary>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {agents.map((key) => (
                          <ChatAgentMacaron key={key} agentKey={key} label={agentLabels[key]} />
                        ))}
                      </div>
                    </details>
                  ) : null}
                  {m.role === "assistant" && (qcm || m.choiceAnsweredSummary) ? (
                    <div className="mt-2">
                      <ChoiceQuestionnaire
                        payload={
                          qcm || {
                            questions: [],
                            submitLabel: "Valider et envoyer",
                          }
                        }
                        answeredSummary={m.choiceAnsweredSummary || null}
                        busy={pending}
                        disabled={pending || Boolean(m.choiceAnsweredSummary)}
                        onSubmit={async (answers) => {
                          if (!qcm || !onSubmitChoiceAnswers) return;
                          const text = formatChoiceAnswersAsMessage(qcm, answers);
                          onSubmitChoiceAnswers(m.id, text);
                        }}
                      />
                    </div>
                  ) : null}
                  {m.role === "assistant" ? <ChatMessageDeliverables message={m} /> : null}
                  {m.role === "assistant" && (m.jobId || extractJobIdFromMessageId(m.id)) ? (
                    <ChatSourceNote jobId={m.jobId || extractJobIdFromMessageId(m.id) || ""} />
                  ) : null}
                  {m.role === "assistant" && m.pendingAction ? (
                    <div className="mt-2 hidden flex-wrap items-center gap-2 lg:flex">
                      {m.pendingAction.attachments?.length ? (
                        <span className="max-w-full truncate text-[11px] text-slate-500">
                          {m.pendingAction.attachments.map((f) => f.filename).join(", ")}
                        </span>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => onConfirmAction?.(m.pendingAction?.message || "", m.pendingAction?.attachments)}
                        className="rounded-full bg-violet-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-800"
                      >
                        {actionLabel}
                      </button>
                      <button
                        type="button"
                        onClick={() => onDismissAction?.(m.id)}
                        className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Annuler
                      </button>
                    </div>
                  ) : null}
                  {m.role === "assistant" && (m.pendingBlueprintId || m.blueprintOutcome) ? (
                    <TeamBlueprintCard
                      blueprintId={m.pendingBlueprintId || "resolved"}
                      initialOutcome={m.blueprintOutcome || null}
                      onCreated={(gid) => onTeamCreated?.(gid)}
                      onSettled={(outcome) =>
                        onPatchMessage?.(m.id, {
                          pendingBlueprintId: undefined,
                          blueprintOutcome: outcome,
                        })
                      }
                    />
                  ) : null}
                  {isLast &&
                  m.role === "assistant" &&
                  !m.pendingBlueprintId &&
                  !m.blueprintOutcome &&
                  messagePromisesMissingTeamButton(m.content) ? (
                    <div className="mt-3 rounded-2xl border-2 border-violet-200 bg-violet-50 px-4 py-3">
                      <p className="text-sm font-semibold text-violet-950">Créer l’équipe proposée ?</p>
                      <p className="mt-1 text-sm text-violet-800">
                        La proposition n’a pas encore été enregistrée. Ce bouton la prépare, puis tu la valides.
                      </p>
                      <button
                        type="button"
                        disabled={pending || !onQuickSend}
                        onClick={() => onQuickSend?.("crée l'équipe")}
                        className="mt-3 rounded-xl bg-violet-700 px-4 py-2 text-sm font-bold text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Créer l’équipe
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}

          {/* Desktop : pending dans le fil ; mobile = barre sticky sous le scroll */}
          {showPendingBar ? (
            <div className="hidden lg:block">
              <ChatReplyPending
                count={Math.max(1, backgroundJobCount)}
                percent={backgroundProgress?.percent}
                label={backgroundProgress?.label}
                onStop={onStopReply}
              />
            </div>
          ) : null}
          <div ref={bottomRef} className="h-1 shrink-0" aria-hidden />
        </div>
      </div>

      <div className="shrink-0 border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
        {showPendingBar ? (
          <div className="border-b border-violet-100 px-2 py-1.5 lg:hidden">
            <ChatReplyPending
              count={Math.max(1, backgroundJobCount)}
              percent={backgroundProgress?.percent}
              label={backgroundProgress?.label}
              onStop={onStopReply}
            />
          </div>
        ) : null}

        {stickyHitl?.pendingAction ? (
          <div className="border-b border-amber-100 bg-amber-50/95 px-3 py-2 lg:hidden">
            {stickyHitl.pendingAction.attachments?.length ? (
              <p className="mb-1 truncate text-[11px] text-slate-600">
                {stickyHitl.pendingAction.attachments.map((f) => f.filename).join(", ")}
              </p>
            ) : null}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onConfirmAction?.(stickyHitl.pendingAction?.message || "", stickyHitl.pendingAction?.attachments)}
                className="min-h-11 flex-1 rounded-xl bg-violet-700 px-2 text-sm font-semibold text-white active:bg-violet-800"
              >
                {stickyHitl.pendingAction.label || "Confirmer"}
              </button>
              <button
                type="button"
                onClick={() => onDismissAction?.(stickyHitl.id)}
                className="min-h-11 shrink-0 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 active:bg-slate-50"
              >
                Annuler
              </button>
            </div>
          </div>
        ) : null}

      <form
        onSubmit={onSubmit}
        onDragEnter={(e) => {
          e.preventDefault();
          if (e.dataTransfer.types.includes("Files")) setDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          takeFiles(filesFromDataTransfer(e.dataTransfer));
        }}
        className="chat-composer-shell relative px-2 pt-1 sm:px-4 sm:pt-3"
        style={{ paddingBottom: "max(0.25rem, env(safe-area-inset-bottom, 0px))" }}
      >
        {dragging ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-t-xl border-2 border-dashed border-violet-400 bg-violet-50/90 text-sm font-semibold text-violet-800">
            Déposer les fichiers ici
          </div>
        ) : null}
        <input
          id="chat-attach-camera"
          ref={cameraInputRef}
          type="file"
          accept={CHAT_ACCEPT_CAMERA}
          capture="environment"
          className={pickInputClass}
          onChange={onPickFromInput}
        />
        <input
          id="chat-attach-gallery"
          ref={galleryInputRef}
          type="file"
          accept={CHAT_ACCEPT_MEDIA}
          multiple
          className={pickInputClass}
          onChange={onPickFromInput}
        />
        <input
          id="chat-attach-files"
          ref={fileInputRef}
          type="file"
          multiple
          accept={CHAT_FILE_ACCEPT}
          className={pickInputClass}
          onChange={onPickFromInput}
        />
        {attachments.length > 0 ? (
          <div className="mx-auto mb-1.5 flex max-w-3xl flex-wrap gap-1.5">
            {attachments.map((f) => {
              const kind = chatFileKind(f.mime, f.filename);
              return (
                <div
                  key={f.id}
                  className="flex max-w-full items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-1.5 py-1"
                >
                  {kind === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={resourceFileUrl(f.id, true)}
                      alt=""
                      className="h-8 w-8 rounded object-cover"
                    />
                  ) : null}
                  <span className="max-w-[9rem] truncate text-[11px] font-medium text-slate-800">{f.filename}</span>
                  {f.size ? (
                    <span className="shrink-0 text-[10px] text-slate-500">{formatChatFileSize(f.size)}</span>
                  ) : null}
                  {onRemoveFile ? (
                    <button
                      type="button"
                      onClick={() => onRemoveFile(f.id)}
                      className="flex h-5 w-5 items-center justify-center rounded-full text-slate-500 hover:bg-slate-200"
                      aria-label={`Retirer ${f.filename}`}
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
        {uploadError ? <p className="mx-auto mb-1 max-w-3xl text-[11px] text-red-700">{uploadError}</p> : null}
        {!isQuotidien && teamOffer && onHandOffToTeam ? (
          <div className="chat-composer-extra mx-auto flex max-w-3xl items-center gap-2 px-1 pb-1">
            <button
              type="button"
              onClick={onHandOffToTeam}
              className="rounded-full bg-violet-700 px-3 py-1.5 text-xs font-semibold text-white"
            >
              Faire faire par l&apos;équipe
            </button>
            {onDismissTeamOffer ? (
              <button
                type="button"
                onClick={onDismissTeamOffer}
                className="rounded-full px-2 py-1.5 text-xs font-semibold text-slate-500"
              >
                Plus tard
              </button>
            ) : null}
          </div>
        ) : null}
        {isQuotidien && reformChips.length > 0 && !pending && hasAssistantReply ? (
          <div className="chat-composer-extra mx-auto flex max-w-3xl flex-wrap gap-1.5 px-1 pb-1">
            {reformChips.map((chip) => (
              <button
                key={chip.label}
                type="button"
                disabled={pending || uploadBusy}
                onClick={() => onQuickSend?.(chip.text)}
                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:border-violet-300 hover:text-violet-800 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
              >
                {chip.label}
              </button>
            ))}
          </div>
        ) : null}
        {!isQuotidien && canConvertToMission && onConvertToMission && convertBrief == null ? (
          <div className="chat-composer-extra mx-auto max-w-3xl px-1 pb-1">
            <button
              type="button"
              onClick={onConvertToMission}
              disabled={convertBusy}
              className="text-sm font-semibold text-violet-800 hover:underline disabled:opacity-40 dark:text-violet-300"
            >
              Préparer un travail
            </button>
          </div>
        ) : null}
        {replyingTo ? (
          <div className="mx-auto mb-1.5 flex max-w-3xl items-stretch gap-2 rounded-xl border-l-4 border-violet-500 bg-violet-50 px-2.5 py-1.5 dark:bg-violet-950/40">
            <button
              type="button"
              onClick={() => focusQuotedMessage(replyingTo.id)}
              className="min-w-0 flex-1 text-left"
            >
              <p className="text-[11px] font-semibold text-violet-800 dark:text-violet-200">
                {replyingTo.role === "assistant" ? "Réponse à l'agent" : "Réponse à votre message"}
              </p>
              <p className="truncate text-xs text-slate-600 dark:text-slate-300">{replyingTo.excerpt}</p>
            </button>
            <button
              type="button"
              onClick={() => setReplyingTo(null)}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-violet-100 dark:hover:bg-violet-900"
              aria-label="Annuler la réponse"
            >
              ×
            </button>
          </div>
        ) : null}
        <div className="mx-auto flex max-w-3xl items-end gap-1">
          {onAddFiles ? (
            <button
              type="button"
              onClick={openAttachMenu}
              disabled={uploadBusy || attachments.length >= CHAT_FILE_MAX}
              className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-600 active:bg-slate-100 disabled:opacity-40 dark:text-slate-300 dark:active:bg-slate-800"
              aria-label="Joindre une photo ou un fichier"
              title="Joindre"
              aria-expanded={attachOpen}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.82-2.83l8.49-8.48" />
              </svg>
            </button>
          ) : null}
          <div className="chat-input-pill flex min-h-9 min-w-0 flex-1 items-end rounded-[1.35rem]">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              onKeyDown={onKeyDown}
              onPaste={(e) => {
                const files = filesFromClipboard(e.nativeEvent);
                if (!files.length) return;
                e.preventDefault();
                takeFiles(files);
              }}
              onPointerUp={() => {
                const el = textareaRef.current;
                if (!el) return;
                // Conserve une hauteur tirée à la main (poignée resize desktop).
                if (el.offsetHeight > 48) userMinHeightRef.current = el.offsetHeight;
              }}
              rows={1}
              placeholder={replyingTo ? "Répondre à ce message" : "Message"}
              title="Entrée : nouvelle ligne · Ctrl+Entrée : envoyer"
              className="max-h-[7.5rem] min-h-9 w-full resize-none bg-transparent px-3.5 py-2 text-[16px] leading-5 text-slate-900 outline-none dark:text-slate-100 dark:placeholder:text-slate-500 lg:max-h-[17.5rem] lg:resize-y"
              style={{ height: 40 }}
              enterKeyHint="enter"
              autoComplete="off"
              autoCorrect="on"
            />
          </div>
          <button
            type="submit"
            disabled={pending || uploadBusy || (!draft.trim() && attachments.length === 0)}
            className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-700 text-white transition-colors active:bg-violet-800 disabled:bg-slate-300 disabled:text-white"
            aria-label="Envoyer"
            title="Envoyer (Ctrl+Entrée)"
          >
            <SendIcon />
          </button>
        </div>
      </form>
      </div>

      {convertBrief != null && onConvertBriefChange && onConfirmConvert ? (
        <div className="absolute inset-0 z-30 flex flex-col bg-white dark:bg-slate-950">
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-slate-200 px-3 dark:border-slate-800">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">Ce que vous voulez accomplir</p>
            {onCancelConvert ? (
              <button
                type="button"
                onClick={onCancelConvert}
                disabled={convertBusy}
                className="text-sm font-semibold text-slate-600"
              >
                Fermer
              </button>
            ) : null}
          </div>
          <textarea
            value={convertBrief}
            onChange={(e) => onConvertBriefChange(e.target.value)}
            className="min-h-0 flex-1 resize-none px-3 py-2 text-[16px] leading-snug text-slate-800 outline-none dark:bg-slate-950 dark:text-slate-100"
          />
          <div
            className="flex gap-2 border-t border-slate-200 px-3 pt-2"
            style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom, 0px))" }}
          >
            {onCancelConvert ? (
              <button
                type="button"
                onClick={onCancelConvert}
                disabled={convertBusy}
                className="flex-1 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-700"
              >
                Annuler
              </button>
            ) : null}
            <button
              type="button"
              onClick={onConfirmConvert}
              disabled={convertBusy || !convertBrief.trim()}
              className="flex-[1.3] rounded-xl bg-violet-700 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {convertBusy ? "Lancement…" : "Lancer"}
            </button>
          </div>
        </div>
      ) : null}

      {portalReady && attachOpen
        ? createPortal(
            <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-label="Joindre">
              <button
                type="button"
                className="absolute inset-0 bg-slate-950/45"
                aria-label="Fermer"
                onClick={() => setAttachOpen(false)}
              />
              <div
                className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-white px-3 pt-2 shadow-2xl"
                style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}
              >
                <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300" />
                <p className="mb-1 px-2 text-sm font-semibold text-slate-900">Ajouter</p>
                <label
                  htmlFor="chat-attach-camera"
                  className="flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl px-3 text-[16px] font-semibold text-slate-900 active:bg-slate-100"
                  onClick={() => window.setTimeout(() => setAttachOpen(false), 350)}
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-100 text-violet-800" aria-hidden>
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" d="M4 8h3l2-3h6l2 3h3v11H4V8z" />
                      <circle cx="12" cy="13" r="3.5" />
                    </svg>
                  </span>
                  Appareil photo
                </label>
                <label
                  htmlFor="chat-attach-gallery"
                  className="flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl px-3 text-[16px] font-semibold text-slate-900 active:bg-slate-100"
                  onClick={() => window.setTimeout(() => setAttachOpen(false), 350)}
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-100 text-sky-800" aria-hidden>
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="5" width="18" height="14" rx="2" />
                      <circle cx="8.5" cy="10" r="1.5" />
                      <path strokeLinecap="round" d="m21 16-5-5-8 8" />
                    </svg>
                  </span>
                  Galerie
                </label>
                <label
                  htmlFor="chat-attach-files"
                  className="flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl px-3 text-[16px] font-semibold text-slate-900 active:bg-slate-100"
                  onClick={() => window.setTimeout(() => setAttachOpen(false), 350)}
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-700" aria-hidden>
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7 3h7l5 5v13H7V3z" />
                      <path strokeLinecap="round" d="M14 3v5h5" />
                    </svg>
                  </span>
                  Fichiers
                </label>
                <button
                  type="button"
                  className="mt-1 w-full rounded-2xl py-3 text-[16px] font-semibold text-slate-600"
                  onClick={() => setAttachOpen(false)}
                >
                  Annuler
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
