"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { agentHeaders, formatHttpApiErrorPayload, requestJson } from "../../lib/api";

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

type StatusTab = "open" | "done" | "all";

type Props = {
  className?: string;
  /** Sur /gestion/taches : toujours afficher le panneau (filtres Ouvertes/Faites). */
  forceVisible?: boolean;
};

const DEFAULT_DONE_COMMENT = "marqué fait depuis gestion/taches";

async function fetchBusMessages(status: string): Promise<BusMessage[]> {
  const { data, res } = await requestJson(
    `/agent-bus/messages?to=cursor&status=${encodeURIComponent(status)}&limit=50`,
    {
      headers: agentHeaders(),
      retries: 1,
      timeoutMs: 15_000,
      expectOk: false,
    },
  );
  if (!res.ok) {
    throw new Error(formatHttpApiErrorPayload(data) || `HTTP ${res.status}`);
  }
  return ((data as { messages?: BusMessage[] })?.messages || []) as BusMessage[];
}

function mergeById(rows: BusMessage[]): BusMessage[] {
  const map = new Map<string, BusMessage>();
  for (const row of rows) map.set(row.id, row);
  return Array.from(map.values()).sort((a, b) =>
    String(b.created_at || "").localeCompare(String(a.created_at || "")),
  );
}

export default function AgentBusPanel({ className = "", forceVisible = false }: Props) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<StatusTab>("open");
  const [comments, setComments] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState("");
  const [actionOk, setActionOk] = useState("");

  const listQuery = useQuery({
    queryKey: ["agent-bus", "cursor", tab],
    queryFn: async () => {
      if (tab === "open") {
        const [openRows, ackedRows] = await Promise.all([
          fetchBusMessages("open"),
          fetchBusMessages("acked"),
        ]);
        return mergeById([...openRows, ...ackedRows]);
      }
      if (tab === "done") {
        return fetchBusMessages("done");
      }
      const [openRows, ackedRows, doneRows] = await Promise.all([
        fetchBusMessages("open"),
        fetchBusMessages("acked"),
        fetchBusMessages("done"),
      ]);
      return mergeById([...openRows, ...ackedRows, ...doneRows]);
    },
    refetchInterval: 30_000,
  });

  const markDone = useMutation({
    mutationFn: async ({ id, comment }: { id: string; comment: string }) => {
      const { data, res } = await requestJson(`/agent-bus/messages/${encodeURIComponent(id)}/done`, {
        method: "POST",
        headers: agentHeaders(),
        body: JSON.stringify({ comment }),
        expectOk: false,
        timeoutMs: 20_000,
      });
      if (!res.ok) {
        throw new Error(formatHttpApiErrorPayload(data) || `HTTP ${res.status}`);
      }
      return data as BusMessage;
    },
    onSuccess: async () => {
      setActionError("");
      setActionOk("Marquée faite.");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["agent-bus"] }),
        qc.invalidateQueries({ queryKey: ["work-tasks"] }),
      ]);
    },
    onError: (err: unknown) => {
      setActionOk("");
      setActionError(err instanceof Error ? err.message : "Échec du marquage.");
    },
  });

  const items = listQuery.data || [];
  const pendingId = markDone.isPending ? markDone.variables?.id : null;

  const tabs = useMemo(
    () =>
      [
        { id: "open" as const, label: "Ouvertes" },
        { id: "done" as const, label: "Faites" },
        { id: "all" as const, label: "Toutes" },
      ] as const,
    [],
  );

  if (!forceVisible && listQuery.isError && tab === "open" && items.length === 0) {
    return null;
  }

  if (
    !forceVisible &&
    !listQuery.isLoading &&
    tab === "open" &&
    items.length === 0 &&
    !listQuery.isError
  ) {
    return null;
  }

  return (
    <section
      className={`rounded-2xl border border-amber-200/80 bg-amber-50/70 p-3 dark:border-amber-900/50 dark:bg-amber-950/30 ${className}`}
      aria-label="Plans bus pour Cursor"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-amber-950 dark:text-amber-50">
          Plans pour Cursor ({listQuery.isLoading ? "…" : items.length})
        </h2>
        <Link href="/gestion/taches" className="text-xs font-medium text-amber-900 underline dark:text-amber-100">
          Tâches
        </Link>
      </div>

      <div className="mb-3 flex flex-wrap gap-1" role="tablist" aria-label="Filtrer les plans bus">
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                setTab(t.id);
                setActionError("");
                setActionOk("");
              }}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
                active
                  ? "bg-amber-900 text-amber-50 dark:bg-amber-100 dark:text-amber-950"
                  : "bg-white/70 text-amber-950 hover:bg-white dark:bg-slate-950/40 dark:text-amber-50"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {actionError ? (
        <p className="mb-2 text-xs font-medium text-red-700 dark:text-red-300" role="alert">
          {actionError}
        </p>
      ) : null}
      {actionOk ? (
        <p className="mb-2 text-xs font-medium text-emerald-800 dark:text-emerald-200">{actionOk}</p>
      ) : null}

      {listQuery.isLoading ? (
        <p className="text-xs text-amber-900/80 dark:text-amber-100/80">Chargement…</p>
      ) : listQuery.isError ? (
        <p className="text-xs text-red-700 dark:text-red-300" role="alert">
          Impossible de charger le bus.
        </p>
      ) : items.length === 0 ? (
        <p className="text-xs text-amber-900/80 dark:text-amber-100/80">Aucun message dans cet onglet.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((m) => {
            const canMarkDone = m.status === "open" || m.status === "acked";
            const busy = pendingId === m.id;
            return (
              <li
                key={m.id}
                className="rounded-xl border border-amber-200/60 bg-white/70 px-3 py-2 text-sm dark:border-amber-900/40 dark:bg-slate-950/40"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-slate-900 dark:text-slate-50">
                      {m.topic}{" "}
                      <span className="text-[11px] font-normal text-slate-500">({m.status})</span>
                    </div>
                    <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-xs text-slate-700 dark:text-slate-300">
                      {m.body}
                    </p>
                    {m.status === "done" && m.comment ? (
                      <p className="mt-1 text-[11px] text-emerald-800 dark:text-emerald-200">
                        Résultat : {m.comment}
                      </p>
                    ) : null}
                    <div className="mt-1 text-[11px] text-slate-500">
                      {m.from} → {m.to} · {m.id}
                    </div>
                  </div>
                  {canMarkDone ? (
                    <div className="flex w-full flex-col gap-1 sm:w-44">
                      <input
                        type="text"
                        value={comments[m.id] ?? ""}
                        onChange={(event) =>
                          setComments((prev) => ({ ...prev, [m.id]: event.target.value }))
                        }
                        placeholder="Commentaire (optionnel)"
                        className="rounded-md border border-amber-200/80 bg-white px-2 py-1 text-xs text-slate-800 dark:border-amber-900/50 dark:bg-slate-900 dark:text-slate-100"
                        disabled={busy}
                      />
                      <button
                        type="button"
                        className="btn-primary px-3 py-1.5 text-xs"
                        disabled={busy || markDone.isPending}
                        onClick={() => {
                          const raw = (comments[m.id] ?? "").trim();
                          markDone.mutate({
                            id: m.id,
                            comment: raw || DEFAULT_DONE_COMMENT,
                          });
                        }}
                      >
                        {busy ? "…" : "Fait"}
                      </button>
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
