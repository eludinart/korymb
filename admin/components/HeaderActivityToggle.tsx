"use client";

import { useQuery } from "@tanstack/react-query";
import { agentHeaders, requestJson } from "../lib/api";
import { fetchActiveAgentJobs } from "../lib/activeAgentWork";
import { adaptivePollInterval } from "../lib/korymbEvents";
import { QK } from "../lib/queryClient";

type Props = {
  open: boolean;
  onToggle: () => void;
};

export default function HeaderActivityToggle({ open, onToggle }: Props) {
  const active = useQuery({
    queryKey: QK.jobsActive,
    queryFn: () => fetchActiveAgentJobs(requestJson, agentHeaders),
    refetchInterval: (query) => {
      const list = query.state.data?.jobs ?? [];
      const hasRunning = list.some((j) => j.status === "running" || j.status === "pending");
      const base = hasRunning ? 2_500 : 12_000;
      return adaptivePollInterval(base, base * 2);
    },
    staleTime: 1_500,
  });

  const jobs = active.data?.jobs ?? [];
  const stopped = active.data?.recentlyStopped ?? [];
  const working = jobs.filter((j) => j.status === "running" || j.status === "pending").length;
  const n = jobs.length + stopped.length;
  if (n === 0 && !open) return null;

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`relative inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-full px-2 text-[11px] font-bold ${
        open ? "bg-violet-200 text-violet-950" : "bg-violet-50 text-violet-800 hover:bg-violet-100"
      }`}
      aria-expanded={open}
      aria-label={open ? "Masquer l'activité des agents" : "Afficher l'activité des agents"}
      title="Activité des agents"
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          working > 0 ? "animate-pulse bg-emerald-500" : "bg-slate-400"
        }`}
        aria-hidden
      />
      {n > 0 ? <span className="tabular-nums">{n > 9 ? "9+" : n}</span> : null}
    </button>
  );
}
