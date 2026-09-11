"use client";

import { ChangeEvent, FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import AgentMessageMarkdown from "../AgentMessageMarkdown";
import ChatAgentMacaron from "./ChatAgentMacaron";
import ChatMessageDeliverables from "./ChatMessageDeliverables";
import ChatMessageFiles from "./ChatMessageFiles";
import TeamBlueprintCard from "./TeamBlueprintCard";
import { extractJobIdFromMessageId, fetchJobAgentKeys } from "../../lib/chatJobAgents";
import { chatBubbleDisplayText } from "../../lib/chatMirrorDisplay";
import { resourceFileUrl } from "../../lib/business";
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
};

type Props = {
  messages: ChatMsg[];
  draft: string;
  onDraftChange: (v: string) => void;
  onSend: () => void;
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
};

function displayAgentKeys(msg: ChatMsg): string[] {
  if (msg.agentKeys?.length) return msg.agentKeys;
  if (msg.id.startsWith("ack-")) return ["coordinateur"];
  return [];
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
      <path d="M3.4 20.4 21 12 3.4 3.6v6.7L15 12 3.4 13.7z" />
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
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const hydratingRef = useRef<Set<string>>(new Set());
  const [localAgents, setLocalAgents] = useState<Record<string, string[]>>({});
  const [composing, setComposing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [portalReady, setPortalReady] = useState(false);
  const userTurns = messages.filter((m) => m.role === "user").length;
  const isFirstTurn = userTurns === 0 && !pending && backgroundJobCount === 0;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending, backgroundJobCount, backgroundProgress?.percent]);

  useEffect(() => setPortalReady(true), []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const compact = 36;
    const min = composing ? 108 : compact;
    const max = composing ? Math.min(Math.round(window.innerHeight * 0.42), 340) : compact;
    el.style.height = "0px";
    const next = composing ? Math.min(Math.max(el.scrollHeight, min), max) : compact;
    el.style.height = `${next}px`;
  }, [draft, composing]);

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

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey) return;
    if (uploadBusy) return;
    if (!draft.trim() && attachments.length === 0) return;
    e.preventDefault();
    onSend();
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (uploadBusy) return;
    onSend();
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
    <div className={`relative mx-auto flex min-h-0 w-full flex-col bg-white ${className || "h-[calc(100dvh-10rem)]"}`}>
      {backgroundJobCount > 0 ? (
        <div
          className="flex h-8 shrink-0 items-center gap-2 border-b border-violet-100 bg-violet-50 px-3 text-xs font-medium text-violet-900"
          role="status"
          aria-live="polite"
        >
          <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-violet-600" />
          <span className="min-w-0 truncate">
            {backgroundJobCount > 1 ? `${backgroundJobCount} réponses en cours` : "Réponse en cours…"}
          </span>
          {backgroundProgress ? (
            <span className="ml-auto shrink-0 tabular-nums text-[11px] text-violet-700">
              {Math.round(backgroundProgress.percent)}%
            </span>
          ) : null}
        </div>
      ) : null}
      {backgroundJobCount > 0 && backgroundProgress ? (
        <div className="h-0.5 w-full shrink-0 bg-violet-100" aria-hidden>
          <div
            className="h-full bg-violet-600 transition-[width] duration-500"
            style={{ width: `${Math.max(0, Math.min(100, backgroundProgress.percent))}%` }}
          />
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-2 py-2 sm:px-4 sm:py-4">
        <div className="mx-auto max-w-3xl space-y-3 sm:space-y-5">
          {isFirstTurn ? (
            <div className="px-2 pt-6 text-center sm:pt-10">
              <h1 className="text-lg font-semibold tracking-tight text-slate-900 sm:text-3xl">
                Qu&apos;est-ce qui vous préoccupe ?
              </h1>
              <p className="mt-1.5 text-sm text-slate-500 sm:mt-3 sm:text-base">
                Texte, image, PDF ou vidéo — le trombone joint un fichier.
              </p>
            </div>
          ) : null}

          {messages.map((m) => {
            const agents = localAgents[m.id] || displayAgentKeys(m);
            return (
              <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[min(100%,28rem)] sm:max-w-[85%] ${m.role === "user" ? "w-auto" : "w-full sm:w-auto"}`}>
                  <div
                    className={`overflow-hidden px-3.5 py-2 text-[15px] leading-snug sm:rounded-3xl sm:px-5 sm:py-3 sm:leading-relaxed ${
                      m.role === "user"
                        ? "rounded-[1.15rem] rounded-br-md bg-slate-900 text-white"
                        : "rounded-[1.15rem] rounded-bl-md bg-slate-100 text-slate-800"
                    }`}
                  >
                    {m.role === "user" ? (
                      <>
                        {m.content.trim() ? <span className="whitespace-pre-wrap">{m.content}</span> : null}
                        <ChatMessageFiles files={m.attachments} />
                      </>
                    ) : (
                      <AgentMessageMarkdown source={chatBubbleDisplayText(m.id, m.content)} />
                    )}
                  </div>
                  {m.role === "assistant" && agents.length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {agents.map((key) => (
                        <ChatAgentMacaron key={key} agentKey={key} label={agentLabels[key]} />
                      ))}
                    </div>
                  ) : null}
                  {m.role === "assistant" ? <ChatMessageDeliverables message={m} /> : null}
                  {m.role === "assistant" && m.pendingBlueprintId ? (
                    <TeamBlueprintCard
                      blueprintId={m.pendingBlueprintId}
                      onCreated={(gid) => onTeamCreated?.(gid)}
                      onDismiss={() => onPatchMessage?.(m.id, { pendingBlueprintId: undefined })}
                    />
                  ) : null}
                </div>
              </div>
            );
          })}

          {pending ? (
            <p className="text-center text-xs text-slate-400" aria-live="polite">
              Accusé de réception…
            </p>
          ) : null}
          <div ref={bottomRef} className="h-1 shrink-0" aria-hidden />
        </div>
      </div>

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
        className="relative shrink-0 border-t border-slate-200 bg-white px-2 pt-1.5 sm:px-4 sm:pt-3"
        style={{ paddingBottom: "max(0.4rem, env(safe-area-inset-bottom, 0px))" }}
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
        <div className="mx-auto flex max-w-3xl items-end gap-1.5 sm:gap-2">
          {onAddFiles ? (
            <button
              type="button"
              onClick={openAttachMenu}
              disabled={pending || uploadBusy || attachments.length >= CHAT_FILE_MAX}
              className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 disabled:opacity-40"
              aria-label="Joindre une photo ou un fichier"
              title="Joindre"
              aria-expanded={attachOpen}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.82-2.83l8.49-8.48" />
              </svg>
            </button>
          ) : null}
          {canConvertToMission && onConvertToMission && convertBrief == null ? (
            <button
              type="button"
              onClick={onConvertToMission}
              disabled={convertBusy}
              className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-violet-700 hover:bg-violet-50 disabled:opacity-40"
              aria-label="Préparer une mission"
              title="Préparer une mission"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 4v16M5 5h12l-2 4 2 4H5" />
              </svg>
            </button>
          ) : null}
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
            onFocus={() => setComposing(true)}
            onBlur={() => setComposing(false)}
            disabled={pending}
            rows={1}
            placeholder="Message ou fichier…"
            className={`flex-1 resize-none rounded-2xl border border-slate-200 bg-slate-50 px-3 text-[16px] leading-snug text-slate-900 outline-none transition-[height] duration-200 ease-out focus:border-violet-300 focus:bg-white focus:ring-2 focus:ring-violet-100 disabled:opacity-60 ${
              composing ? "overflow-y-auto py-2.5" : "overflow-hidden py-1.5"
            }`}
            enterKeyHint="send"
            autoComplete="off"
            autoCorrect="on"
          />
          <button
            type="submit"
            disabled={pending || uploadBusy || (!draft.trim() && attachments.length === 0)}
            className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-700 text-white transition-colors hover:bg-violet-800 disabled:bg-slate-300 disabled:text-white"
            aria-label="Envoyer"
          >
            <SendIcon />
          </button>
        </div>
      </form>

      {convertBrief != null && onConvertBriefChange && onConfirmConvert ? (
        <div className="absolute inset-0 z-30 flex flex-col bg-white">
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-slate-200 px-3">
            <p className="text-sm font-semibold text-slate-900">Brief mission</p>
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
            className="min-h-0 flex-1 resize-none px-3 py-2 text-[16px] leading-snug text-slate-800 outline-none"
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
