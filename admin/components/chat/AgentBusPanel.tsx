"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { agentHeaders, requestJson } from "../../lib/api";

type BusMessage = {
  id: string;
  from: string;
  to: string;
  topic: string;
  body: string;
  status: string;
  comment?: string;
  reply_to?: string | null;
  created_at?: string;
  updated_at?: string;
};

type TabId = "open" | "done" | "retour";

type Props = {
  className?: string;
};

async function fetchBus(query: string): Promise<BusMessage[]> {
  const { data, res } = await requestJson(`/agent-bus/messages?${query}`, {
    headers: agentHeaders(),
    retries: 1,
    timeoutMs: 15_000,
    expectOk: false,
  });
  if (!res.ok) throw new Error("bus");
  return ((data as { messages?: BusMessage[] })?.messages || []) as BusMessage[];
}

function statusBadge(status: string) {
  if (status === "open") return "bg-amber-200 text-amber-950 dark:bg-amber-800 dark:text-amber-50";
  if (status === "acked") return "bg-sky-200 text-sky-950 dark:bg-sky-900 dark:text-sky-50";
  if (status === "done") return "bg-emerald-200 text-emerald-950 dark:bg-emerald-900 dark:text-emerald-50";
  return "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100";
}

function MessageCard({ m, showComment }: { m: BusMessage; showComment?: boolean }) {
  return (
    <li className="rounded-xl border border-amber-200/60 bg-white/70 px-3 py-2 text-sm dark:border-amber-900/40 dark:bg-slate-950/40">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-slate-900 dark:text-slate-50">{m.topic}</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${statusBadge(m.status)}`}>
          {m.status}
        </span>
      </div>
      <p className="mt-0.5 line-clamp-4 whitespace-pre-wrap text-xs text-slate-700 dark:text-slate-300">{m.body}</p>
      {showComment && m.comment ? (
        <p className="mt-1 rounded-lg bg-emerald-50/80 px-2 py-1 text-xs text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-100">
          <span className="font-semibold">Résultat : </span>
          {m.comment}
        </p>
      ) : null}
      <div className="mt-1 text-[11px] text-slate-500">
        {m.from} → {m.to} · {m.id}
        {m.reply_to ? ` · reply_to ${m.reply_to}` : ""}
      </div>
    </li>
  );
}

/** Plans Cursor + retours done/progress visibles dans Corimb (pas seulement la cloche). */
export default function AgentBusPanel({ className = "" }: Props) {
  const [tab, setTab] = useState<TabId>("open");

  const openQ = useQuery({
    queryKey: ["agent-bus", "cursor", "open"],
    queryFn: () => fetchBus("to=cursor&status=open&limit=20"),
    refetchInterval: 20_000,
  });
  const doneQ = useQuery({
    queryKey: ["agent-bus", "cursor", "done"],
    queryFn: () => fetchBus("to=cursor&status=done&limit=15"),
    refetchInterval: 30_000,
  });
  const retourQ = useQuery({
    queryKey: ["agent-bus", "grokbot", "remind"],
    queryFn: async () => {
      const [open, done] = await Promise.all([
        fetchBus("to=grokbot&topic=cursor-remind&status=open&limit=15"),
        fetchBus("to=grokbot&topic=cursor-remind&status=done&limit=10"),
      ]);
      return [...open, ...done];
    },
    refetchInterval: 20_000,
  });

  const tabs = useMemo(
    () =>
      [
        { id: "open" as const, label: "Ouvertes", count: openQ.data?.length ?? 0 },
        { id: "done" as const, label: "Terminées", count: doneQ.data?.length ?? 0 },
        { id: "retour" as const, label: "Retours Grokbot", count: retourQ.data?.length ?? 0 },
      ] as const,
    [openQ.data, doneQ.data, retourQ.data],
  );

  const loading = openQ.isLoading || doneQ.isLoading || retourQ.isLoading;
  const errored = openQ.isError && doneQ.isError && retourQ.isError;
  if (errored) return null;

  const list =
    tab === "open" ? openQ.data || [] : tab === "done" ? doneQ.data || [] : retourQ.data || [];

  return (
    <section
      className={`rounded-2xl border border-amber-200/80 bg-amber-50/70 p-3 dark:border-amber-900/50 dark:bg-amber-950/30 ${className}`}
      aria-label="Bus agent Corimb"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-amber-950 dark:text-amber-50">Bus Cursor ↔ Grokbot</h2>
        <Link href="/gestion/taches" className="text-xs font-medium text-amber-900 underline dark:text-amber-100">
          Tâches
        </Link>
      </div>
      <div className="mb-2 flex flex-wrap gap-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
              tab === t.id
                ? "bg-amber-900 text-amber-50 dark:bg-amber-100 dark:text-amber-950"
                : "bg-white/70 text-amber-950 dark:bg-slate-900/50 dark:text-amber-50"
            }`}
          >
            {t.label} ({t.count})
          </button>
        ))}
      </div>
      {loading && list.length === 0 ? (
        <p className="text-xs text-amber-900/80 dark:text-amber-100/80">Chargement…</p>
      ) : list.length === 0 ? (
        <p className="text-xs text-amber-900/80 dark:text-amber-100/80">
          {tab === "open"
            ? "Aucune tâche open pour Cursor."
            : tab === "done"
              ? "Aucun done récent."
              : "Aucun cursor-remind (retour) pour Grokbot."}
        </p>
      ) : (
        <ul className="space-y-2">
          {list.map((m) => (
            <MessageCard key={`${m.id}-${m.status}`} m={m} showComment={tab === "done" || Boolean(m.comment)} />
          ))}
        </ul>
      )}
    </section>
  );
}
