"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ChatShell, { type ChatMsg } from "../../components/chat/ChatShell";
import ChatSidebar from "../../components/chat/ChatSidebar";
import ChatConversationHeader from "../../components/chat/ChatConversationHeader";
import {
  describeInterlocutor,
  interlocutorFromGroupId,
  parseInterlocutor,
  type GroupOpt,
} from "../../components/chat/ChatInterlocutorSelect";
import ChatThreadMoreSheet from "../../components/chat/ChatThreadMoreSheet";
import { businessApi } from "../../lib/business";
import { CHAT_FILE_MAX, type ChatFile } from "../../lib/chatAttachments";
import MissionContextBanner from "../../components/MissionContextBanner";
import { progressFromJob, type ChatReplyProgress } from "../../lib/chatProgress";
import { messageWantsTeam } from "../../lib/chatTeamOffer";
import {
  addPendingChatJob,
  loadPendingChatJobs,
  pendingJobsForConversation,
  savePendingChatJobs,
  removePendingChatJob,
  updatePendingChatJobProgress,
  type PendingChatJob,
} from "../../lib/chatPendingJobs";
import {
  conversationTitleFromMessages,
  createConversation,
  deleteConversation,
  getActiveConversationId,
  hydrateConversationsFromServer,
  loadConversations,
  setActiveConversationId,
  upsertConversation,
  type ChatConversation,
} from "../../lib/chatSessions";
import { agentHeaders, requestJson } from "../../lib/api";
import { chatTextIsDegraded, isChatTransportFailure, localDegradedChatReply } from "../../lib/chatDegraded";
import { toChatSurface } from "../../lib/chatSurface";
import { useActionToast } from "../../lib/actionToast";
import { fetchJobAgentKeys, type ChatJobDelivery } from "../../lib/chatJobAgents";
import { buildMissionBriefFromChat } from "../../lib/chatMissionConvert";
import { loadThinkingMode } from "../../lib/thinkingMode";
import {
  confirmDeleteChatConversation,
  deleteChatConversationJobs,
} from "../../lib/deleteChatConversation";
import { invalidateAfterMissionDelete } from "../../lib/deleteMissionBundle";
import { JOB_ID_MAX_LEN } from "../../lib/missionBossView";
import { cancelActiveJob } from "../../lib/jobControl";
import { QK } from "../../lib/queryClient";
import { rememberInterlocutor } from "../../lib/recentInterlocutors";
import { useChatTextScale } from "../../lib/chatTextScale";

function stripMarkdownPreview(text: string, max = 120): string {
  return text.replace(/[#*_`]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

async function requestBrowserNotificationPermission() {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission === "default") {
    try {
      await Notification.requestPermission();
    } catch {
      /* ignore */
    }
  }
}

function pushBrowserNotification(title: string, body: string, tag: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, tag });
  } catch {
    /* ignore */
  }
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="p-6 text-center text-slate-500">Chargement du chat…</div>}>
      <ChatPageInner />
    </Suspense>
  );
}

