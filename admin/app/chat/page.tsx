"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ChatShell, { type ChatMsg } from "../../components/chat/ChatShell";
import ChatSidebar from "../../components/chat/ChatSidebar";
import ChatHistoryDrawer from "../../components/chat/ChatHistoryDrawer";
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
import { orbMoodFromLabel, progressFromJob, type ChatReplyProgress } from "../../lib/chatProgress";
import {
  activeChatFleets,
  fleetNamedInText,
  fleetOfferAnchor,
  isFleetConfirm,
  messageAsksExistingFleet,
  messageWantsTeam,
  type FleetPick,
} from "../../lib/chatTeamOffer";
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
  ensurePersoConversation,
  findConversationByJobId,
  getActiveConversationId,
  conversationHasContent,
  isBlankConversation,
  isPersoConversation,
  showConversationInList,
  hydrateConversationsFromServer,
  loadConversations,
  setActiveConversationId,
  upsertConversation,
  type ChatConversation,
} from "../../lib/chatSessions";
import { agentHeaders, requestJson } from "../../lib/api";
import { chatTextIsDegraded, isChatTransportFailure, localDegradedChatReply } from "../../lib/chatDegraded";
import { chatTextWithReply, type ChatReplyTarget } from "../../lib/chatReply";
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
import {
  CHAT_PERSO_TITLE,
  CHAT_QUICK_CHIPS,
  chatHistoryLimit,
  loadChatUseMode,
  saveChatUseMode,
  type ChatUseMode,
} from "../../lib/chatUseMode";
import { postChatStream } from "../../lib/chatStream";

