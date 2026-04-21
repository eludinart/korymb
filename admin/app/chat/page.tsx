"use client";

import { FormEvent, Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import AgentMessageMarkdown from "../../components/AgentMessageMarkdown";
import MissionEventTimeline from "../../components/MissionEventTimeline";
import { missionThreadToChatHistory } from "../../lib/missionFollowupChat";
import { agentHeaders, requestJson } from "../../lib/api";
import { QK } from "../../lib/queryClient";

type Msg = { role: "user" | "assistant"; content: string; agent?: string };

function ChatPageInner() {
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const linkedParentJobId = (searchParams.get("parent") || "").trim().slice(0, 16);
  const seededParentRef = useRef("");
  const [agent, setAgent] = useState("coordinateur");
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [liveJobId, setLiveJobId] = useState<string | null>(null);

  const agents = useQuery({
    queryKey: QK.agents,
    queryFn: async () => (await requestJson("/agents", { retries: 1 })).data.agents || [],
  });

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
    setHistory(seeded);
  }, [linkedParentJobId, parentJobDetail.data]);

  const live = useQuery({
    queryKey: ["chat-live", liveJobId],
    enabled: Boolean(liveJobId),
    queryFn: async () =>
      (await requestJson(`/jobs/${encodeURIComponent(String(liveJobId))}?log_offset=0&events_offset=0`, { headers: agentHeaders(), retries: 1 })).data,
    refetchInterval: () => (liveJobId && typeof document !== "undefined" && document.visibilityState === "visible" ? 1500 : false),
  });

  const onSend = async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || busy || liveJobId) return;
    const msg = input.trim();
    setInput("");
    setHistory((p) => [...p, { role: "user", content: msg }]);
    setBusy(true);
    try {
      const { data } = await requestJson("/chat", {
        method: "POST",
        headers: agentHeaders(),
        timeoutMs: 20000,
        body: JSON.stringify({
          message: msg,
          agent,
          history,
          ...(linkedParentJobId && agent === "coordinateur" ? { linked_job_id: linkedParentJobId } : {}),
        }),
      });
      if (agent === "coordinateur" && data?.status === "accepted" && data?.job_id) {
        setLiveJobId(String(data.job_id));
      } else {
        setHistory((p) => [...p, { role: "assistant", content: String(data?.response || ""), agent }]);
      }
      qc.invalidateQueries({ queryKey: QK.jobs });
      qc.invalidateQueries({ queryKey: QK.tokens });
    } catch (err) {
      setHistory((p) => [...p, { role: "assistant", content: err instanceof Error ? err.message : String(err), agent }]);
    } finally {
      setBusy(false);
    }
  };

  const liveDone = useMemo(() => {
    if (!live.data || !liveJobId) return false;
    const st = String(live.data.status || "");
    return st === "completed" || st.startsWith("error");
  }, [live.data, liveJobId]);

  useEffect(() => {
    if (!liveDone || !liveJobId) return;
    const result = String(live.data?.result || "");
    const status = String(live.data?.status || "");
    setLiveJobId(null);
    if (linkedParentJobId) {
      void qc.invalidateQueries({ queryKey: ["job-detail-live", linkedParentJobId] });
      void qc.invalidateQueries({ queryKey: ["chat-parent-job", linkedParentJobId] });
    }
    if (result.trim()) {
      setHistory((p) => [...p, { role: "assistant", content: result, agent: "coordinateur" }]);
      return;
    }
    if (status.startsWith("error")) {
      const fromStatus = status.replace(/^error:\s*/i, "").trim();
      setHistory((p) => [
        ...p,
        {
          role: "assistant",
          content:
            fromStatus ||
            "La mission s'est terminée en erreur. Ouvre l'onglet Missions : le journal d'exécution peut contenir plus de détails.",
          agent: "coordinateur",
        },
      ]);
    }
  }, [liveDone, liveJobId, live.data?.result, live.data?.status, linkedParentJobId, qc]);

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
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center gap-2">
          <span className="text-xs text-slate-500">Agent:</span>
          <select value={agent} onChange={(e) => setAgent(e.target.value)} className="border border-slate-200 rounded-lg px-2 py-1 text-sm">
            {(agents.data || []).map((a: { key: string; label: string }) => (
              <option key={a.key} value={a.key}>{a.label}</option>
            ))}
          </select>
          {liveJobId ? <span className="text-xs text-amber-700 font-medium ml-auto">Live #{liveJobId}</span> : null}
        </div>
        <div className="p-4 space-y-3 max-h-[58vh] overflow-y-auto">
          {history.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${m.role === "user" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-800"}`}>
                {m.role === "user" ? (
                  <span className="whitespace-pre-wrap leading-relaxed">{m.content}</span>
                ) : (
                  <AgentMessageMarkdown source={m.content} />
                )}
              </div>
            </div>
          ))}
          {liveJobId ? (
            <div className="space-y-3 text-xs text-slate-600 bg-violet-50 border border-violet-100 rounded-xl p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p>
                  Orchestration CIO en cours… statut:{" "}
                  <span className="font-mono font-semibold text-violet-900">{String(live.data?.status || "running")}</span>
                </p>
                <Link
                  href={`/missions?job=${encodeURIComponent(liveJobId)}`}
                  className="rounded-lg bg-white px-2 py-1 text-[11px] font-medium text-violet-900 border border-violet-200 hover:bg-violet-100"
                >
                  Ouvrir la mission
                </Link>
              </div>
              <MissionEventTimeline
                events={live.data?.events}
                title="Qui fait quoi (temps reel)"
                maxHeightClass="max-h-52"
              />
            </div>
          ) : null}
        </div>
        <form onSubmit={onSend} className="border-t border-slate-100 p-4 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={busy || Boolean(liveJobId)}
            className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm"
            placeholder="Votre message..."
          />
          <button disabled={busy || Boolean(liveJobId) || !input.trim()} className="bg-slate-900 text-white px-4 py-2 rounded-xl text-sm disabled:opacity-40">
            Envoyer
          </button>
        </form>
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
