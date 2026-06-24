"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ChatShell, { type ChatMsg } from "../../components/chat/ChatShell";
import ChatSidebar from "../../components/chat/ChatSidebar";
import {
  addPendingChatJob,
  loadPendingChatJobs,
  pendingJobsForConversation,
  removePendingChatJob,
  type PendingChatJob,
} from "../../lib/chatPendingJobs";
import {
  conversationTitleFromMessages,
  createConversation,
  deleteConversation,
  getActiveConversationId,
  loadConversations,
  setActiveConversationId,
  upsertConversation,
  type ChatConversation,
} from "../../lib/chatSessions";
import { agentHeaders, requestJson } from "../../lib/api";
import { toChatSurface } from "../../lib/chatSurface";
import { fetchJobAgentKeys, type ChatJobDelivery } from "../../lib/chatJobAgents";
import { buildMissionBriefFromChat } from "../../lib/chatMissionConvert";
import { QK } from "../../lib/queryClient";

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
  const searchParams = useSearchParams();
  const linkedParentJobId = (searchParams.get("parent") || "").trim().slice(0, 16);
  const urlSessionId = (searchParams.get("session") || "").trim();
  const highlightJobId = (searchParams.get("job") || "").trim().slice(0, 16);

  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [backgroundJobs, setBackgroundJobs] = useState<PendingChatJob[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [convertBusy, setConvertBusy] = useState(false);
  const pollingRef = useRef<Set<string>>(new Set());
  const activeIdRef = useRef<string | null>(null);
  const initRef = useRef(false);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  const refreshConversations = useCallback(() => {
    setConversations(loadConversations());
    setBackgroundJobs(loadPendingChatJobs());
  }, []);

  const persistActiveConversation = useCallback(
    (nextMessages: ChatMsg[], extra?: Partial<ChatConversation>) => {
      const id = activeIdRef.current;
      if (!id) return;
      const existing = loadConversations().find((c) => c.id === id);
      const conv: ChatConversation = {
        id,
        title: conversationTitleFromMessages(nextMessages),
        messages: nextMessages,
        updatedAt: Date.now(),
        linkedParentJobId: existing?.linkedParentJobId || linkedParentJobId || undefined,
        unread: extra?.unread ?? false,
        unreadPreview: extra?.unreadPreview,
        ...extra,
      };
      upsertConversation(conv);
      refreshConversations();
    },
    [linkedParentJobId, refreshConversations],
  );

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    let list = loadConversations();
    let active = urlSessionId || getActiveConversationId();

    if (linkedParentJobId) {
      const linked = list.find((c) => c.linkedParentJobId === linkedParentJobId);
      if (linked) {
        active = linked.id;
      } else if (!list.length) {
        const conv = createConversation({ linkedParentJobId });
        list = [conv];
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
    setBackgroundJobs(loadPendingChatJobs());
    setHydrated(true);
    void requestBrowserNotificationPermission();
  }, [linkedParentJobId, urlSessionId]);

  const selectConversation = useCallback(
    (id: string) => {
      if (id === activeId) {
        setSidebarOpen(false);
        return;
      }
      if (activeId) {
        persistActiveConversation(messages);
      }
      const conv = loadConversations().find((c) => c.id === id);
      if (!conv) return;
      const cleared = { ...conv, unread: false, unreadPreview: undefined };
      upsertConversation(cleared);
      setActiveId(id);
      setActiveConversationId(id);
      setMessages(conv.messages);
      setDraft("");
      setSidebarOpen(false);
      refreshConversations();
      router.replace(`/chat?session=${encodeURIComponent(id)}`, { scroll: false });
    },
    [activeId, messages, persistActiveConversation, refreshConversations, router],
  );

  const newConversation = useCallback(() => {
    if (activeId) persistActiveConversation(messages);
    const conv = createConversation();
    upsertConversation(conv);
    setActiveId(conv.id);
    setActiveConversationId(conv.id);
    setMessages([]);
    setDraft("");
    setSidebarOpen(false);
    refreshConversations();
    router.replace(`/chat?session=${encodeURIComponent(conv.id)}`, { scroll: false });
  }, [activeId, messages, persistActiveConversation, refreshConversations, router]);

  const removeConversation = useCallback(
    (id: string) => {
      if (typeof window !== "undefined" && !window.confirm("Supprimer cette conversation ?")) return;
      deleteConversation(id);
      const remaining = loadConversations();
      const jobs = loadPendingChatJobs().filter((j) => j.conversationId !== id);
      localStorage.setItem("korymb-chat-pending-jobs-v1", JSON.stringify(jobs));
      if (activeId === id) {
        if (remaining.length) {
          selectConversation(remaining[0].id);
        } else {
          newConversation();
        }
      } else {
        refreshConversations();
        setBackgroundJobs(jobs);
      }
    },
    [activeId, newConversation, refreshConversations, selectConversation],
  );

  useEffect(() => {
    if (!hydrated || !activeId) return;
    persistActiveConversation(messages);
  }, [messages, hydrated, activeId, persistActiveConversation]);

  const pollJob = useCallback(async (jobId: string) => {
    for (let i = 0; i < 240; i++) {
      const { data } = await requestJson(`/jobs/${encodeURIComponent(jobId)}?log_offset=0&events_offset=0`, {
        headers: agentHeaders(),
        retries: 1,
      });
      const status = String(data.status || "");
      if (status === "completed") {
        return {
          surface: toChatSurface(String(data.result_surface || data.result || "")),
          jobId,
          driveArtifacts: (data.drive_artifacts || []) as ChatJobDelivery["driveArtifacts"],
          deliverablesMarkdown: String(data.result || ""),
        };
      }
      if (status.startsWith("error")) {
        throw new Error(status.replace(/^error:\s*/i, "") || "Erreur mission");
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error("Délai dépassé — ouvrez la conversation depuis le bandeau.");
  }, []);

  const deliverJobResult = useCallback(
    async (job: PendingChatJob, delivery: { surface: string; driveArtifacts?: unknown[]; deliverablesMarkdown?: string } | string, isError = false) => {
      const surface = typeof delivery === "string" ? delivery : delivery.surface;
      const driveArtifacts = typeof delivery === "string" ? undefined : delivery.driveArtifacts;
      const deliverablesMarkdown = typeof delivery === "string" ? undefined : delivery.deliverablesMarkdown;
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
      if (!isError) {
        try {
          const keys = await fetchJobAgentKeys(job.jobId);
          const delegated = keys.filter((k) => k !== "coordinateur");
          agentKeys = delegated.length ? delegated : ["coordinateur"];
        } catch {
          agentKeys = ["coordinateur"];
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

      if (isActive) {
        setMessages(nextMessages);
      } else {
        pushBrowserNotification(
          isError ? "Échec — conversation" : "Réponse prête",
          `${conv.title} — ${preview || "Nouvelle réponse dans le chat."}`,
          job.jobId,
        );
      }

      removePendingChatJob(job.jobId);
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
          const delivery = await pollJob(job.jobId);
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

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || pending || !activeId) return;

    const userMsg: ChatMsg = { id: `u-${Date.now()}`, role: "user", content: text };
    const history = [...messages, userMsg];
    setMessages(history);
    setDraft("");
    setPending(true);

    const conv = loadConversations().find((c) => c.id === activeId);
    const parentId = conv?.linkedParentJobId || linkedParentJobId || undefined;

    try {
      const { data } = await requestJson("/chat", {
        method: "POST",
        headers: agentHeaders(),
        timeoutMs: 25_000,
        body: JSON.stringify({
          message: text,
          agent: "coordinateur",
          history: messages.map(({ role, content }) => ({ role, content })),
          chat_session_id: activeId,
          ...(parentId ? { linked_job_id: parentId } : {}),
        }),
      });

      if (data?.status === "accepted" && data?.job_id) {
        const jobId = String(data.job_id);
        const mirror = String(data.mirror_ack || "").trim();
        const withAck: ChatMsg[] = [
          ...history,
          ...(mirror
            ? [{ id: `ack-${jobId}`, role: "assistant" as const, content: mirror, agentKeys: ["coordinateur"] }]
            : []),
        ];
        setMessages(withAck);
        const pendingJob: PendingChatJob = {
          jobId,
          conversationId: activeId,
          startedAt: Date.now(),
          linkedParentJobId: parentId,
          userPreview: stripMarkdownPreview(text, 80),
        };
        addPendingChatJob(pendingJob);
        refreshConversations();
        watchJobInBackground(pendingJob);
      } else {
        const surface = toChatSurface(String(data?.response || ""));
        setMessages([...history, { id: `a-${Date.now()}`, role: "assistant", content: surface }]);
      }
    } catch (err) {
      setMessages([
        ...history,
        {
          id: `e-${Date.now()}`,
          role: "assistant",
          content: err instanceof Error ? err.message : "Une erreur est survenue.",
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
    linkedParentJobId,
    watchJobInBackground,
    refreshConversations,
  ]);

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

  const convertToMission = useCallback(async () => {
    if (!activeId || convertBusy) return;
    const title = conversations.find((c) => c.id === activeId)?.title;
    setConvertBusy(true);
    try {
      const brief = buildMissionBriefFromChat(messages, title);
      const { data } = await requestJson("/run", {
        method: "POST",
        headers: agentHeaders(),
        body: JSON.stringify({ mission: brief, agent: "coordinateur" }),
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
  }, [activeId, convertBusy, conversations, messages, persistActiveConversation, router]);

  if (!hydrated || !activeId) {
    return <div className="p-6 text-center text-slate-500">Chargement…</div>;
  }

  const activePendingCount = pendingJobsForConversation(activeId).length;
  const canConvertToMission =
    messages.some((m) => m.role === "user") &&
    messages.some((m) => m.role === "assistant") &&
    activePendingCount === 0 &&
    !pending;

  return (
    <div className="mx-auto flex h-[calc(100dvh-10rem)] max-w-6xl flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 lg:hidden">
        <button
          type="button"
          onClick={() => setSidebarOpen((v) => !v)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800"
        >
          Conversations
        </button>
        <p className="truncate text-sm font-medium text-slate-600">
          {conversations.find((c) => c.id === activeId)?.title || "Chat"}
        </p>
      </div>

      <div className="relative flex min-h-0 flex-1">
        {sidebarOpen ? (
          <button
            type="button"
            className="absolute inset-0 z-10 bg-slate-950/40 lg:hidden"
            aria-label="Fermer le panneau conversations"
            onClick={() => setSidebarOpen(false)}
          />
        ) : null}

        <ChatSidebar
          conversations={conversations}
          activeId={activeId}
          pendingJobs={backgroundJobs}
          onSelect={selectConversation}
          onNew={newConversation}
          onDelete={removeConversation}
          className={`absolute inset-y-0 left-0 z-20 shadow-xl lg:relative lg:shadow-none ${
            sidebarOpen ? "flex" : "hidden lg:flex"
          }`}
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <ChatShell
            messages={messages}
            draft={draft}
            onDraftChange={setDraft}
            onSend={() => void send()}
            pending={pending}
            backgroundJobCount={activePendingCount}
            className="h-full max-w-none"
            agentLabels={agentLabels}
            onPatchMessage={patchMessage}
            onConvertToMission={() => void convertToMission()}
            convertBusy={convertBusy}
            canConvertToMission={canConvertToMission}
          />
        </div>
      </div>
    </div>
  );
}