function blueprintIdFromText(text: string): string | undefined {
  const match = text.match(/\bbp-[a-f0-9]{12}\b/i);
  return match ? match[0].toLowerCase() : undefined;
}

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
  const [historyOpen, setHistoryOpen] = useState(false);
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);
  const [replyProgress, setReplyProgress] = useState<ChatReplyProgress | null>(null);
  const [teamOfferDismissedId, setTeamOfferDismissedId] = useState("");
  const [fleetOfferDismissedId, setFleetOfferDismissedId] = useState("");
  const [convertBusy, setConvertBusy] = useState(false);
  const [convertBrief, setConvertBrief] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<ChatFile[]>([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [interlocutor, setInterlocutor] = useState(() =>
    urlGroupId ? interlocutorFromGroupId(urlGroupId) : "assistant",
  );
  const [chatUseMode, setChatUseMode] = useState<ChatUseMode>(() => loadChatUseMode());
  const pollingRef = useRef<Set<string>>(new Set());
  const stoppedReplyRef = useRef<Set<string>>(new Set());
  const activeIdRef = useRef<string | null>(null);
  const interlocutorRef = useRef(interlocutor);
  const chatUseModeRef = useRef(chatUseMode);
  const streamAbortRef = useRef<AbortController | null>(null);
  const fleetCandidatesRef = useRef<FleetPick[]>([]);
  const relayToFleetRef = useRef<
    (groupId: string, brief: string, history: ChatMsg[], label: string) => void
  >(() => {});
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
    chatUseModeRef.current = chatUseMode;
  }, [chatUseMode]);

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

  const applyChatUseMode = useCallback(
    (mode: ChatUseMode) => {
      setChatUseMode(mode);
      saveChatUseMode(mode);
      if (mode === "quotidien") {
        interlocutorRef.current = "assistant";
        setInterlocutor("assistant");
        rememberInterlocutor("assistant");
        const perso = ensurePersoConversation(CHAT_PERSO_TITLE);
        refreshConversations();
        if (!activeIdRef.current) {
          setActiveConversationId(perso.id);
          setActiveId(perso.id);
          setMessages(perso.messages || []);
        }
      }
    },
    [refreshConversations],
  );

  const openPersoThread = useCallback(() => {
    const perso = ensurePersoConversation(CHAT_PERSO_TITLE);
    setActiveConversationId(perso.id);
    setActiveId(perso.id);
    setMessages(perso.messages || []);
    setHistoryOpen(false);
    interlocutorRef.current = "assistant";
    setInterlocutor("assistant");
    refreshConversations();
  }, [refreshConversations]);

  const persistActiveConversation = useCallback(
    (nextMessages: ChatMsg[], extra?: Partial<ChatConversation>) => {
      const id = activeIdRef.current;
      if (!id) return;
      const existing = loadConversations().find((c) => c.id === id);
      const previous = existing?.messages || [];
      const messagesChanged =
        previous.length !== nextMessages.length ||
        previous.some((m, i) => m.id !== nextMessages[i]?.id || m.content !== nextMessages[i]?.content);
      const perso =
        existing?.id === "conv-perso" ||
        existing?.id.startsWith("conv-perso-") ||
        existing?.title === CHAT_PERSO_TITLE;
      const title =
        extra && "title" in extra && extra.title
          ? extra.title
          : perso
            ? CHAT_PERSO_TITLE
            : existing?.titleCustom
              ? existing.title
              : conversationTitleFromMessages(nextMessages);
      const conv: ChatConversation = {
        id,
        messages: nextMessages,
        updatedAt: messagesChanged ? Date.now() : existing?.updatedAt || Date.now(),
        linkedParentJobId: extra && "linkedParentJobId" in extra ? extra.linkedParentJobId : existing?.linkedParentJobId,
        interlocutor: extra?.interlocutor ?? interlocutorRef.current ?? existing?.interlocutor,
        unread: extra?.unread ?? false,
        unreadPreview: extra?.unreadPreview,
        pinned: existing?.pinned,
        titleCustom: existing?.titleCustom,
        ...extra,
        title,
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

      const openedFromLink = Boolean(urlSessionId || linkedParentJobId || highlightJobId);
      if (!openedFromLink) {
        const fresh = list.find((c) => isBlankConversation(c));
        if (fresh) {
          active = fresh.id;
        } else {
          const conv = createConversation({ interlocutor: "assistant" });
          upsertConversation(conv);
          list = loadConversations();
          active = conv.id;
        }
      }

      if (!active || !list.some((c) => c.id === active)) {
        active = list[0].id;
      }

      const current = list.find((c) => c.id === active) || list[0];
      setConversations(list);
      setActiveId(current.id);
      setActiveConversationId(current.id);
      setMessages(current.messages);
      if (loadChatUseMode() === "quotidien") {
        interlocutorRef.current = "assistant";
        setInterlocutor("assistant");
      } else if (!urlGroupId && current.interlocutor) {
        interlocutorRef.current = current.interlocutor;
        setInterlocutor(current.interlocutor);
      }
      setBackgroundJobs(loadPendingChatJobs());
      setHydrated(true);
      if (!urlSessionId && !linkedParentJobId && !highlightJobId) {
        router.replace(`/chat?session=${encodeURIComponent(current.id)}`, { scroll: false });
      }
    })();
  }, [highlightJobId, linkedParentJobId, router, urlSessionId]);

  const selectConversation = useCallback(
    (id: string) => {
      if (id === activeId) {
        setHistoryOpen(false);
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
      setHistoryOpen(false);
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
    setHistoryOpen(false);
    refreshConversations();
    router.replace(`/chat?session=${encodeURIComponent(conv.id)}`, { scroll: false });
  }, [activeId, messages, persistActiveConversation, refreshConversations, router]);

  const renameActiveConversation = useCallback(
    (title: string) => {
      const id = activeIdRef.current;
      const clean = title.trim().replace(/\s+/g, " ").slice(0, 80);
      if (!id || !clean) return;
      const existing = loadConversations().find((c) => c.id === id);
      if (!existing || isPersoConversation(existing)) return;
      upsertConversation({ ...existing, title: clean, titleCustom: true });
      refreshConversations();
    },
    [refreshConversations],
  );

  const togglePinActiveConversation = useCallback(() => {
    const id = activeIdRef.current;
    if (!id) return;
    const existing = loadConversations().find((c) => c.id === id);
    if (!existing || isPersoConversation(existing)) return;
    upsertConversation({ ...existing, pinned: !existing.pinned, updatedAt: existing.updatedAt });
    refreshConversations();
  }, [refreshConversations]);

  const copyActiveConversation = useCallback(async () => {
    const text = messages
      .map((m) => {
        const body = (m.content || "").trim();
        if (!body) return "";
        return `${m.role === "user" ? "Vous" : "Korymb"}\n${body}`;
      })
      .filter(Boolean)
      .join("\n\n");
    if (!text) return false;
    await navigator.clipboard.writeText(text);
    return true;
  }, [messages]);

  const openHistory = useCallback(() => {
    if (activeId) persistActiveConversation(messages);
    setMoreSheetOpen(false);
    setHistoryOpen(true);
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
        const next = remaining.find((c) => showConversationInList(c));
        if (next) selectConversation(next.id);
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
      const target = loadConversations().find((c) => c.id === id);
      const empty = Boolean(target && !conversationHasContent(target) && !target.linkedParentJobId);
      if (!empty && !confirmDeleteChatConversation()) return;
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
        pending_blueprint_id?: string;
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
          pendingBlueprintId: data.pending_blueprint_id || blueprintIdFromText(raw),
        };
      }
      if (status.startsWith("error")) {
        throw new Error(status.replace(/^error:\s*/i, "") || "Erreur mission");
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }, []);

  const deliverJobResult = useCallback(
    async (job: PendingChatJob, delivery: { surface: string; degraded?: boolean; driveArtifacts?: unknown[]; deliverablesMarkdown?: string; claimGuard?: ChatMsg["claimGuard"]; pendingBlueprintId?: string } | string, isError = false) => {
      const surface = stoppedReplyRef.current.has(job.jobId)
        ? "Réponse arrêtée."
        : typeof delivery === "string"
          ? delivery
          : delivery.surface;
      const degraded = typeof delivery === "string" ? chatTextIsDegraded(delivery) : Boolean(delivery.degraded) || chatTextIsDegraded(delivery.surface);
      const driveArtifacts = typeof delivery === "string" ? undefined : delivery.driveArtifacts;
      const deliverablesMarkdown = typeof delivery === "string" ? undefined : delivery.deliverablesMarkdown;
      const claimGuard = typeof delivery === "string" ? undefined : delivery.claimGuard;
      const deliveredBlueprintId =
        typeof delivery === "string" ? blueprintIdFromText(delivery) : delivery.pendingBlueprintId;
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
      let voiced = surface;
      const relay = job.relayFleet;
      if (!isError) {
        try {
          const { data: jobData } = await requestJson(`/jobs/${encodeURIComponent(job.jobId)}`, { retries: 1 });
          pendingBlueprintId = jobData?.pending_blueprint_id || deliveredBlueprintId || blueprintIdFromText(surface);
          const keys = await fetchJobAgentKeys(job.jobId);
          const agent = String(jobData?.agent || "");
          if (relay || agent === "assistant" || keys.includes("assistant")) {
            agentKeys = ["assistant"];
          } else {
            const delegated = keys.filter((k) => k !== "coordinateur");
            agentKeys = delegated.length ? delegated : keys.length ? keys : ["coordinateur"];
          }
        } catch {
          agentKeys = ["assistant"];
          pendingBlueprintId = deliveredBlueprintId || blueprintIdFromText(surface);
        }
      }
      if (relay && !isError) {
        agentKeys = ["assistant"];
        voiced = `Voici ce que la flotte « ${relay.label} » a produit. Je reste votre interlocuteur.\n\n${surface}`;
      }

      const nextMessages: ChatMsg[] = [
        ...conv.messages,
        {
          id: assistantId,
          role: "assistant",
          content: voiced,
          jobId: job.jobId,
          ...(driveArtifacts ? { driveArtifacts: driveArtifacts as ChatMsg["driveArtifacts"] } : {}),
          ...(deliverablesMarkdown ? { deliverablesMarkdown } : {}),
          ...(agentKeys ? { agentKeys } : {}),
          ...(pendingBlueprintId ? { pendingBlueprintId } : {}),
          ...(degraded ? { degraded: true } : {}),
          ...(claimGuard?.status ? { claimGuard } : {}),
          ...(relay && !isError
            ? { fleetRelay: { groupId: relay.groupId, label: relay.label, jobId: job.jobId } }
            : {}),
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

  const relayToFleet = useCallback(
    (groupId: string, brief: string, history: ChatMsg[], label: string) => {
      const sessionId = activeIdRef.current;
      const ask = brief.trim();
      if (!ask || !sessionId || pending) return;
      setPending(true);
      setReplyProgress({ percent: 18, label: `Je transmets à ${label}` });
      let cut = history.length;
      for (let i = history.length - 1; i >= 0; i -= 1) {
        if (history[i].role === "user" && history[i].content.trim() === ask) {
          cut = i;
          break;
        }
      }
      const conv = loadConversations().find((c) => c.id === sessionId);
      const parentId = conv?.linkedParentJobId || undefined;
      const historyPayload = history
        .slice(0, cut)
        .filter((item) => !item.pendingAction)
        .map((item) => {
          const body = chatTextWithReply(item.content, item.replyTo);
          return {
            role: item.role,
            content: item.attachments?.length
              ? `${body}\n[Fichiers: ${item.attachments.map((a) => a.filename).join(", ")}]`.trim()
              : body,
          };
        })
        .slice(-chatHistoryLimit("quotidien"));
      void (async () => {
        try {
          const { data } = await requestJson("/chat", {
            method: "POST",
            headers: agentHeaders(),
            timeoutMs: 25_000,
            body: JSON.stringify({
              message: ask,
              agent: "coordinateur",
              history: historyPayload,
              chat_session_id: sessionId,
              agent_group_id: groupId,
              chat_use_mode: "quotidien",
              ...(parentId ? { linked_job_id: parentId } : {}),
              thinking_mode: loadThinkingMode(),
            }),
          });
          if (!mountedRef.current) return;
          if (data?.status === "accepted" && data?.job_id) {
            const jobId = String(data.job_id);
            const ack: ChatMsg = {
              id: `ack-${jobId}`,
              role: "assistant",
              content: `Je transmets votre demande à la flotte « ${label} ». Je reste votre interlocuteur et je vous rapporte ici ce qu'elle produit.`,
              agentKeys: ["assistant"],
              jobId,
              fleetRelay: { groupId, label, jobId },
            };
            setMessages((prev) => [...prev, ack]);
            const pendingJob: PendingChatJob = {
              jobId,
              conversationId: sessionId,
              startedAt: Date.now(),
              linkedParentJobId: parentId,
              userPreview: stripMarkdownPreview(ask, 80),
              relayFleet: { groupId, label },
            };
            addPendingChatJob(pendingJob);
            refreshConversations();
            watchJobInBackground(pendingJob);
            return;
          }
          const surface = toChatSurface(String(data?.response || "La flotte n'a pas pu démarrer."));
          setReplyProgress(null);
          setMessages((prev) => [
            ...prev,
            { id: `a-${Date.now()}`, role: "assistant", content: surface, agentKeys: ["assistant"] },
          ]);
        } catch (err) {
          const raw = err instanceof Error ? err.message : "Une erreur est survenue.";
          setReplyProgress(null);
          setMessages((prev) => [
            ...prev,
            { id: `e-${Date.now()}`, role: "assistant", content: raw, agentKeys: ["assistant"] },
          ]);
        } finally {
          if (mountedRef.current) setPending(false);
        }
      })();
    },
    [pending, refreshConversations, watchJobInBackground],
  );

  useEffect(() => {
    relayToFleetRef.current = relayToFleet;
  }, [relayToFleet]);

  const stopActiveReply = useCallback(async () => {
    if (!window.confirm("Arrêter la réponse en cours ?")) return;
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    setPending(false);
    setReplyProgress(null);
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
    const conv = findConversationByJobId(highlightJobId);
    if (conv) {
      selectConversation(conv.id);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await requestJson(`/jobs/${encodeURIComponent(highlightJobId)}`, {
          headers: agentHeaders(),
          retries: 0,
          timeoutMs: 15_000,
        });
        const session = String((data as { chat_session_id?: string })?.chat_session_id || "").trim();
        if (!cancelled && session) selectConversation(session);
      } catch {
        /* le fil déjà ouvert reste en place */
      }
    })();
    return () => {
      cancelled = true;
    };
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
    replyTo?: ChatReplyTarget | null;
  }) => {
    const text = (opts?.text ?? draft).trim();
    const files = (opts?.confirmAction || opts?.reuseLastUser ? opts.attachments || [] : pendingFiles).slice(0, CHAT_FILE_MAX);
    if ((!text && files.length === 0) || pending || !activeId || uploadBusy) return "";

    const baseMessages = opts?.messagesOverride ?? messages;
    const keepTurn = Boolean(opts?.confirmAction || opts?.reuseLastUser);
    const carriedReply = keepTurn
      ? [...baseMessages].reverse().find((m) => m.role === "user" && m.content.trim() === text)?.replyTo
      : undefined;
    const replyTo = opts?.replyTo || carriedReply || undefined;
    const userMsg: ChatMsg = {
      id: `u-${Date.now()}`,
      role: "user",
      content: text,
      ...(files.length ? { attachments: files } : {}),
      ...(replyTo ? { replyTo } : {}),
    };
    const history = keepTurn
      ? baseMessages.map((m) => (m.pendingAction ? { ...m, pendingAction: undefined } : m))
      : [...baseMessages, userMsg];
    if (chatUseModeRef.current === "quotidien" && !keepTurn && text) {
      const fleets = fleetCandidatesRef.current;
      const anchor = fleetOfferAnchor(baseMessages);
      const named = fleetNamedInText(text, fleets);
      const explicit = messageAsksExistingFleet(text);
      const confirm = isFleetConfirm(text);
      const target = explicit
        ? named || (fleets.length === 1 ? fleets[0] : null)
        : anchor && confirm
          ? named || (fleets.length === 1 ? fleets[0] : null)
          : null;
      if (target) {
        const brief = anchor?.text || text;
        setMessages(history);
        setDraft("");
        setPendingFiles([]);
        setUploadError("");
        relayToFleetRef.current(target.id, brief, history, target.label);
        return "";
      }
      if (explicit && fleets.length > 0) {
        setMessages([
          ...history,
          {
            id: `a-${Date.now()}`,
            role: "assistant",
            content:
              "Plusieurs flottes peuvent prendre cette analyse. Choisissez laquelle : je reste votre interlocuteur.",
            agentKeys: ["assistant"],
          },
        ]);
        setDraft("");
        setPendingFiles([]);
        setUploadError("");
        return "";
      }
    }
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
    let spoken = "";

    const conv = loadConversations().find((c) => c.id === activeId);
    const parentId = conv?.linkedParentJobId || undefined;
    let payloadSource = baseMessages.filter((m) => !m.pendingAction);
    if (keepTurn) {
      const last = payloadSource[payloadSource.length - 1];
      if (last?.role === "user" && last.content.trim() === text) payloadSource = payloadSource.slice(0, -1);
    }
    const useMode = chatUseModeRef.current;
    const histLimit = chatHistoryLimit(useMode);
    const historyPayload = payloadSource
      .map((item) => {
        const body = chatTextWithReply(item.content, item.replyTo);
        return {
          role: item.role,
          content: item.attachments?.length
            ? `${body}\n[Fichiers: ${item.attachments.map((a) => a.filename).join(", ")}]`.trim()
            : body,
        };
      })
      .slice(-histLimit);

    const who = useMode === "quotidien" ? "assistant" : interlocutorRef.current;
    const applyChatData = (data: Record<string, unknown> | null | undefined, agent: string) => {
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
        return;
      }
      if (data?.status === "accepted" && data?.job_id) {
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
        return;
      }
      const surface = toChatSurface(String(data?.response || ""));
      const degraded = Boolean(data?.degraded) || chatTextIsDegraded(surface);
      const claimGuard = data?.claim_guard as ChatMsg["claimGuard"] | undefined;
      const pendingBlueprintId =
        String(data?.pending_blueprint_id || "") || blueprintIdFromText(surface) || undefined;
      setReplyProgress(null);
      setMessages([
        ...history,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: surface,
          agentKeys: [agent],
          ...(pendingBlueprintId ? { pendingBlueprintId } : {}),
          ...(degraded ? { degraded: true } : {}),
          ...(claimGuard?.status ? { claimGuard } : {}),
        },
      ]);
    };

    try {
      const { agent: parsedAgent, agentGroupId } = parseInterlocutor(who);
      const agent = useMode === "quotidien" ? "assistant" : parsedAgent;
      rememberInterlocutor(who);

      const requestBody = {
        message: chatTextWithReply(text, replyTo),
        agent,
        history: historyPayload,
        chat_session_id: activeId,
        chat_use_mode: useMode,
        ...(parentId ? { linked_job_id: parentId } : {}),
        ...(agentGroupId && useMode !== "quotidien" ? { agent_group_id: agentGroupId } : {}),
        ...(files.length ? { attachments: files } : {}),
        ...(opts?.confirmAction ? { confirm_action: true } : {}),
        thinking_mode: loadThinkingMode(),
      };

      // Quotidien sans pièce jointe : SSE (réponse immédiate).
      if (useMode === "quotidien" && files.length === 0 && !opts?.confirmAction) {
        streamAbortRef.current?.abort();
        const ac = new AbortController();
        streamAbortRef.current = ac;
        const streamMsgId = `a-stream-${Date.now()}`;
        setMessages([
          ...history,
          { id: streamMsgId, role: "assistant", content: "", agentKeys: ["assistant"] },
        ]);
        setReplyProgress({ percent: 35, label: "Réponse en cours" });
        const streamed = await postChatStream({
          body: requestBody,
          headers: agentHeaders(),
          signal: ac.signal,
          onDelta: (_chunk, full) => {
            if (!mountedRef.current) return;
            setMessages((prev) =>
              prev.map((m) => (m.id === streamMsgId ? { ...m, content: toChatSurface(full) } : m)),
            );
            setReplyProgress({ percent: 70, label: "Réponse en cours" });
          },
        });
        if (streamed.kind === "json") {
          applyChatData(streamed.data, agent);
          const status = String(streamed.data?.status || "");
          spoken =
            status === "needs_confirmation"
              ? "Rien n'est fait tant que vous ne confirmez pas."
              : status === "accepted"
                ? String(streamed.data?.mirror_ack || "").trim()
                : toChatSurface(String(streamed.data?.response || ""));
        } else {
          const surface = toChatSurface(streamed.text || streamed.done.response || "");
          spoken = surface;
          const degraded = Boolean(streamed.done.degraded) || chatTextIsDegraded(surface);
          const claimGuard = streamed.done.claim_guard as ChatMsg["claimGuard"] | undefined;
          const pendingBlueprintId =
            String(streamed.done.pending_blueprint_id || "") || blueprintIdFromText(surface) || undefined;
          setReplyProgress(null);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === streamMsgId
                ? {
                    ...m,
                    content: surface,
                    ...(pendingBlueprintId ? { pendingBlueprintId } : {}),
                    ...(degraded ? { degraded: true } : {}),
                    ...(claimGuard?.status ? { claimGuard } : {}),
                  }
                : m,
            ),
          );
        }
      } else {
        const { data } = await requestJson("/chat", {
          method: "POST",
          headers: agentHeaders(),
          timeoutMs: useMode === "quotidien" ? 90_000 : 25_000,
          body: JSON.stringify(requestBody),
        });
        applyChatData(data, agent);
        const status = String(data?.status || "");
        spoken =
          status === "needs_confirmation"
            ? "Rien n'est fait tant que vous ne confirmez pas."
            : status === "accepted"
              ? String(data?.mirror_ack || "").trim()
              : toChatSurface(String(data?.response || ""));
      }
    } catch (err) {
      const aborted =
        (err instanceof Error && (err.name === "AbortError" || /aborted|timeout/i.test(err.message))) &&
        streamAbortRef.current?.signal.aborted;
      if (aborted) {
        setReplyProgress(null);
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant" && last.id.startsWith("a-stream-") && !last.content.trim()) {
            return [
              ...prev.slice(0, -1),
              { ...last, id: `a-stop-${Date.now()}`, content: "Réponse arrêtée." },
            ];
          }
          return prev;
        });
      } else {
        const raw = err instanceof Error ? err.message : "Une erreur est survenue.";
        const degraded = isChatTransportFailure(err);
        const { agent: failAgent } = parseInterlocutor(who);
        spoken = degraded ? localDegradedChatReply(text, failAgent === "coordinateur" ? "CIO" : failAgent) : raw;
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
      }
    } finally {
      setPending(false);
      streamAbortRef.current = null;
    }
    return spoken;
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

  const fleetCandidates = useMemo(
    () => activeChatFleets((groupsList || []) as GroupOpt[]),
    [groupsList],
  );

  useEffect(() => {
    fleetCandidatesRef.current = fleetCandidates;
  }, [fleetCandidates]);

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
    void send({ text, reuseLastUser: true, attachments: lastUser?.attachments, replyTo: lastUser?.replyTo });
  }, [chooseInterlocutor, messages, send]);

  const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
  const showTeamOffer =
    interlocutor === "assistant" &&
    Boolean(lastUserMessage) &&
    messageWantsTeam(lastUserMessage?.content || "") &&
    teamOfferDismissedId !== lastUserMessage?.id &&
    !pending;
  const fleetAnchor = chatUseMode === "quotidien" ? fleetOfferAnchor(messages) : null;
  const showFleetOffer =
    Boolean(fleetAnchor) &&
    fleetCandidates.length > 0 &&
    fleetOfferDismissedId !== fleetAnchor?.id &&
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
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
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
            orbMood={orbMoodFromLabel(replyProgress?.label, pending || activePendingCount > 0)}
            subtitle={
              pending || activePendingCount > 0
                ? replyProgress?.label || "Je prépare"
                : chatUseMode === "quotidien"
                  ? "Prêt"
                  : interlocutorName
            }
            onOpenHistory={openHistory}
            historyOpen={historyOpen}
            historyAttention={
              conversations.some((c) => c.unread && c.id !== activeId) ||
              backgroundJobs.some((j) => j.conversationId !== activeId)
            }
            onOpenMore={() => setMoreSheetOpen(true)}
          />
          {missionJobId && chatUseMode !== "quotidien" ? (
            <div className="shrink-0 border-b border-slate-100">
              <MissionContextBanner jobId={missionJobId} />
            </div>
          ) : null}
          <ChatShell
            messages={messages}
            draft={draft}
            onDraftChange={setDraft}
            onSend={(replyTo) => void send(replyTo ? { replyTo } : undefined)}
            onVoiceUtterance={async (text) => (await send({ text })) || ""}
            onQuickSend={(text) => void send({ text })}
            pending={pending}
            backgroundJobCount={activePendingCount}
            backgroundProgress={activePendingCount > 0 || pending ? replyProgress : null}
            onStopReply={
              activePendingCount > 0 || pending ? () => void stopActiveReply() : undefined
            }
            onConfirmAction={(message, attachments) => void send({ confirmAction: true, text: message, attachments })}
            onDismissAction={dismissPendingAction}
            onSubmitChoiceAnswers={submitChoiceAnswers}
            teamOffer={showTeamOffer}
            onHandOffToTeam={handOffToTeam}
            onDismissTeamOffer={() => setTeamOfferDismissedId(lastUserMessage?.id || "dismissed")}
            fleetOffer={
              showFleetOffer ? fleetCandidates.map((fleet) => ({ id: fleet.id, label: fleet.label })) : []
            }
            onRelayToFleet={(groupId) => {
              const anchor = fleetOfferAnchor(messages);
              const fleet = fleetCandidates.find((item) => item.id === groupId);
              if (!anchor || !fleet) return;
              relayToFleet(groupId, anchor.text, messages, fleet.label);
            }}
            onDismissFleetOffer={() => setFleetOfferDismissedId(fleetAnchor?.id || "dismissed")}
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
            chatUseMode={chatUseMode}
            reformChips={CHAT_QUICK_CHIPS}
            onTeamCreated={(groupId) => {
              chooseInterlocutor(interlocutorFromGroupId(groupId));
              void qc.invalidateQueries({ queryKey: ["agent-groups"] });
              void qc.invalidateQueries({ queryKey: QK.agents });
            }}
          />
        </div>
      </div>

      <ChatHistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        conversations={conversations}
        activeId={activeId}
        pendingJobs={backgroundJobs}
        onSelect={selectConversation}
        onNew={newConversation}
        onDelete={(id) => void removeConversation(id)}
        onDeleteMany={(ids) => removeConversations(ids)}
        interlocutorLabel={interlocutorLabel}
        chatUseMode={chatUseMode}
        onChatUseModeChange={applyChatUseMode}
        onOpenPerso={openPersoThread}
        onOpenSettings={() => {
          setHistoryOpen(false);
          setMoreSheetOpen(true);
        }}
        activeTitle={activeConv?.title || "Chat"}
        pinned={Boolean(activeConv?.pinned)}
        onRename={renameActiveConversation}
        onTogglePin={togglePinActiveConversation}
        onCopy={copyActiveConversation}
        canConvert={canConvertToMission && chatUseMode !== "quotidien"}
        onConvert={() => {
          setHistoryOpen(false);
          openConvertPreview();
        }}
        missionJobId={missionJobId || undefined}
        onOpenMission={
          missionJobId
            ? () => {
                setHistoryOpen(false);
                router.push(`/missions?job=${encodeURIComponent(missionJobId)}`);
              }
            : undefined
        }
        interlocutor={interlocutor}
        groups={groupsList as GroupOpt[]}
        onInterlocutorChange={chooseInterlocutor}
        interlocutorDisabled={pending}
      />

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
        chatUseMode={chatUseMode}
        onChatUseModeChange={applyChatUseMode}
        onOpenPerso={openPersoThread}
      />
    </div>
  );
}
