"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ChatShell, { type ChatMsg } from "../../components/chat/ChatShell";
import ChatSidebar from "../../components/chat/ChatSidebar";
import ChatInterlocutorSelect, {
  interlocutorFromGroupId,
  parseInterlocutor,
  type GroupOpt,
} from "../../components/chat/ChatInterlocutorSelect";
import MissionContextBanner from "../../components/MissionContextBanner";
import { businessApi } from "../../lib/business";
import { CHAT_FILE_MAX, type ChatFile } from "../../lib/chatAttachments";
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
  hydrateConversationsFromServer,
  loadConversations,
  setActiveConversationId,
  upsertConversation,
  type ChatConversation,
} from "../../lib/chatSessions";
import { agentHeaders, requestJson } from "../../lib/api";
import { toChatSurface } from "../../lib/chatSurface";
import { fetchJobAgentKeys, type ChatJobDelivery } from "../../lib/chatJobAgents";
import { buildMissionBriefFromChat } from "../../lib/chatMissionConvert";
import {
  confirmDeleteChatConversation,
  deleteChatConversationJobs,
} from "../../lib/deleteChatConversation";
import { invalidateAfterMissionDelete } from "../../lib/deleteMissionBundle";
import { JOB_ID_MAX_LEN } from "../../lib/missionBossView";
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
  const linkedParentJobId = (searchParams.get("parent") || "").trim().slice(0, JOB_ID_MAX_LEN);
  const urlSessionId = (searchParams.get("session") || "").trim();
  const highlightJobId = (searchParams.get("job") || "").trim().slice(0, JOB_ID_MAX_LEN);
  const urlGroupId = (searchParams.get("group") || "").trim();

  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [backgroundJobs, setBackgroundJobs] = useState<PendingChatJob[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [convertBusy, setConvertBusy] = useState(false);
  const [convertBrief, setConvertBrief] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<ChatFile[]>([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [interlocutor, setInterlocutor] = useState(() =>
    urlGroupId ? interlocutorFromGroupId(urlGroupId) : "assistant",
  );
  const pollingRef = useRef<Set<string>>(new Set());
  const activeIdRef = useRef<string | null>(null);
  const initRef = useRef(false);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    if (!urlGroupId) return;
    setInterlocutor(interlocutorFromGroupId(urlGroupId));
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

    void (async () => {
      let list = await hydrateConversationsFromServer();
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
    })();
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
      setPendingFiles([]);
      setUploadError("");
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
    setPendingFiles([]);
    setUploadError("");
    setSidebarOpen(false);
    refreshConversations();
    router.replace(`/chat?session=${encodeURIComponent(conv.id)}`, { scroll: false });
  }, [activeId, messages, persistActiveConversation, refreshConversations, router]);

  const removeConversation = useCallback(
    async (id: string) => {
      if (!confirmDeleteChatConversation()) return;
      const conv = loadConversations().find((c) => c.id === id);
      const convMessages = id === activeId ? messages : (conv?.messages ?? []);
      try {
        await deleteChatConversationJobs(id, convMessages);
        invalidateAfterMissionDelete(qc);
      } catch (err) {
        if (typeof window !== "undefined") {
          window.alert(err instanceof Error ? err.message : String(err));
        }
        return;
      }
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
    [activeId, messages, newConversation, qc, refreshConversations, selectConversation],
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
      }
      if (!isActive || document.hidden) {
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

  const send = useCallback(async () => {
    const text = draft.trim();
    const files = pendingFiles.slice(0, CHAT_FILE_MAX);
    if ((!text && files.length === 0) || pending || !activeId || uploadBusy) return;

    const userMsg: ChatMsg = {
      id: `u-${Date.now()}`,
      role: "user",
      content: text,
      ...(files.length ? { attachments: files } : {}),
    };
    const history = [...messages, userMsg];
    setMessages(history);
    setDraft("");
    setPendingFiles([]);
    setUploadError("");
    setPending(true);

    const conv = loadConversations().find((c) => c.id === activeId);
    const parentId = conv?.linkedParentJobId || linkedParentJobId || undefined;
    const historyPayload = messages.map(({ role, content, attachments }) => ({
      role,
      content: attachments?.length
        ? `${content}\n[Fichiers: ${attachments.map((a) => a.filename).join(", ")}]`.trim()
        : content,
    }));

    try {
      const { agent, agentGroupId } = parseInterlocutor(interlocutor);
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
        }),
      });

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
      } else {
        const surface = toChatSurface(String(data?.response || ""));
        setMessages([
          ...history,
          {
            id: `a-${Date.now()}`,
            role: "assistant",
            content: surface,
            agentKeys: [agent],
          },
        ]);
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
    interlocutor,
    pendingFiles,
    uploadBusy,
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
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col bg-white lg:border-x lg:border-slate-200">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-slate-200 px-1.5 sm:px-2 lg:hidden">
        <button
          type="button"
          onClick={() => setSidebarOpen((v) => !v)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100 lg:hidden"
          aria-label={sidebarOpen ? "Fermer les conversations" : "Conversations"}
          aria-expanded={sidebarOpen}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path strokeLinecap="round" d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
          </svg>
        </button>
        <p className="min-w-0 flex-1 truncate px-1 text-sm font-semibold text-slate-800">
          {conversations.find((c) => c.id === activeId)?.title || "Chat"}
        </p>
        <ChatInterlocutorSelect
          value={interlocutor}
          onChange={setInterlocutor}
          groups={groupsList as GroupOpt[]}
          disabled={pending}
          variant="compact"
        />
        <button
          type="button"
          onClick={newConversation}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100 lg:hidden"
          aria-label="Nouvelle conversation"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path strokeLinecap="round" d="M12 5v14M5 12h14" />
          </svg>
        </button>
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
          <div className="hidden shrink-0 items-center gap-3 border-b border-slate-100 px-3 py-2 lg:flex">
            <ChatInterlocutorSelect
              value={interlocutor}
              onChange={setInterlocutor}
              groups={groupsList as GroupOpt[]}
              disabled={pending}
              variant="full"
            />
          </div>
          {linkedParentJobId ? (
            <div className="shrink-0 border-b border-slate-100">
              <MissionContextBanner jobId={linkedParentJobId} />
            </div>
          ) : null}
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
              setInterlocutor(interlocutorFromGroupId(groupId));
              void qc.invalidateQueries({ queryKey: ["agent-groups"] });
              void qc.invalidateQueries({ queryKey: QK.agents });
            }}
          />
        </div>
      </div>
    </div>
  );
}
