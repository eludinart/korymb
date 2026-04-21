"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import MissionJobLiveDetail from "../../components/MissionJobLiveDetail";
import { agentHeaders, requestFallbackJson, requestJson } from "../../lib/api";
import { stripMarkdownLight } from "../../lib/normalizeLooseMarkdown";
import { QK } from "../../lib/queryClient";

type Job = {
  job_id: string;
  mission?: string;
  status?: string;
  agent?: string;
  result?: string | null;
  created_at?: string;
};

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
          Consultation et nettoyage des missions. Le détail reprend la même présentation que le suivi d&apos;une nouvelle
          mission (fil live, synthèse CIO, cadrage, événements).
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
          {jobs.map((j) => (
            <div
              key={j.job_id}
              className={`border rounded-xl p-3 cursor-pointer ${
                selected === j.job_id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white"
              }`}
              onClick={() => setSelected(j.job_id)}
            >
              <p className={`text-xs font-mono ${selected === j.job_id ? "text-slate-300" : "text-slate-500"}`}>{j.job_id}</p>
              <p className={`text-sm font-medium truncate ${selected === j.job_id ? "text-white" : "text-slate-900"}`}>
                {stripMarkdownLight(j.mission || "") || "(sans titre)"}
              </p>
              <p className={`text-xs ${selected === j.job_id ? "text-slate-300" : "text-slate-500"}`}>
                {j.agent} · {j.status}
              </p>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void deleteJob(j.job_id);
                }}
                disabled={busy}
                className={`mt-2 text-xs px-2 py-1 rounded ${selected === j.job_id ? "bg-red-900 text-red-200" : "bg-red-50 text-red-700"}`}
              >
                Suppr.
              </button>
            </div>
          ))}
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
