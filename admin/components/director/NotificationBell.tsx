"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { agentHeaders, requestJson } from "../../lib/api";
import DirectorToast from "./DirectorToast";

type NotificationRow = {
  id: string;
  kind: string;
  title: string;
  body?: string;
  action_url?: string;
  read_at?: string | null;
  created_at?: string;
};

export default function NotificationBell() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<NotificationRow | null>(null);

  const notifs = useQuery({
    queryKey: ["director-notifications"],
    queryFn: async () => {
      const { data } = await requestJson("/admin/notifications?unread_only=true&limit=30", {
        headers: agentHeaders(),
      });
      return (data.items || []) as NotificationRow[];
    },
    refetchInterval: 30000,
  });

  useEffect(() => {
    let es: EventSource | null = null;
    let closed = false;
    const openEs = () => {
      if (closed) return;
      try {
        es = new EventSource("/api/korymb-events");
      } catch {
        return;
      }
      es.addEventListener("director_notification", (ev) => {
        try {
          const payload = JSON.parse(ev.data || "{}") as NotificationRow;
          setToast(payload);
          void qc.invalidateQueries({ queryKey: ["director-notifications"] });
          void qc.invalidateQueries({ queryKey: ["admin-inbox"] });
        } catch {
          /* ignore */
        }
      });
      es.onerror = () => {
        if (es) es.close();
        window.setTimeout(openEs, 5000);
      };
    };
    openEs();
    return () => {
      closed = true;
      if (es) es.close();
    };
  }, [qc]);

  const unread = notifs.data?.length || 0;

  const markRead = async (id: string) => {
    await requestJson(`/admin/notifications/${encodeURIComponent(id)}/read`, {
      method: "PATCH",
      headers: agentHeaders(),
    });
    void qc.invalidateQueries({ queryKey: ["director-notifications"] });
  };

  return (
    <>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="touch-target relative rounded-xl border-2 border-amber-300 bg-amber-50 px-3 py-2 text-lg shadow-sm hover:bg-amber-100"
          aria-label="Notifications dirigeant"
        >
          🔔
          {unread > 0 ? (
            <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-extrabold text-white ring-2 ring-white">
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </button>
        {open ? (
          <div className="absolute right-0 z-30 mt-2 w-[min(100vw-2rem,20rem)] rounded-2xl border-2 border-violet-200 bg-white shadow-xl sm:w-80">
            <div className="flex items-center justify-between border-b-2 border-violet-100 px-4 py-3">
              <p className="text-sm font-extrabold text-slate-950">Notifications</p>
              <button
                type="button"
                className="text-xs font-bold text-violet-800 hover:underline"
                onClick={async () => {
                  await requestJson("/admin/notifications/mark-all-read", {
                    method: "POST",
                    headers: agentHeaders(),
                  });
                  void qc.invalidateQueries({ queryKey: ["director-notifications"] });
                }}
              >
                Tout marquer lu
              </button>
            </div>
            <ul className="max-h-72 overflow-auto">
              {(notifs.data || []).length === 0 ? (
                <li className="px-4 py-5 text-sm font-semibold text-slate-600">Aucune notification non lue.</li>
              ) : (
                notifs.data!.map((n) => (
                  <li key={n.id} className="border-b border-slate-100 px-4 py-3">
                    <button
                      type="button"
                      className="w-full text-left"
                      onClick={() => {
                        void markRead(n.id);
                        setOpen(false);
                      }}
                    >
                      <p className="text-sm font-extrabold text-slate-950">{n.title}</p>
                      {n.body ? <p className="mt-1 text-sm font-medium text-slate-700">{n.body}</p> : null}
                      {n.action_url ? (
                        <Link href={n.action_url} className="btn-link-primary mt-2 inline-flex text-xs">
                          Ouvrir
                        </Link>
                      ) : null}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        ) : null}
      </div>
      {toast ? <DirectorToast notification={toast} onDismiss={() => setToast(null)} /> : null}
    </>
  );
}
