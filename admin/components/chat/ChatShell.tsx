"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import AgentMessageMarkdown from "../AgentMessageMarkdown";
import ChatAgentMacaron from "./ChatAgentMacaron";
import ChatMessageDeliverables from "./ChatMessageDeliverables";
import { extractJobIdFromMessageId, fetchJobAgentKeys } from "../../lib/chatJobAgents";
import { chatBubbleDisplayText } from "../../lib/chatMirrorDisplay";
import type { DriveArtifact } from "../../lib/types";

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
};

type Props = {
  messages: ChatMsg[];
  draft: string;
  onDraftChange: (v: string) => void;
  onSend: () => void;
  pending: boolean;
  backgroundJobCount?: number;
  className?: string;
  agentLabels?: Record<string, string>;
  onPatchMessage?: (id: string, patch: Partial<ChatMsg>) => void;
  onConvertToMission?: () => void;
  convertBusy?: boolean;
  canConvertToMission?: boolean;
};

function displayAgentKeys(msg: ChatMsg): string[] {
  if (msg.agentKeys?.length) return msg.agentKeys;
  if (msg.id.startsWith("ack-")) return ["coordinateur"];
  return [];
}

export default function ChatShell({
  messages,
  draft,
  onDraftChange,
  onSend,
  pending,
  backgroundJobCount = 0,
  className = "",
  agentLabels = {},
  onPatchMessage,
  onConvertToMission,
  convertBusy = false,
  canConvertToMission = false,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const hydratingRef = useRef<Set<string>>(new Set());
  const [localAgents, setLocalAgents] = useState<Record<string, string[]>>({});
  const userTurns = messages.filter((m) => m.role === "user").length;
  const isFirstTurn = userTurns === 0 && !pending && backgroundJobCount === 0;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending, backgroundJobCount]);

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
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSend();
  };

  return (
    <div className={`mx-auto flex min-h-0 w-full flex-col ${className || "h-[calc(100dvh-10rem)]"}`}>
      {backgroundJobCount > 0 ? (
        <div
          className="mx-4 mt-3 flex shrink-0 items-center gap-2 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm text-violet-950"
          role="status"
          aria-live="polite"
        >
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-violet-600" />
          <span>
            {backgroundJobCount} exploration{backgroundJobCount > 1 ? "s" : ""} en arrière-plan — vous serez notifié
            à la fin.
          </span>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 sm:py-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {isFirstTurn ? (
            <div className="pt-8 text-center">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
                Qu&apos;est-ce qui vous préoccupe ?
              </h1>
              <p className="mt-3 text-sm text-slate-500 sm:text-base">
                Décrivez votre besoin — Korymb structure la réponse en tâche de fond.
              </p>
            </div>
          ) : null}

          {messages.map((m) => {
            const agents = localAgents[m.id] || displayAgentKeys(m);
            return (
              <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`relative max-w-[90%] ${m.role === "assistant" ? "pt-2" : ""}`}>
                  {m.role === "assistant" && agents.length > 0 ? (
                    <div className="absolute -top-1 right-2 z-10 flex max-w-[70%] flex-wrap justify-end gap-1">
                      {agents.map((key) => (
                        <ChatAgentMacaron key={key} agentKey={key} label={agentLabels[key]} />
                      ))}
                    </div>
                  ) : null}
                  <div
                    className={`overflow-visible rounded-3xl px-5 py-3 text-[15px] leading-relaxed ${
                      m.role === "user" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-800"
                    }`}
                  >
                    {m.role === "user" ? (
                      <span className="whitespace-pre-wrap">{m.content}</span>
                    ) : (
                      <AgentMessageMarkdown source={chatBubbleDisplayText(m.id, m.content)} />
                    )}
                  </div>
                  {m.role === "assistant" ? <ChatMessageDeliverables message={m} /> : null}
                </div>
              </div>
            );
          })}

          {pending ? (
            <p className="text-center text-sm text-slate-400" aria-live="polite">
              Accusé de réception…
            </p>
          ) : null}
          <div ref={bottomRef} className="h-2 shrink-0" aria-hidden />
        </div>
      </div>

      {canConvertToMission && onConvertToMission ? (
        <div className="shrink-0 border-t border-slate-100 bg-slate-50/80 px-4 py-2.5">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
            <p className="text-xs text-slate-500 sm:text-sm">
              Approfondir ce sujet avec toute l&apos;équipe multi-agents ?
            </p>
            <button
              type="button"
              onClick={onConvertToMission}
              disabled={convertBusy}
              className="shrink-0 rounded-2xl border border-violet-200 bg-white px-4 py-2 text-sm font-semibold text-violet-800 shadow-sm transition-colors hover:bg-violet-50 disabled:opacity-50"
            >
              {convertBusy ? "Lancement…" : "Lancer en mission →"}
            </button>
          </div>
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="shrink-0 border-t border-slate-200 bg-white px-4 py-3 pb-safe">
        <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-3xl border border-slate-200 bg-white px-4 py-3 shadow-sm focus-within:ring-2 focus-within:ring-violet-200">
          <textarea
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={pending}
            rows={1}
            placeholder="Votre message…"
            className="max-h-40 min-h-[44px] flex-1 resize-none bg-transparent text-base outline-none sm:text-sm"
            enterKeyHint="send"
          />
          <button
            type="submit"
            disabled={pending || !draft.trim()}
            className="rounded-2xl bg-violet-700 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-violet-800 disabled:opacity-40"
          >
            Envoyer
          </button>
        </div>
      </form>
    </div>
  );
}
