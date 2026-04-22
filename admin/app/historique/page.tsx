"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import MissionJobLiveDetail from "../../components/MissionJobLiveDetail";
import { agentHeaders, requestFallbackJson, requestJson } from "../../lib/api";
import { stripMarkdownLight } from "../../lib/normalizeLooseMarkdown";
import { QK } from "../../lib/queryClient";

import type { Job } from "../../lib/types";

type HistoryItemType = "chat" | "mission_guidee" | "mission";

function detectHistoryItemType(job: Job): HistoryItemType {
  const source = String((job as Job & { source?: string }).source || "").toLowerCase();
  if (source.startsWith("chat")) return "chat";
  if (source === "mission_session") return "mission_guidee";
  return "mission";
}

function historyTypeLabel(kind: HistoryItemType): string {
  if (kind === "chat") return "Chat";
  if (kind === "mission_guidee") return "Mission guidée";
  return "Mission";
}

function firstUserMessageFromThread(thread: unknown): string {
  if (!Array.isArray(thread)) return "";
  for (const item of thread) {
    if (!item || typeof item !== "object") continue;
    const row = item as { role?: unknown; content?: unknown };
    if (String(row.role || "") !== "user") continue;
    const content = String(row.content || "").trim();
    if (content) return content;
  }
  return "";
}

