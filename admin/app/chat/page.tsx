"use client";

import { FormEvent, KeyboardEvent, Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import AgentMessageMarkdown from "../../components/AgentMessageMarkdown";
import MissionEventTimeline from "../../components/MissionEventTimeline";
import { missionThreadToChatHistory } from "../../lib/missionFollowupChat";
import { agentHeaders, requestJson } from "../../lib/api";
import { QK } from "../../lib/queryClient";

type Msg = { role: "user" | "assistant"; content: string; agent?: string };
type Conversation = {
  id: string;
  title: string;
  agent: string;
  draft: string;
  history: Msg[];
  liveJobId: string | null;
};

const chatMessageKey = (m: Msg, idx: number) =>
  `${m.role}-${m.agent || "na"}-${m.content.slice(0, 32)}-${idx}`;
const sameMessage = (a: Msg, b: Msg) => a.role === b.role && a.content === b.content && (a.agent || "") === (b.agent || "");

const makeConversation = (idx: number): Conversation => ({
  id: `conv-${Date.now()}-${idx}`,
  title: `Conversation ${idx}`,
  agent: "coordinateur",
  draft: "",
  history: [],
  liveJobId: null,
});
const FIRST_CONVERSATION = makeConversation(1);
const CHAT_STORAGE_KEY = "korymb-admin-chat-conversations-v1";
const CHAT_ACTIVE_KEY = "korymb-admin-chat-active-conversation-v1";

const normalizeConversations = (raw: unknown): Conversation[] => {
  if (!Array.isArray(raw)) return [];
  const normalized = raw
    .map((item, idx) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Partial<Conversation>;
      if (!Array.isArray(row.history)) return null;
      const history: Msg[] = row.history
        .filter((m) => m && typeof m === "object")
        .map((m) => {
          const itemRow = m as Partial<Msg>;
          return {
            role: itemRow.role === "assistant" ? "assistant" : "user",
            content: String(itemRow.content || ""),
            ...(itemRow.agent ? { agent: String(itemRow.agent) } : {}),
          };
        });
      return {
        id: String(row.id || `conv-restored-${Date.now()}-${idx}`),
        title: String(row.title || `Conversation ${idx + 1}`),
        agent: String(row.agent || "coordinateur"),
        draft: String(row.draft || ""),
        history,
        liveJobId: row.liveJobId ? String(row.liveJobId) : null,
      };
    })
    .filter(Boolean);
  return normalized as Conversation[];
};

