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

const makeConversation = (idx: number): Conversation => ({
  id: `conv-${Date.now()}-${idx}`,
  title: `Conversation ${idx}`,
  agent: "coordinateur",
  draft: "",
  history: [],
  liveJobId: null,
});
const FIRST_CONVERSATION = makeConversation(1);
const CHAT_STORAGE_KEY = "tarot-admin-chat-conversations-v1";
const CHAT_ACTIVE_KEY = "tarot-admin-chat-active-conversation-v1";

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
    const seeded = missionThreadToChatHistory(thread, 18).map((m) => ({
      role: m.role,
      content: m.content,
      agent: m.role === "assistant" ? "coordinateur" : undefined,
    }));
    const seededConversation: Conversation = {
      id: `linked-${linkedParentJobId}`,
      title: `Mission #${linkedParentJobId}`,
      agent: "coordinateur",
      draft: "",
      history: seeded,
      liveJobId: null,
    };
    setConversations((prev) => {
      const withoutLinked = prev.filter((c) => !c.id.startsWith("linked-"));
      return [seededConversation, ...withoutLinked];
    });
    setActiveConversationId(seededConversation.id);
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Chat</h1>
        <p className="text-sm text-slate-500 mt-1 max-w-2xl leading-relaxed">
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
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden grid grid-cols-1 lg:grid-cols-[280px_1fr]">
        <aside className="border-b lg:border-b-0 lg:border-r border-slate-100 p-3 space-y-2 bg-slate-50/60">
          <button
            type="button"
            onClick={createConversation}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
          >
            Nouvelle conversation
          </button>
          <div className="space-y-1 max-h-[56vh] overflow-y-auto pr-1">
            {conversations.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setActiveConversationId(c.id)}
                className={`w-full text-left rounded-lg px-3 py-2 border text-sm ${
                  c.id === activeConversationId
                    ? "bg-white border-violet-200 text-violet-900"
                    : "bg-white/80 border-slate-200 text-slate-700 hover:bg-white"
                }`}
              >
                <p className="font-medium truncate">{c.title}</p>
                <p className="text-xs text-slate-500 mt-0.5">{c.history.length} message(s)</p>
              </button>
            ))}
          </div>
        </aside>
        <div>
          <div className="p-4 border-b border-slate-100 flex items-center gap-2">
            <span className="text-xs text-slate-500">Agent:</span>
            <select
              value={activeAgent}
              onChange={(e) =>
                setConversations((prev) => prev.map((c) => (c.id === activeConversationId ? { ...c, agent: e.target.value } : c)))
              }
              className="border border-slate-200 bg-white rounded-lg px-2 py-1 text-sm"
            >
              {(agents.data || []).map((a: { key: string; label: string }) => (
                <option key={a.key} value={a.key}>
                  {a.label}
                </option>
              ))}
            </select>
            <input
              value={activeConversation?.title || ""}
              onChange={(e) =>
                setConversations((prev) =>
                  prev.map((c) => (c.id === activeConversationId ? { ...c, title: e.target.value || "Sans titre" } : c)),
                )
              }
              className="ml-2 flex-1 border border-slate-200 bg-slate-50 rounded-lg px-3 py-1.5 text-sm"
              placeholder="Nom de la conversation"
            />
            <button
              type="button"
              onClick={deleteActiveConversation}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              Supprimer
            </button>
            {activeLiveJobId ? <span className="text-xs text-amber-700 font-medium ml-auto">Live #{activeLiveJobId}</span> : null}
          </div>
          <div className="p-4 space-y-3 max-h-[58vh] overflow-y-auto">
            {!activeHistory.length ? <p className="text-sm text-slate-500">Commencez la conversation avec votre premier message.</p> : null}
            {activeHistory.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
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
          <form onSubmit={onSend} className="border-t border-slate-100 p-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-2 flex items-end gap-2 shadow-sm">
            <textarea
              value={activeDraft}
              onChange={(e) =>
                setConversations((prev) => prev.map((c) => (c.id === activeConversationId ? { ...c, draft: e.target.value } : c)))
              }
              onKeyDown={onDraftKeyDown}
              disabled={isBusyActiveConversation || Boolean(activeLiveJobId)}
              rows={2}
              className="flex-1 resize-none bg-transparent outline-none px-2 py-2 text-sm leading-relaxed"
              placeholder="Posez votre question au CIO… (Entrée pour envoyer, Shift+Entrée pour saut de ligne)"
            />
            <button
              disabled={isBusyActiveConversation || Boolean(activeLiveJobId) || !activeDraft.trim()}
              className="bg-violet-700 text-white px-4 py-2.5 rounded-xl text-sm font-medium disabled:opacity-40 hover:bg-violet-800 transition-colors"
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
