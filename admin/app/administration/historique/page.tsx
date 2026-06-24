"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import InteractionHistoryPanel from "../../../components/administration/InteractionHistoryPanel";
import { PageHeader, PageShell } from "../../../components/ui/PageChrome";
import { agentHeaders, requestJson } from "../../../lib/api";
import { QK } from "../../../lib/queryClient";

import type { Job } from "../../../lib/types";

export default function AdministrationHistoriquePage() {
  const qc = useQueryClient();
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");

  const jobs = useQuery({
    queryKey: QK.jobsCards,
    queryFn: async () => {
      const { data } = await requestJson("/jobs/cards", { headers: agentHeaders(), retries: 0, timeoutMs: 15_000 });
      const list = (data as { jobs?: unknown })?.jobs;
      return Array.isArray(list) ? (list as Job[]) : [];
    },
    staleTime: 15_000,
  });

  const sessions = useQuery({
    queryKey: [...QK.missionSessions, "admin"],
    queryFn: async () => {
      const { data } = await requestJson("/mission-sessions?limit=200", {
        headers: agentHeaders(),
        retries: 1,
      });
      return (data.sessions || []) as Array<{
        id: string;
        title?: string;
        agent?: string;
        status?: string;
        linked_job_id?: string;
        updated_at?: string;
        created_at?: string;
      }>;
    },
    staleTime: 15_000,
  });

  const missionJobs = useMemo(
    () => (jobs.data || []).filter((j) => String(j.source || "mission") !== "chat"),
    [jobs.data],
  );

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: QK.jobsCards }),
      qc.invalidateQueries({ queryKey: QK.missionSessions }),
    ]);
  };

  return (
    <PageShell size="wide">
      <PageHeader
        title="Historique des interactions"
        badge="Administration"
        description="Consultez et supprimez les missions exécutées et les sessions de cadrage guidé. Les conversations chat se gèrent depuis l’interface Chat."
        actions={
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={jobs.isFetching || sessions.isFetching}
            className="btn-secondary text-sm"
          >
            Actualiser
          </button>
        }
      />

      {error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>
      ) : null}
      {feedback ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {feedback}
        </p>
      ) : null}

      {jobs.isError ? (
        <p className="text-sm text-red-700">
          Impossible de charger les missions
          {jobs.error instanceof Error ? ` : ${jobs.error.message}` : ""}.
        </p>
      ) : null}

      <InteractionHistoryPanel
        jobs={missionJobs}
        sessions={sessions.data || []}
        loading={jobs.isLoading || sessions.isLoading}
        onFeedback={setFeedback}
        onError={setError}
        onChanged={() => void refresh()}
      />

      <p className="text-xs text-slate-500">
        Besoin du détail opérationnel ?{" "}
        <Link href="/missions" className="font-medium text-violet-800 hover:underline">
          Hub Missions
        </Link>{" "}
        · Conversations libres :{" "}
        <Link href="/chat" className="font-medium text-violet-800 hover:underline">
          Chat
        </Link>
        .
      </p>
    </PageShell>
  );
}