function ChatPageInner() {
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const linkedParentJobId = (searchParams.get("parent") || "").trim().slice(0, 16);
  const seededParentRef = useRef("");
  const processedLiveJobsRef = useRef<Record<string, boolean>>({});
  const [conversations, setConversations] = useState<Conversation[]>([FIRST_CONVERSATION]);
  const [activeConversationId, setActiveConversationId] = useState<string>(FIRST_CONVERSATION.id);
  const [busyConversationId, setBusyConversationId] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [mobilePane, setMobilePane] = useState<"list" | "chat">("chat");

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConversationId) || conversations[0],
    [activeConversationId, conversations],
  );
  const activeAgent = activeConversation?.agent || "coordinateur";
  const activeDraft = activeConversation?.draft || "";
  const activeHistory = activeConversation?.history || [];
  const activeLiveJobId = activeConversation?.liveJobId || null;
  const isBusyActiveConversation = busyConversationId === activeConversationId;

  const agents = useQuery({
    queryKey: QK.agents,
    queryFn: async () => (await requestJson("/agents", { retries: 1 })).data.agents || [],
  });

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CHAT_STORAGE_KEY);
      const activeRaw = localStorage.getItem(CHAT_ACTIVE_KEY);
      const parsed = raw ? normalizeConversations(JSON.parse(raw)) : [];
      if (parsed.length) {
        setConversations(parsed);
        const savedActive = String(activeRaw || "");
        const exists = parsed.some((c) => c.id === savedActive);
        setActiveConversationId(exists ? savedActive : parsed[0].id);
      }
    } catch {
      // Ignore bad local storage payloads and continue with defaults.
    }
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(conversations));
  }, [conversations, isHydrated]);

  useEffect(() => {
    if (!isHydrated) return;
    localStorage.setItem(CHAT_ACTIVE_KEY, activeConversationId);
  }, [activeConversationId, isHydrated]);

  const parentJobDetail = useQuery({
    queryKey: ["chat-parent-job", linkedParentJobId],
    enabled: Boolean(linkedParentJobId),
    queryFn: async () =>
      (
        await requestJson(`/jobs/${encodeURIComponent(linkedParentJobId)}?log_offset=0&events_offset=0`, {
          headers: agentHeaders(),
          retries: 1,
        })
      ).data,
  });

  useEffect(() => {
    if (!linkedParentJobId) {
      seededParentRef.current = "";
      return;
    }
    if (!parentJobDetail.data) return;
    if (seededParentRef.current === linkedParentJobId) return;
    seededParentRef.current = linkedParentJobId;
    const thread = (parentJobDetail.data as { mission_thread?: unknown }).mission_thread;
    const seeded = missionThreadToChatHistory(thread, 60).map((m) => ({
      role: m.role,
      content: m.content,
      agent: m.role === "assistant" ? "coordinateur" : undefined,
    }));
    const linkedId = `linked-${linkedParentJobId}`;
    const seededConversation: Conversation = {
      id: linkedId,
      title: `Mission #${linkedParentJobId}`,
      agent: "coordinateur",
      draft: "",
      history: seeded,
      liveJobId: null,
    };
    setConversations((prev) => {
      const existing = prev.find((c) => c.id === linkedId);
      const mergedHistory = existing
        ? [
            ...existing.history,
            ...seeded.filter((m) => !existing.history.some((h) => sameMessage(h, m))),
          ]
        : seededConversation.history;
      const mergedConversation: Conversation = {
        ...(existing || seededConversation),
        id: linkedId,
        title: `Mission #${linkedParentJobId}`,
        history: mergedHistory,
      };
      const withoutLinked = prev.filter((c) => c.id !== linkedId);
      return [mergedConversation, ...withoutLinked];
    });
    setActiveConversationId(linkedId);
  }, [linkedParentJobId, parentJobDetail.data]);

  const liveConversations = useMemo(
    () => conversations.filter((c) => c.liveJobId).map((c) => ({ id: c.id, liveJobId: String(c.liveJobId) })),
    [conversations],
  );

  const liveQueries = useQueries({
    queries: liveConversations.map((c) => ({
      queryKey: ["chat-live", c.liveJobId],
      queryFn: async () =>
        (await requestJson(`/jobs/${encodeURIComponent(c.liveJobId)}?log_offset=0&events_offset=0`, { headers: agentHeaders(), retries: 1 })).data,
      refetchInterval: () => (typeof document !== "undefined" && document.visibilityState === "visible" ? 1500 : false),
    })),
  });

  const activeLive = useMemo(() => {
    const idx = liveConversations.findIndex((c) => c.id === activeConversationId);
    if (idx < 0) return null;
    return liveQueries[idx]?.data || null;
  }, [activeConversationId, liveConversations, liveQueries]);

  const sendActiveMessage = async () => {
    if (!activeConversation || !activeDraft.trim() || busyConversationId || activeLiveJobId) return;
    const msg = activeDraft.trim();
    setConversations((prev) =>
      prev.map((c) => (c.id === activeConversation.id ? { ...c, draft: "", history: [...c.history, { role: "user", content: msg }] } : c)),
    );
    setBusyConversationId(activeConversation.id);
    try {
      const { data } = await requestJson("/chat", {
        method: "POST",
        headers: agentHeaders(),
        timeoutMs: 20000,
        body: JSON.stringify({
          message: msg,
          agent: activeAgent,
          history: activeHistory,
          chat_session_id: activeConversation.id,
          ...(linkedParentJobId && activeAgent === "coordinateur" ? { linked_job_id: linkedParentJobId } : {}),
        }),
      });
      if (activeAgent === "coordinateur" && data?.status === "accepted" && data?.job_id) {
        setConversations((prev) =>
          prev.map((c) => (c.id === activeConversation.id ? { ...c, liveJobId: String(data.job_id) } : c)),
        );
      } else {
        setConversations((prev) =>
          prev.map((c) =>
            c.id === activeConversation.id
              ? { ...c, history: [...c.history, { role: "assistant", content: String(data?.response || ""), agent: activeAgent }] }
              : c,
          ),
        );
      }
      qc.invalidateQueries({ queryKey: QK.jobs });
      qc.invalidateQueries({ queryKey: QK.tokens });
    } catch (err) {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeConversation.id
            ? { ...c, history: [...c.history, { role: "assistant", content: err instanceof Error ? err.message : String(err), agent: activeAgent }] }
            : c,
        ),
      );
    } finally {
      setBusyConversationId(null);
    }
  };

  const onSend = async (e: FormEvent) => {
    e.preventDefault();
    await sendActiveMessage();
  };

  useEffect(() => {
    liveConversations.forEach((conv, idx) => {
      const data = liveQueries[idx]?.data as { result?: unknown; status?: unknown } | undefined;
      if (!data) return;
      const status = String(data.status || "");
      const done = status === "completed" || status.startsWith("error");
      if (!done) return;
      const marker = `${conv.id}:${conv.liveJobId}`;
      if (processedLiveJobsRef.current[marker]) return;
      processedLiveJobsRef.current[marker] = true;
      const result = String(data.result || "");
      setConversations((prev) =>
        prev.map((row) => {
          if (row.id !== conv.id || row.liveJobId !== conv.liveJobId) return row;
          if (result.trim()) {
            return {
              ...row,
              liveJobId: null,
              history: [...row.history, { role: "assistant", content: result, agent: "coordinateur" }],
            };
          }
          if (status.startsWith("error")) {
            const fromStatus = status.replace(/^error:\s*/i, "").trim();
            return {
              ...row,
              liveJobId: null,
              history: [
                ...row.history,
                {
                  role: "assistant",
                  content:
                    fromStatus ||
                    "La mission s'est terminée en erreur. Ouvre l'onglet Missions : le journal d'exécution peut contenir plus de détails.",
                  agent: "coordinateur",
                },
              ],
            };
          }
          return { ...row, liveJobId: null };
        }),
      );
      if (linkedParentJobId) {
        void qc.invalidateQueries({ queryKey: ["job-detail-live", linkedParentJobId] });
        void qc.invalidateQueries({ queryKey: ["chat-parent-job", linkedParentJobId] });
      }
    });
  }, [linkedParentJobId, liveConversations, liveQueries, qc]);

  const createConversation = () => {
    const next = makeConversation(conversations.length + 1);
    setConversations((prev) => [...prev, next]);
    setActiveConversationId(next.id);
  };

  const deleteActiveConversation = () => {
    if (!activeConversation) return;
    if (conversations.length === 1) {
      const reset = makeConversation(1);
      setConversations([reset]);
      setActiveConversationId(reset.id);
      return;
    }
    const idx = conversations.findIndex((c) => c.id === activeConversation.id);
    if (idx < 0) return;
    const nextConversations = conversations.filter((c) => c.id !== activeConversation.id);
    setConversations(nextConversations);
    const nextActive = nextConversations[Math.max(0, idx - 1)] || nextConversations[0];
    setActiveConversationId(nextActive.id);
  };

  const onDraftKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendActiveMessage();
    }
  };

  const pickConversation = (id: string) => {
    setActiveConversationId(id);
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches) {
      setMobilePane("chat");
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Chat</h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500">
          Avec le <span className="font-medium text-slate-700">coordinateur</span>, une mission peut partir en arrière-plan : la
          synthèse finale revient ici, et le détail multi-agents vit sur{" "}
          <Link href="/missions" className="font-medium text-violet-800 hover:underline">
            Missions
          </Link>{" "}
          (réponse CIO en tête de panneau).
        </p>
        {linkedParentJobId ? (
          <p className="mt-2 text-xs font-medium text-violet-900">
            Reprise liée à la mission{" "}
            <Link href={`/missions?job=${encodeURIComponent(linkedParentJobId)}`} className="font-mono underline">
              #{linkedParentJobId}
            </Link>{" "}
            — le CIO reçoit le contexte et l’historique de cette mission.
          </p>
        ) : null}
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white grid grid-cols-1 lg:grid-cols-[minmax(0,280px)_1fr]">
        <div className="mobile-tab-bar mx-3 mt-3 lg:hidden">
          <button
            type="button"
            onClick={() => setMobilePane("list")}
            className={`mobile-tab ${mobilePane === "list" ? "mobile-tab-active" : "mobile-tab-inactive"}`}
          >
            Conversations
          </button>
          <button
            type="button"
            onClick={() => setMobilePane("chat")}
            className={`mobile-tab ${mobilePane === "chat" ? "mobile-tab-active" : "mobile-tab-inactive"}`}
          >
            Discussion
          </button>
        </div>
        <aside
          className={`border-b border-slate-100 bg-slate-50/60 p-3 space-y-2 lg:border-b-0 lg:border-r ${
            mobilePane === "list" ? "block" : "hidden lg:block"
          }`}
        >
          <button
            type="button"
            onClick={() => {
              createConversation();
              setMobilePane("chat");
            }}
            className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50 active:bg-slate-100"
          >
            Nouvelle conversation
          </button>
          <div className="h-app-panel space-y-1 overflow-y-auto pr-1 lg:max-h-[56vh]">
            {conversations.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => pickConversation(c.id)}
                className={`min-h-[44px] w-full rounded-lg border px-3 py-2.5 text-left text-sm ${
                  c.id === activeConversationId
                    ? "border-violet-200 bg-white text-violet-900"
                    : "border-slate-200 bg-white/80 text-slate-700 hover:bg-white"
                }`}
              >
                <p className="truncate font-medium">{c.title}</p>
                <p className="mt-0.5 text-xs text-slate-500">{c.history.length} message(s)</p>
              </button>
            ))}
          </div>
        </aside>
        <div className={mobilePane === "chat" ? "flex min-h-0 min-w-0 flex-col" : "hidden min-h-0 min-w-0 flex-col lg:flex"}>
          <div className="flex flex-col gap-3 border-b border-slate-100 p-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2 sm:p-4">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="shrink-0 text-xs text-slate-500">Agent</span>
              <select
                value={activeAgent}
                onChange={(e) =>
                  setConversations((prev) => prev.map((c) => (c.id === activeConversationId ? { ...c, agent: e.target.value } : c)))
                }
                className="min-h-[44px] min-w-[8rem] flex-1 rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm sm:flex-none"
              >
                {(agents.data || []).map((a: { key: string; label: string }) => (
                  <option key={a.key} value={a.key}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>
            <input
              value={activeConversation?.title || ""}
              onChange={(e) =>
                setConversations((prev) =>
                  prev.map((c) => (c.id === activeConversationId ? { ...c, title: e.target.value || "Sans titre" } : c)),
                )
              }
              className="min-h-[44px] w-full min-w-0 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm sm:flex-1"
              placeholder="Nom de la conversation"
            />
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:ml-auto">
              <button
                type="button"
                onClick={deleteActiveConversation}
                className="min-h-[44px] rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 active:bg-slate-200"
              >
                Supprimer
              </button>
              {activeLiveJobId ? (
                <span className="text-xs font-medium text-amber-700">Live #{activeLiveJobId}</span>
              ) : null}
            </div>
          </div>
          <div className="h-app-panel flex-1 space-y-3 overflow-y-auto p-3 sm:p-4 lg:max-h-[58vh]">
            {!activeHistory.length ? <p className="text-sm text-slate-500">Commencez la conversation avec votre premier message.</p> : null}
            {activeHistory.map((m, i) => (
              <div key={chatMessageKey(m, i)} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${m.role === "user" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-800"}`}
                >
                  {m.role === "user" ? (
                    <span className="whitespace-pre-wrap leading-relaxed">{m.content}</span>
                  ) : (
                    <AgentMessageMarkdown source={m.content} />
                  )}
                </div>
              </div>
            ))}
            {activeLiveJobId ? (
              <div className="space-y-3 text-xs text-slate-600 bg-violet-50 border border-violet-100 rounded-xl p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p>
                    Orchestration CIO en cours… statut:{" "}
                    <span className="font-mono font-semibold text-violet-900">{String(activeLive?.status || "running")}</span>
                  </p>
                  <Link
                    href={`/missions?job=${encodeURIComponent(activeLiveJobId)}`}
                    className="rounded-lg bg-white px-2 py-1 text-[11px] font-medium text-violet-900 border border-violet-200 hover:bg-violet-100"
                  >
                    Ouvrir la mission
                  </Link>
                </div>
                <MissionEventTimeline
                  events={(activeLive as { events?: unknown[] } | null)?.events}
                  title="Qui fait quoi (temps reel)"
                  maxHeightClass="max-h-52"
                />
              </div>
            ) : null}
          </div>
          <form onSubmit={onSend} className="shrink-0 border-t border-slate-100 p-3 pb-safe sm:p-4">
            <div className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2 shadow-sm">
            <textarea
              value={activeDraft}
              onChange={(e) =>
                setConversations((prev) => prev.map((c) => (c.id === activeConversationId ? { ...c, draft: e.target.value } : c)))
              }
              onKeyDown={onDraftKeyDown}
              disabled={isBusyActiveConversation || Boolean(activeLiveJobId)}
              rows={3}
              className="min-h-[44px] flex-1 resize-none bg-transparent px-2 py-2 text-base leading-relaxed outline-none sm:text-sm"
              placeholder="Message au CIO…"
              enterKeyHint="send"
            />
            <button
              disabled={isBusyActiveConversation || Boolean(activeLiveJobId) || !activeDraft.trim()}
              className="min-h-[44px] shrink-0 rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-violet-800 disabled:opacity-40"
            >
              {isBusyActiveConversation ? "Envoi..." : "Envoyer"}
            </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="p-6 text-slate-500">Chargement du chat…</div>}>
      <ChatPageInner />
    </Suspense>
  );
}
