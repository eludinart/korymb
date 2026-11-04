"use client";

import Link from "next/link";
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
  created_at?: string;
};

type Props = {
  className?: string;
};

export default function AgentBusPanel({ className = "" }: Props) {
  const openForCursor = useQuery({
    queryKey: ["agent-bus", "cursor", "open"],
    queryFn: async () => {
      const { data, res } = await requestJson("/agent-bus/messages?to=cursor&status=open&limit=20", {
        headers: agentHeaders(),
        retries: 1,
        timeoutMs: 15_000,
      });
      if (!res.ok) throw new Error("bus");
      return ((data as { messages?: BusMessage[] })?.messages || []) as BusMessage[];
    },
    refetchInterval: 30_000,
  });

  const items = openForCursor.data || [];
  if (openForCursor.isError) {
    return null;
  }
  if (!openForCursor.isLoading && items.length === 0) {
    return null;
  }

  return (
    <section
      className={`rounded-2xl border border-amber-200/80 bg-amber-50/70 p-3 dark:border-amber-900/50 dark:bg-amber-950/30 ${className}`}
      aria-label="Plans bus pour Cursor"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-amber-950 dark:text-amber-50">
          Plans pour Cursor ({items.length || "…"})
        </h2>
        <Link href="/gestion/taches" className="text-xs font-medium text-amber-900 underline dark:text-amber-100">
          Tâches
        </Link>
      </div>
      {openForCursor.isLoading ? (
        <p className="text-xs text-amber-900/80 dark:text-amber-100/80">Chargement…</p>
      ) : (
        <ul className="space-y-2">
          {items.map((m) => (
            <li
              key={m.id}
              className="rounded-xl border border-amber-200/60 bg-white/70 px-3 py-2 text-sm dark:border-amber-900/40 dark:bg-slate-950/40"
            >
              <div className="font-medium text-slate-900 dark:text-slate-50">{m.topic}</div>
              <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-xs text-slate-700 dark:text-slate-300">
                {m.body}
              </p>
              <div className="mt-1 text-[11px] text-slate-500">
                {m.from} → {m.to} · {m.id}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