function compact(text: string, max = 110): string {
  const clean = stripMarkdownLight(text || "");
  if (!clean) return "";
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export default function HistoriquePage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const jobsQuery = useQuery({
    queryKey: QK.jobs,
    queryFn: async () => (await requestJson("/jobs", { headers: agentHeaders(), retries: 1 })).data.jobs || [],
    refetchInterval: () => (typeof document !== "undefined" && document.visibilityState === "visible" ? 5000 : false),
  });
  const agents = useQuery({
    queryKey: QK.agents,
    queryFn: async () => (await requestJson("/agents", { retries: 1 })).data.agents || [],
  });
  const detailQuery = useQuery({
    queryKey: ["job-detail-historique-live", selected],
    enabled: Boolean(selected),
    queryFn: async () =>
      (
        await requestJson(`/jobs/${encodeURIComponent(String(selected))}?log_offset=0&events_offset=0`, {
          headers: agentHeaders(),
          retries: 1,
        })
      ).data,
    refetchInterval: (q) => {
      if (!selected || typeof document === "undefined" || document.visibilityState !== "visible") return false;
      const st = String((q.state.data as { status?: string } | undefined)?.status || "");
      return st === "running" || st === "pending" ? 2000 : 5000;
    },
  });

  const agentLabelMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const a of (agents.data || []) as { key: string; label: string }[]) {
      if (a?.key) m[a.key] = a.label || a.key;
    }
    return m;
  }, [agents.data]);

  const selectedMissionLabel = useMemo(() => {
    if (!selected) return "";
    const j = ((jobsQuery.data || []) as Job[]).find((x) => x.job_id === selected);
    return String(j?.mission || "").trim();
  }, [jobsQuery.data, selected]);

  const deleteJob = async (jobId: string) => {
    setBusy(true);
    setError("");
    setFeedback("");
    try {
      const headers = agentHeaders();
      await requestFallbackJson(
        [
          () => requestJson(`/jobs/${encodeURIComponent(jobId)}/remove`, { method: "POST", headers, expectOk: false }),
          () => requestJson(`/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE", headers, expectOk: false }),
          () => requestJson("/run/remove-job", { method: "POST", headers, body: JSON.stringify({ job_id: jobId }), expectOk: false }),
        ],
        "Suppression mission",
      );
      if (selected === jobId) setSelected(null);
      setFeedback(`Mission #${jobId} supprimée.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      qc.invalidateQueries({ queryKey: QK.jobs });
    }
  };

  const requestCancel = async () => {
    if (!selected) return;
    setCancelBusy(true);
    setError("");
    try {
      await requestJson(`/jobs/${encodeURIComponent(selected)}/cancel`, {
        method: "POST",
        headers: agentHeaders(),
        retries: 0,
      });
      setFeedback(`Arrêt demandé pour la mission #${selected}.`);
      await qc.invalidateQueries({ queryKey: ["job-detail-historique-live", selected] });
      await qc.invalidateQueries({ queryKey: QK.jobs });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCancelBusy(false);
    }
  };

  const jobs = (jobsQuery.data || []) as Job[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Historique</h1>
        <p className="text-sm text-slate-500 mt-1">
          Journal unifié des missions et conversations. Chaque entrée affiche son type pour identifier rapidement ce qui est
          un chat, une mission guidée ou une mission classique.
        </p>
      </div>
      <div className="grid w-full min-w-0 max-w-full gap-4 lg:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)] lg:items-start">
        <div className="lg:col-span-2 space-y-2">
          {error ? <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p> : null}
          {feedback ? (
            <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">{feedback}</p>
          ) : null}
        </div>
        <aside className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3 lg:sticky lg:top-24 lg:max-h-[min(70vh,calc(100vh-8rem))] lg:overflow-y-auto space-y-2">
          {jobs.map((j) => {
            const isSelected = selected === j.job_id;
            const type = detectHistoryItemType(j);
            const title =
              type === "chat"
                ? compact(firstUserMessageFromThread((j as Job & { mission_thread?: unknown[] }).mission_thread), 85) ||
                  compact(j.mission || "", 85) ||
                  "Conversation"
                : compact(j.mission || "", 85) || "(sans titre)";
            const quickInfo =
              type === "chat"
                ? compact(`Agent ${j.agent || "coordinateur"} · ${j.status || "—"}`, 75)
                : type === "mission_guidee"
                  ? compact(`Issue d'une session de cadrage · ${j.status || "—"}`, 85)
                  : compact(`Agent ${j.agent || "coordinateur"} · ${j.status || "—"}`, 75);

            return (
              <div
                key={j.job_id}
                className={`border rounded-xl p-3 cursor-pointer ${
                  isSelected ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white"
                }`}
                onClick={() => setSelected(j.job_id)}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className={`text-xs font-mono ${isSelected ? "text-slate-300" : "text-slate-500"}`}>{j.job_id}</p>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      isSelected
                        ? "bg-white/15 text-white"
                        : type === "chat"
                          ? "bg-violet-50 text-violet-700"
                          : type === "mission_guidee"
                            ? "bg-amber-50 text-amber-700"
                            : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {historyTypeLabel(type)}
                  </span>
                </div>
                <p className={`mt-1 text-sm font-medium ${isSelected ? "text-white" : "text-slate-900"}`}>{title}</p>
                <p className={`mt-1 text-xs ${isSelected ? "text-slate-300" : "text-slate-500"}`}>{quickInfo}</p>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void deleteJob(j.job_id);
                  }}
                  disabled={busy}
                  className={`mt-2 text-xs px-2 py-1 rounded ${isSelected ? "bg-red-900 text-red-200" : "bg-red-50 text-red-700"}`}
                >
                  Suppr.
                </button>
              </div>
            );
          })}
          {jobs.length === 0 ? <p className="text-sm text-slate-400">Aucun historique.</p> : null}
        </aside>
        <div className="min-w-0 max-w-full">
          {!selected ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 min-h-[220px]">
              <p className="text-sm text-slate-400">Sélectionnez une mission dans la liste.</p>
            </section>
          ) : (
            <MissionJobLiveDetail
              jobId={selected}
              missionPrompt={selectedMissionLabel}
              agentFallback="coordinateur"
              agentLabelMap={agentLabelMap}
              title="Détail mission"
              live={{
                data: detailQuery.data,
                isLoading: detailQuery.isLoading,
                isError: detailQuery.isError,
              }}
              onRequestCancel={requestCancel}
              cancelBusy={cancelBusy}
            />
          )}
        </div>
      </div>
    </div>
  );
}
