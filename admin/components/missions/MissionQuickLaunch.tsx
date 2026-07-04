"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { agentHeaders, requestJson } from "../../lib/api";

type Playbook = {
  id: string;
  title?: string;
  name?: string;
  category?: string;
  description?: string;
  mission?: string;
};

type Props = {
  compact?: boolean;
  className?: string;
};

export default function MissionQuickLaunch({ compact = false, className = "" }: Props) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const playbooks = useQuery({
    queryKey: ["playbooks-quick-launch"],
    queryFn: async () => {
      const { data } = await requestJson("/playbooks", { headers: agentHeaders(), retries: 1 });
      return ((data as { playbooks?: Playbook[] })?.playbooks || []) as Playbook[];
    },
    staleTime: 120_000,
  });

  const list = (playbooks.data || []).slice(0, compact ? 4 : 8);

  const launch = async (pb: Playbook) => {
    const id = pb.id;
    if (!id) return;
    setBusyId(id);
    setError("");
    try {
      const { data } = await requestJson(`/playbooks/${encodeURIComponent(id)}/launch`, {
        method: "POST",
        headers: agentHeaders(),
        body: JSON.stringify({}),
        retries: 0,
        timeoutMs: 30_000,
      });
      const jobId = String((data as { job_id?: string })?.job_id || "");
      if (jobId) {
        router.push(`/missions?job=${encodeURIComponent(jobId)}`);
      } else {
        router.push("/missions");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  if (playbooks.isLoading) {
    return <p className={`text-sm text-slate-500 ${className}`}>Chargement des playbooks…</p>;
  }

  if (!list.length) {
    return null;
  }

  return (
    <section className={`rounded-2xl border border-violet-100 bg-white p-4 shadow-sm ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-extrabold text-slate-900">Lancer en un clic</h3>
        {!compact ? (
          <button
            type="button"
            onClick={() => router.push("/missions?create=1")}
            className="text-xs font-bold text-violet-700 hover:underline"
          >
            Mission personnalisée →
          </button>
        ) : null}
      </div>
      {error ? <p className="mt-2 text-sm font-semibold text-red-700">{error}</p> : null}
      <ul className={`mt-3 gap-2 ${compact ? "grid sm:grid-cols-2" : "grid sm:grid-cols-2 lg:grid-cols-4"}`}>
        {list.map((pb) => {
          const title = pb.title || pb.name || pb.category || "Playbook";
          const desc = (pb.description || pb.mission || "").slice(0, 90);
          return (
            <li key={pb.id}>
              <button
                type="button"
                disabled={busyId === pb.id}
                onClick={() => void launch(pb)}
                className="flex h-full w-full flex-col rounded-xl border-2 border-violet-100 bg-violet-50/50 p-3 text-left transition hover:border-violet-300 hover:bg-violet-50 disabled:opacity-60"
              >
                <span className="text-sm font-bold text-slate-900">{title}</span>
                {desc ? <span className="mt-1 line-clamp-2 text-xs text-slate-600">{desc}</span> : null}
                <span className="mt-2 text-xs font-bold text-violet-700">
                  {busyId === pb.id ? "Lancement…" : "Lancer →"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