function ChatPageInner() {
  const qc = useQueryClient();
  const router = useRouter();
  const { pushToast } = useActionToast();
  const searchParams = useSearchParams();
  const linkedParentJobId = (searchParams.get("parent") || "").trim().slice(0, JOB_ID_MAX_LEN);
  const urlSessionId = (searchParams.get("session") || "").trim();
  const highlightJobId = (searchParams.get("job") || "").trim().slice(0, JOB_ID_MAX_LEN);
  const urlGroupId = (searchParams.get("group") || "").trim();

  const { scale: textScale, setScale: setTextScale } = useChatTextScale();
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [backgroundJobs, setBackgroundJobs] = useState<PendingChatJob[]>([]);
  const [mobilePane, setMobilePane] = useState<"list" | "thread">(() =>
    urlSessionId || linkedParentJobId || highlightJobId ? "thread" : "list",
  );
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);
  const [replyProgress, setReplyProgress] = useState<ChatReplyProgress | null>(null);
  const [teamOfferDismissedId, setTeamOfferDismissedId] = useState("");
  const [convertBusy, setConvertBusy] = useState(false);
  const [convertBrief, setConvertBrief] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<ChatFile[]>([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [interlocutor, setInterlocutor] = useState(() =>
    urlGroupId ? interlocutorFromGroupId(urlGroupId) : "assistant",
  );
  const pollingRef = useRef<Set<string>>(new Set());
  const stoppedReplyRef = useRef<Set<string>>(new Set());
  const activeIdRef = useRef<string | null>(null);
  const interlocutorRef = useRef(interlocutor);
  const initRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    interlocutorRef.current = interlocutor;
  }, [interlocutor]);

  useEffect(() => {
    if (!urlGroupId) return;
    const value = interlocutorFromGroupId(urlGroupId);
    interlocutorRef.current = value;
    setInterlocutor(value);
    rememberInterlocutor(value);
  }, [urlGroupId]);

  const refreshConversations = useCallback(() => {
    setConversations(loadConversations());
    setBackgroundJobs(loadPendingChatJobs());
  }, []);

  const persistActiveConversation = useCallback(
    (nextMessages: ChatMsg[], extra?: Partial<ChatConversation>) => {
      const id = activeIdRef.current;
      if (!id) return;
      const existing = loadConversations().find((c) => c.id === id);
      const previous = existing?.messages || [];
      const messagesChanged =
        previous.length !== nextMessages.length ||
        previous.some((m, i) => m.id !== nextMessages[i]?.id || m.content !== nextMessages[i]?.content);
      const conv: ChatConversation = {
        id,
        title: conversationTitleFromMessages(nextMessages),
        messages: nextMessages,
        updatedAt: messagesChanged ? Date.now() : existing?.updatedAt || Date.now(),
        linkedParentJobId: extra && "linkedParentJobId" in extra ? extra.linkedParentJobId : existing?.linkedParentJobId,
        interlocutor: extra?.interlocutor ?? interlocutorRef.current ?? existing?.interlocutor,
        unread: extra?.unread ?? false,
        unreadPreview: extra?.unreadPreview,
        ...extra,
      };
      upsertConversation(conv);
      refreshConversations();
    },
    [refreshConversations],
  );

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    void (async () => {
      let list = await hydrateConversationsFromServer();
      let active = urlSessionId || getActiveConversationId();

      if (linkedParentJobId) {
        const linked = list.find((c) => c.linkedParentJobId === linkedParentJobId);
        if (linked) {
          active = linked.id;
        } else {
          const conv = createConversation({ linkedParentJobId });
          list = [conv, ...list];
          upsertConversation(conv);
          active = conv.id;
        }
      }

      if (!list.length) {
        const conv = createConversation(linkedParentJobId ? { linkedParentJobId } : undefined);
        list = [conv];
        upsertConversation(conv);
        active = conv.id;
      }

      if (!active || !list.some((c) => c.id === active)) {
        active = list[0].id;
      }

      const current = list.find((c) => c.id === active) || list[0];
      setConversations(list);
      setActiveId(current.id);
      setActiveConversationId(current.id);
      setMessages(current.messages);
      if (!urlGroupId && current.interlocutor) {
        interlocutorRef.current = current.interlocutor;
        setInterlocutor(current.interlocutor);
      }
      setBackgroundJobs(loadPendingChatJobs());
      setHydrated(true);
    })();
  }, [linkedParentJobId, urlSessionId]);

  const selectConversation = useCallback(
    (id: string) => {
      if (id === activeId) {
        setMobilePane("thread");
        return;
      }
      if (activeId) {
        persistActiveConversation(messages);
      }
      const conv = loadConversations().find((c) => c.id === id);
      if (!conv) return;
      const cleared = { ...conv, unread: false, unreadPreview: undefined };
      upsertConversation(cleared);
      const nextInterlocutor = conv.interlocutor || "assistant";
      interlocutorRef.current = nextInterlocutor;
      setInterlocutor(nextInterlocutor);
      setActiveId(id);
      setActiveConversationId(id);
      setMessages(conv.messages);
      setDraft("");
      setPendingFiles([]);
      setUploadError("");
      setMobilePane("thread");
      refreshConversations();
      router.replace(`/chat?session=${encodeURIComponent(id)}`, { scroll: false });
    },
    [activeId, messages, persistActiveConversation, refreshConversations, router],
  );

  const newConversation = useCallback(() => {
    if (activeId) persistActiveConversation(messages);
    interlocutorRef.current = "assistant";
    setInterlocutor("assistant");
    const conv = createConversation();
    conv.interlocutor = "assistant";
    upsertConversation(conv);
    setActiveId(conv.id);
    setActiveConversationId(conv.id);
    setMessages([]);
    setDraft("");
    setPendingFiles([]);
    setUploadError("");
    setMobilePane("thread");
    refreshConversations();
    router.replace(`/chat?session=${encodeURIComponent(conv.id)}`, { scroll: false });
  }, [activeId, messages, persistActiveConversation, refreshConversations, router]);

  const backToMobileList = useCallback(() => {
    if (activeId) persistActiveConversation(messages);
    setMobilePane("list");
    setMoreSheetOpen(false);
  }, [activeId, messages, persistActiveConversation]);

  const eraseConversation = useCallback(
    async (id: string) => {
      const conv = loadConversations().find((c) => c.id === id);
      const convMessages = id === activeId ? messages : (conv?.messages ?? []);
      const { deleteChatConversationOnServer } = await import("../../lib/chatConversationsApi");
      try {
        await deleteChatConversationOnServer(id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/404|introuvable/i.test(msg)) throw err;
      }
      try {
        await deleteChatConversationJobs(id, convMessages);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/introuvable|aucune occurrence/i.test(msg)) throw err;
      }
      deleteConversation(id, { remote: false });
    },
    [activeId, messages],
  );

  const settleAfterRemoval = useCallback(
    (removedIds: string[]) => {
      invalidateAfterMissionDelete(qc);
      const remaining = loadConversations();
      const removed = new Set(removedIds);
      const jobs = loadPendingChatJobs().filter((j) => !removed.has(j.conversationId));
      savePendingChatJobs(jobs);
      if (activeId && removed.has(activeId)) {
        if (remaining.length) selectConversation(remaining[0].id);
        else newConversation();
      } else {
        refreshConversations();
        setBackgroundJobs(jobs);
      }
    },
    [activeId, newConversation, qc, refreshConversations, selectConversation],
  );

  const removeConversation = useCallback(
    async (id: string) => {
      if (!confirmDeleteChatConversation()) return;
      try {
        await eraseConversation(id);
      } catch (err) {
        if (typeof window !== "undefined") {
          window.alert(err instanceof Error ? err.message : String(err));
        }
        return;
      }
      settleAfterRemoval([id]);
    },
    [eraseConversation, settleAfterRemoval],
  );

  const removeConversations = useCallback(
    async (ids: string[]): Promise<boolean> => {
      const unique = [...new Set(ids.filter(Boolean))];
      if (!unique.length) return false;
      if (
        typeof window !== "undefined" &&
        !window.confirm(
          `Supprimer ${unique.length} conversation(s) ?\n\nLes échanges et les jobs chat associés seront effacés. Une mission parente liée, si présente, n'est pas supprimée.`,
        )
      ) {
        return false;
      }
      const removed: string[] = [];
      let firstError = "";
      for (const id of unique) {
        try {
          await eraseConversation(id);
          removed.push(id);
        } catch (err) {
          if (!firstError) firstError = err instanceof Error ? err.message : String(err);
        }
      }
      if (removed.length) settleAfterRemoval(removed);
      if (firstError && typeof window !== "undefined") window.alert(firstError);
      return removed.length === unique.length;
    },
    [eraseConversation, settleAfterRemoval],
  );

  useEffect(() => {
    if (!hydrated || !activeId) return;
    persistActiveConversation(messages);
  }, [messages, hydrated, activeId, persistActiveConversation]);

  const pollJob = useCallback(async (jobId: string, onTick?: (progress: ChatReplyProgress) => void) => {
    let transportFailures = 0;
    for (;;) {
      if (stoppedReplyRef.current.has(jobId)) {
        return { surface: "Réponse arrêtée.", degraded: false, jobId };
      }
      let data: {
        status?: string;
        result_surface?: string;
        result?: string;
        degraded?: boolean;
        drive_artifacts?: unknown;
        claim_guard?: ChatMsg["claimGuard"];
        team?: Array<{ phase?: string; status?: string }>;
        events?: Array<{ type?: string; data?: { phase?: string } }>;
      };
      try {
        const res = await requestJson(`/jobs/${encodeURIComponent(jobId)}?log_offset=100000&events_offset=0`, {
          headers: agentHeaders(),
          retries: 1,
        });
        data = res.data;
        transportFailures = 0;
      } catch (err) {
        transportFailures += 1;
        if (transportFailures >= 5) throw err;
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      onTick?.(progressFromJob(data));
      const status = String(data.status || "");
      if (status === "cancelled") {
        return {
          surface: "Réponse arrêtée.",
          degraded: false,
          jobId,
        };
      }
      if (status === "completed") {
        const raw = String(data.result_surface || data.result || "");
        return {
          surface: toChatSurface(raw),
          degraded: Boolean(data.degraded) || chatTextIsDegraded(raw),
          jobId,
          driveArtifacts: (data.drive_artifacts || []) as ChatJobDelivery["driveArtifacts"],
          deliverablesMarkdown: String(data.result || ""),
          claimGuard: data.claim_guard,
        };
      }
      if (status.startsWith("error")) {
        throw new Error(status.replace(/^error:\s*/i, "") || "Erreur mission");
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }, []);

  const deliverJobResult = useCallback(
    async (job: PendingChatJob, delivery: { surface: string; degraded?: boolean; driveArtifacts?: unknown[]; deliverablesMarkdown?: string; claimGuard?: ChatMsg["claimGuard"] } | string, isError = false) => {
      const surface = stoppedReplyRef.current.has(job.jobId)
        ? "Réponse arrêtée."
        : typeof delivery === "string"
          ? delivery
          : delivery.surface;
      const degraded = typeof delivery === "string" ? chatTextIsDegraded(delivery) : Boolean(delivery.degraded) || chatTextIsDegraded(delivery.surface);
      const driveArtifacts = typeof delivery === "string" ? undefined : delivery.driveArtifacts;
      const deliverablesMarkdown = typeof delivery === "string" ? undefined : delivery.deliverablesMarkdown;
      const claimGuard = typeof delivery === "string" ? undefined : delivery.claimGuard;
      const assistantId = isError ? `e-${job.jobId}` : `a-${job.jobId}`;
      const conv = loadConversations().find((c) => c.id === job.conversationId);
      if (!conv) {
        removePendingChatJob(job.jobId);
        refreshConversations();
        return;
      }
      if (conv.messages.some((m) => m.id === assistantId)) {
        removePendingChatJob(job.jobId);
        refreshConversations();
        return;
      }

      let agentKeys: string[] | undefined;
      let pendingBlueprintId: string | undefined;
      if (!isError) {
        try {
          const { data: jobData } = await requestJson(`/jobs/${encodeURIComponent(job.jobId)}`, { retries: 1 });
          pendingBlueprintId = jobData?.pending_blueprint_id || undefined;
          const keys = await fetchJobAgentKeys(job.jobId);
          const agent = String(jobData?.agent || "");
          if (agent === "assistant" || keys.includes("assistant")) {
            agentKeys = ["assistant"];
          } else {
            const delegated = keys.filter((k) => k !== "coordinateur");
            agentKeys = delegated.length ? delegated : keys.length ? keys : ["coordinateur"];
          }
        } catch {
          agentKeys = ["assistant"];
        }
      }

      const nextMessages: ChatMsg[] = [
        ...conv.messages,
        {
          id: assistantId,
          role: "assistant",
          content: surface,
          jobId: job.jobId,
          ...(driveArtifacts ? { driveArtifacts: driveArtifacts as ChatMsg["driveArtifacts"] } : {}),
          ...(deliverablesMarkdown ? { deliverablesMarkdown } : {}),
          ...(agentKeys ? { agentKeys } : {}),
          ...(pendingBlueprintId ? { pendingBlueprintId } : {}),
          ...(degraded ? { degraded: true } : {}),
          ...(claimGuard?.status ? { claimGuard } : {}),
        },
      ];
      const preview = stripMarkdownPreview(surface);
      const isActive = activeIdRef.current === job.conversationId;

      upsertConversation({
        ...conv,
        messages: nextMessages,
        title: conversationTitleFromMessages(nextMessages),
        updatedAt: Date.now(),
        unread: !isActive,
        unreadPreview: !isActive ? preview : undefined,
      });

      if (isActive && mountedRef.current) {
        setMessages(nextMessages);
      }
      if (!isActive || document.hidden) {
        const title = isError ? "Échec — conversation" : "Réponse prête";
        const body = `${conv.title} — ${preview || "Nouvelle réponse dans le chat."}`;
        void (async () => {
          if (document.hidden) await requestBrowserNotificationPermission();
          pushBrowserNotification(title, body, job.jobId);
        })();
      }

      removePendingChatJob(job.jobId);
      if (activeIdRef.current === job.conversationId) setReplyProgress(null);
      refreshConversations();
      void qc.invalidateQueries({ queryKey: QK.jobsCards });
      void qc.invalidateQueries({ queryKey: QK.deliverablesLibrary });
      void qc.invalidateQueries({ queryKey: QK.tokens });
      void qc.invalidateQueries({ queryKey: ["director-notifications"] });
    },
    [qc, refreshConversations],
  );

  const watchJobInBackground = useCallback(
    (job: PendingChatJob) => {
      if (pollingRef.current.has(job.jobId)) return;
      pollingRef.current.add(job.jobId);
      void (async () => {
        try {
          const delivery = await pollJob(job.jobId, (progress) => {
            updatePendingChatJobProgress(job.jobId, {
              progressPercent: progress.percent,
              progressLabel: progress.label,
              progressStatus: progress.status,
            });
            if (activeIdRef.current === job.conversationId && mountedRef.current) setReplyProgress(progress);
            if (mountedRef.current) setBackgroundJobs(loadPendingChatJobs());
          });
          await deliverJobResult(job, delivery, false);
        } catch (err) {
          await deliverJobResult(job, err instanceof Error ? err.message : String(err), true);
        } finally {
          pollingRef.current.delete(job.jobId);
        }
      })();
    },
    [pollJob, deliverJobResult],
  );

  const stopActiveReply = useCallback(async () => {
    if (!window.confirm("Arrêter la réponse en cours ?")) return;
    const convId = activeIdRef.current;
    if (!convId) return;
    const jobs = pendingJobsForConversation(convId);
    const ids = jobs.map((job) => job.jobId);
    for (const id of ids) {
      stoppedReplyRef.current.add(id);
      removePendingChatJob(id);
    }
    setBackgroundJobs(loadPendingChatJobs());
    if (ids.length) {
      setMessages((prev) => {
        const next = [...prev];
        for (const id of ids) {
          if (!next.some((m) => m.id === `a-${id}` || m.id === `e-${id}`)) {
            next.push({ id: `a-${id}`, role: "assistant", content: "Réponse arrêtée." });
          }
        }
        return next;
      });
    }
    for (const id of ids) {
      try {
        await cancelActiveJob(id);
      } catch {
        /* le fil s'arrête au prochain jalon */
      }
    }
  }, []);

  const dismissPendingAction = useCallback((messageId: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId
          ? { ...m, pendingAction: undefined, content: "Action annulée. Rien n'a été lancé." }
          : m,
      ),
    );
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    for (const job of backgroundJobs) {
      watchJobInBackground(job);
    }
  }, [hydrated, backgroundJobs, watchJobInBackground]);

  useEffect(() => {
    if (!hydrated || !highlightJobId) return;
    const job = loadPendingChatJobs().find((j) => j.jobId === highlightJobId);
    if (job) {
      selectConversation(job.conversationId);
      return;
    }
    const conv = loadConversations().find((c) =>
      c.messages.some((m) => m.id === `a-${highlightJobId}` || m.id === `e-${highlightJobId}`),
    );
    if (conv) selectConversation(conv.id);
  }, [hydrated, highlightJobId, selectConversation]);

  const addChatFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setUploadError("");
    const room = Math.max(0, CHAT_FILE_MAX - pendingFiles.length);
    const picked = files.slice(0, room);
    if (!picked.length) {
      setUploadError(`Maximum ${CHAT_FILE_MAX} fichiers par message.`);
      return;
    }
    setUploadBusy(true);
    try {
      const uploaded: ChatFile[] = [];
      for (const file of picked) {
        const saved = await businessApi.uploadResourceFile(file);
        uploaded.push({
          id: saved.id,
          filename: saved.filename || file.name,
          mime: saved.mime || file.type,
          size: saved.size || file.size,
        });
      }
      setPendingFiles((prev) => [...prev, ...uploaded].slice(0, CHAT_FILE_MAX));
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload impossible");
    } finally {
      setUploadBusy(false);
    }
  }, [pendingFiles.length]);

  const send = useCallback(async (opts?: {
    confirmAction?: boolean;
    text?: string;
    messagesOverride?: ChatMsg[];
    attachments?: ChatFile[];
    reuseLastUser?: boolean;
  }) => {
    const text = (opts?.text ?? draft).trim();
    const files = (opts?.confirmAction || opts?.reuseLastUser ? opts.attachments || [] : pendingFiles).slice(0, CHAT_FILE_MAX);
    if ((!text && files.length === 0) || pending || !activeId || uploadBusy) return;

    const baseMessages = opts?.messagesOverride ?? messages;
    const keepTurn = Boolean(opts?.confirmAction || opts?.reuseLastUser);
    const userMsg: ChatMsg = {
      id: `u-${Date.now()}`,
      role: "user",
      content: text,
      ...(files.length ? { attachments: files } : {}),
    };
    const history = keepTurn
      ? baseMessages.map((m) => (m.pendingAction ? { ...m, pendingAction: undefined } : m))
      : [...baseMessages, userMsg];
    if (!keepTurn) {
      setMessages(history);
      setDraft("");
      setPendingFiles([]);
      setUploadError("");
    } else {
      setMessages(history);
    }
    setPending(true);
    setReplyProgress({ percent: 12, label: "Je prépare" });

    const conv = loadConversations().find((c) => c.id === activeId);
    const parentId = conv?.linkedParentJobId || undefined;
    let payloadSource = baseMessages.filter((m) => !m.pendingAction);
    if (keepTurn) {
      const last = payloadSource[payloadSource.length - 1];
      if (last?.role === "user" && last.content.trim() === text) payloadSource = payloadSource.slice(0, -1);
    }
    const historyPayload = payloadSource.map(({ role, content, attachments }) => ({
      role,
      content: attachments?.length
        ? `${content}\n[Fichiers: ${attachments.map((a) => a.filename).join(", ")}]`.trim()
        : content,
    }));

    const who = interlocutorRef.current;
    try {
      const { agent, agentGroupId } = parseInterlocutor(who);
      rememberInterlocutor(who);
      const { data } = await requestJson("/chat", {
        method: "POST",
        headers: agentHeaders(),
        timeoutMs: 25_000,
        body: JSON.stringify({
          message: text,
          agent,
          history: historyPayload,
          chat_session_id: activeId,
          ...(parentId ? { linked_job_id: parentId } : {}),
          ...(agentGroupId ? { agent_group_id: agentGroupId } : {}),
          ...(files.length ? { attachments: files } : {}),
          ...(opts?.confirmAction ? { confirm_action: true } : {}),
          thinking_mode: loadThinkingMode(),
        }),
      });

      if (data?.status === "needs_confirmation") {
        const askAgent = agent === "assistant" ? "assistant" : String(data.agent || agent || "coordinateur");
        const actionLabel = String(data.action_label || data.proposal || "Confirmer");
        setReplyProgress(null);
        setMessages([
          ...history,
          {
            id: `hitl-${Date.now()}`,
            role: "assistant",
            content: "Rien n'est fait tant que vous ne confirmez pas.",
            agentKeys: [askAgent],
            pendingAction: { message: text, attachments: files, label: actionLabel },
          },
        ]);
      } else if (data?.status === "accepted" && data?.job_id) {
        const jobId = String(data.job_id);
        const mirror = String(data.mirror_ack || "").trim();
        const ackAgent = agent === "assistant" ? "assistant" : String(data.agent || agent || "coordinateur");
        const withAck: ChatMsg[] = [
          ...history,
          ...(mirror
            ? [{ id: `ack-${jobId}`, role: "assistant" as const, content: mirror, agentKeys: [ackAgent] }]
            : []),
        ];
        setMessages(withAck);
        const pendingJob: PendingChatJob = {
          jobId,
          conversationId: activeId,
          startedAt: Date.now(),
          linkedParentJobId: parentId,
          userPreview: stripMarkdownPreview(text || files.map((f) => f.filename).join(", "), 80),
        };
        addPendingChatJob(pendingJob);
        refreshConversations();
        watchJobInBackground(pendingJob);
      } else {
        const surface = toChatSurface(String(data?.response || ""));
        const degraded = Boolean(data?.degraded) || chatTextIsDegraded(surface);
        const claimGuard = data?.claim_guard as ChatMsg["claimGuard"] | undefined;
        setReplyProgress(null);
        setMessages([
          ...history,
          {
            id: `a-${Date.now()}`,
            role: "assistant",
            content: surface,
            agentKeys: [agent],
            ...(degraded ? { degraded: true } : {}),
            ...(claimGuard?.status ? { claimGuard } : {}),
          },
        ]);
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Une erreur est survenue.";
      const degraded = isChatTransportFailure(err);
      const { agent: failAgent } = parseInterlocutor(who);
      setReplyProgress(null);
      setMessages([
        ...history,
        {
          id: `e-${Date.now()}`,
          role: "assistant",
          content: degraded ? localDegradedChatReply(text, failAgent === "coordinateur" ? "CIO" : failAgent) : raw,
          agentKeys: [failAgent],
          ...(degraded ? { degraded: true } : {}),
        },
      ]);
    } finally {
      setPending(false);
    }
  }, [
    draft,
    pending,
    activeId,
    messages,
    pendingFiles,
    uploadBusy,
    watchJobInBackground,
    refreshConversations,
  ]);

  const submitChoiceAnswers = useCallback(
    (messageId: string, text: string) => {
      const next = messages.map((m) =>
        m.id === messageId ? { ...m, choiceAnsweredSummary: text } : m,
      );
      pushToast("Réponses du questionnaire envoyées.");
      void send({ text, messagesOverride: next });
    },
    [messages, send, pushToast],
  );

  const { data: agentsList = [] } = useQuery({
    queryKey: QK.agents,
    queryFn: async () => (await requestJson("/agents", { retries: 1 })).data.agents || [],
    staleTime: 60_000,
  });

  const agentLabels = useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of agentsList as Array<{ key?: string; label?: string }>) {
      const k = String(a.key || "").trim();
      if (k) map[k] = String(a.label || k);
    }
    return map;
  }, [agentsList]);

  const patchMessage = useCallback((id: string, patch: Partial<ChatMsg>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  const openConvertPreview = useCallback(() => {
    if (!activeId || convertBusy) return;
    const title = conversations.find((c) => c.id === activeId)?.title;
    setConvertBrief(buildMissionBriefFromChat(messages, title));
  }, [activeId, convertBusy, conversations, messages]);

  const convertToMission = useCallback(async () => {
    if (!activeId || convertBusy) return;
    const brief = (convertBrief || "").trim() || buildMissionBriefFromChat(
      messages,
      conversations.find((c) => c.id === activeId)?.title,
    );
    setConvertBusy(true);
    try {
      const { agent, agentGroupId } = parseInterlocutor(interlocutor);
      rememberInterlocutor(interlocutor);
      const runAgent = agent === "assistant" ? "coordinateur" : agent;
      const { data } = await requestJson("/run", {
        method: "POST",
        headers: agentHeaders(),
        body: JSON.stringify({
          mission: brief,
          agent: runAgent,
          mission_config: {
            agent_group_id: agentGroupId || (agent === "coordinateur" ? "entreprise" : null),
            require_user_validation: true,
            cio_plan_hitl_enabled: true,
            thinking_mode: loadThinkingMode(),
          },
        }),
      });
      const jobId = String(data?.job_id || "").trim();
      if (!jobId) throw new Error("Mission non créée");
      persistActiveConversation(messages, { linkedParentJobId: jobId });
      router.push(`/missions?job=${encodeURIComponent(jobId)}`);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Impossible de lancer la mission");
    } finally {
      setConvertBusy(false);
    }
  }, [activeId, convertBusy, convertBrief, conversations, messages, interlocutor, persistActiveConversation, router]);

  const { data: groupsList = [] } = useQuery({
    queryKey: ["agent-groups"],
    queryFn: async () => (await requestJson("/agent-groups", { retries: 1 })).data.groups || [],
  });

  const chooseInterlocutor = useCallback(
    (value: string) => {
      interlocutorRef.current = value;
      setInterlocutor(value);
      const groups = (groupsList || []) as GroupOpt[];
      rememberInterlocutor(value, describeInterlocutor(value, groups).title);
      if (activeIdRef.current) {
        persistActiveConversation(messages, { interlocutor: value });
      }
    },
    [groupsList, messages, persistActiveConversation],
  );

  useEffect(() => {
    const groups = (groupsList || []) as GroupOpt[];
    if (interlocutor.startsWith("group:") && !groups.length) return;
    rememberInterlocutor(interlocutor, describeInterlocutor(interlocutor, groups).title);
  }, [interlocutor, groupsList]);

  const interlocutorLabel = useCallback(
    (conv: ChatConversation) => {
      if (!conv.interlocutor || conv.interlocutor === "assistant") return null;
      return describeInterlocutor(conv.interlocutor, groupsList as GroupOpt[]).title;
    },
    [groupsList],
  );

  const handOffToTeam = useCallback(() => {
    chooseInterlocutor("coordinateur");
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const text = (lastUser?.content || "").trim();
    setTeamOfferDismissedId(lastUser?.id || "dismissed");
    if (!text) return;
    void send({ text, reuseLastUser: true, attachments: lastUser?.attachments });
  }, [chooseInterlocutor, messages, send]);

  const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
  const showTeamOffer =
    interlocutor === "assistant" &&
    Boolean(lastUserMessage) &&
    messageWantsTeam(lastUserMessage?.content || "") &&
    teamOfferDismissedId !== lastUserMessage?.id &&
    !pending;

  if (!hydrated || !activeId) {
    return <div className="p-6 text-center text-slate-500">Chargement…</div>;
  }

  const activePendingCount = pendingJobsForConversation(activeId).length;
  const hasAnswer = messages.some(
    (m) =>
      m.role === "assistant" &&
      !m.pendingAction &&
      Boolean(m.content.trim()) &&
      m.content !== "Rien n'est fait tant que vous ne confirmez pas." &&
      m.content !== "Réponse arrêtée.",
  );
  const canConvertToMission =
    messages.some((m) => m.role === "user") && hasAnswer && activePendingCount === 0 && !pending;
  const activeConv = conversations.find((c) => c.id === activeId);
  const missionJobId = activeConv?.linkedParentJobId || "";
  const interlocutorName = describeInterlocutor(interlocutor, groupsList as GroupOpt[]).title;

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col bg-white dark:bg-slate-950 lg:border-x lg:border-slate-200 dark:lg:border-slate-800">
      {/* Mobile inbox */}
      <div className={`min-h-0 flex-1 lg:hidden ${mobilePane === "list" ? "flex" : "hidden"}`}>
        <ChatSidebar
          variant="inbox"
          conversations={conversations}
          activeId={activeId}
          pendingJobs={backgroundJobs}
          onSelect={selectConversation}
          onNew={newConversation}
          onDelete={(id) => void removeConversation(id)}
          onDeleteMany={(ids) => removeConversations(ids)}
          interlocutorLabel={interlocutorLabel}
          className="flex"
        />
      </div>

      {/* Thread : mobile (si ouvert) + desktop toujours */}
      <div
        className={`relative min-h-0 flex-1 overflow-hidden ${
          mobilePane === "thread" ? "flex" : "hidden lg:flex"
        }`}
      >
        <ChatSidebar
          conversations={conversations}
          activeId={activeId}
          pendingJobs={backgroundJobs}
          onSelect={selectConversation}
          onNew={newConversation}
          onDelete={(id) => void removeConversation(id)}
          onDeleteMany={(ids) => removeConversations(ids)}
          interlocutorLabel={interlocutorLabel}
          className="hidden lg:flex"
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <ChatConversationHeader
            title={activeConv?.title || "Chat"}
            subtitle={interlocutorName}
            onBack={backToMobileList}
            onOpenMore={() => setMoreSheetOpen(true)}
          />
          {missionJobId ? (
            <div className="shrink-0 border-b border-slate-100">
              <MissionContextBanner jobId={missionJobId} />
            </div>
          ) : null}
          <ChatShell
            messages={messages}
            draft={draft}
            onDraftChange={setDraft}
            onSend={() => void send()}
            onQuickSend={(text) => void send({ text })}
            pending={pending}
            backgroundJobCount={activePendingCount}
            backgroundProgress={activePendingCount > 0 || pending ? replyProgress : null}
            onStopReply={activePendingCount > 0 ? () => void stopActiveReply() : undefined}
            onConfirmAction={(message, attachments) => void send({ confirmAction: true, text: message, attachments })}
            onDismissAction={dismissPendingAction}
            onSubmitChoiceAnswers={submitChoiceAnswers}
            teamOffer={showTeamOffer}
            onHandOffToTeam={handOffToTeam}
            onDismissTeamOffer={() => setTeamOfferDismissedId(lastUserMessage?.id || "dismissed")}
            className="h-full max-w-none min-h-0 flex-1"
            agentLabels={agentLabels}
            onPatchMessage={patchMessage}
            onConvertToMission={openConvertPreview}
            convertBusy={convertBusy}
            canConvertToMission={canConvertToMission}
            convertBrief={convertBrief}
            onConvertBriefChange={setConvertBrief}
            onConfirmConvert={() => void convertToMission()}
            onCancelConvert={() => setConvertBrief(null)}
            attachments={pendingFiles}
            onAddFiles={(files) => void addChatFiles(files)}
            onRemoveFile={(id) => setPendingFiles((prev) => prev.filter((f) => f.id !== id))}
            uploadBusy={uploadBusy}
            uploadError={uploadError}
            onTeamCreated={(groupId) => {
              chooseInterlocutor(interlocutorFromGroupId(groupId));
              void qc.invalidateQueries({ queryKey: ["agent-groups"] });
              void qc.invalidateQueries({ queryKey: QK.agents });
            }}
          />
        </div>
      </div>

      <ChatThreadMoreSheet
        open={moreSheetOpen}
        onClose={() => setMoreSheetOpen(false)}
        onDelete={() => activeId && void removeConversation(activeId)}
        linkedParentJobId={missionJobId || undefined}
        onOpenLinkedMission={
          missionJobId
            ? () => router.push(`/missions?job=${encodeURIComponent(missionJobId)}`)
            : undefined
        }
        textScale={textScale}
        onTextScaleChange={setTextScale}
        interlocutor={interlocutor}
        groups={groupsList as GroupOpt[]}
        onInterlocutorChange={chooseInterlocutor}
        interlocutorDisabled={pending}
        onHandOffToTeam={handOffToTeam}
      />
    </div>
  );
}
