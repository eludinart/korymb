"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { agentHeaders, requestJson } from "../../lib/api";
import type { DirectorNotification } from "../../lib/directorNotificationUi";
import DirectorToast from "./DirectorToast";
import NotificationItemRow from "./NotificationItemRow";

type FilterMode = "unread" | "all";

function useIsNarrow(breakpointPx = 640) {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpointPx - 1}px)`);
    const apply = () => setNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [breakpointPx]);
  return narrow;
}

export default function NotificationBell() {
  const router = useRouter();
  const qc = useQueryClient();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const isNarrow = useIsNarrow(640);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [filter, setFilter] = useState<FilterMode>("unread");
  const [toast, setToast] = useState<DirectorNotification | null>(null);
  const [actionError, setActionError] = useState("");
  const [copyHint, setCopyHint] = useState("");
  const [markAllBusy, setMarkAllBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  const notifs = useQuery({
    queryKey: ["director-notifications", filter],
    queryFn: async () => {
      const unreadOnly = filter === "unread";
      const { data } = await requestJson(
        `/admin/notifications?unread_only=${unreadOnly ? "true" : "false"}&limit=50`,
        { headers: agentHeaders(), retries: 1 },
      );
      return (data.items || []) as DirectorNotification[];
    },
    refetchInterval: open ? 15000 : 30000,
  });

  useEffect(() => {
    const onDirectorNotification = (ev: Event) => {
      try {
        const payload = (ev as CustomEvent<DirectorNotification>).detail;
        if (!payload?.id) return;
        setToast(payload);
        void qc.invalidateQueries({ queryKey: ["director-notifications"] });
        void qc.invalidateQueries({ queryKey: ["admin-inbox"] });
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("korymb:director_notification", onDirectorNotification);
    return () => window.removeEventListener("korymb:director_notification", onDirectorNotification);
  }, [qc]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (ev: MouseEvent) => {
      const target = ev.target as Node | null;
      if (!target) return;
      if (rootRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !isNarrow) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open, isNarrow]);

  useEffect(() => {
    if (!copyHint) return;
    const t = window.setTimeout(() => setCopyHint(""), 2000);
    return () => window.clearTimeout(t);
  }, [copyHint]);

  const unreadCount = (notifs.data || []).filter((n) => !n.read_at).length;
  const badgeCount = filter === "unread" ? notifs.data?.length || 0 : unreadCount;

  const markRead = async (id: string): Promise<boolean> => {
    try {
      await requestJson(`/admin/notifications/${encodeURIComponent(id)}/read`, {
        method: "PATCH",
        headers: agentHeaders(),
        retries: 1,
      });
      void qc.invalidateQueries({ queryKey: ["director-notifications"] });
      setActionError("");
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/failed to fetch|network|timeout|aborted/i.test(msg)) {
        setActionError(msg || "Impossible de marquer la notification comme lue.");
      }
      return false;
    }
  };

  const navigateFromNotification = async (n: DirectorNotification, href: string, shouldMarkRead: boolean) => {
    setBusyId(n.id);
    setActionError("");
    try {
      if (shouldMarkRead && !n.read_at) {
        await markRead(n.id);
      }
      setOpen(false);
      router.push(href);
    } finally {
      setBusyId(null);
    }
  };

  const deleteNotification = async (id: string) => {
    if (typeof window !== "undefined" && !window.confirm("Supprimer cette notification ?")) return;
    setBusyId(id);
    setActionError("");
    try {
      await requestJson(`/admin/notifications/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: agentHeaders(),
        retries: 1,
      });
      void qc.invalidateQueries({ queryKey: ["director-notifications"] });
      void qc.invalidateQueries({ queryKey: ["admin-inbox"] });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Impossible de supprimer la notification.");
    } finally {
      setBusyId(null);
    }
  };

  const markAllRead = async () => {
    setMarkAllBusy(true);
    setActionError("");
    try {
      await requestJson("/admin/notifications/mark-all-read", {
        method: "POST",
        headers: agentHeaders(),
        retries: 1,
      });
      void qc.invalidateQueries({ queryKey: ["director-notifications"] });
      if (filter === "unread") setFilter("all");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Impossible de tout marquer comme lu.");
    } finally {
      setMarkAllBusy(false);
    }
  };

  const onCopyLink = (value: string) => {
    setCopyHint(value.length <= 16 ? `Id copié : ${value}` : "Lien copié");
  };

  const panelBody = (
    <>
      <div className="border-b-2 border-violet-100 px-4 py-3 pt-safe sm:pt-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-extrabold text-slate-950">Notifications</p>
          <div className="flex items-center gap-2">
            <Link
              href="/inbox"
              onClick={() => setOpen(false)}
              className="text-[11px] font-bold text-violet-800 hover:underline"
            >
              Inbox
            </Link>
            <button
              type="button"
              disabled={markAllBusy}
              className="text-[11px] font-bold text-violet-800 hover:underline disabled:opacity-40"
              onClick={() => void markAllRead()}
            >
              {markAllBusy ? "…" : "Tout lu"}
            </button>
            {isNarrow ? (
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="touch-target inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700"
                aria-label="Fermer les notifications"
              >
                Fermer
              </button>
            ) : null}
          </div>
        </div>
        <div className="mt-2 flex gap-1 rounded-lg bg-slate-100 p-0.5">
          {(
            [
              ["unread", "Non lues"],
              ["all", "Toutes"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={`flex-1 rounded-md px-2 py-2 text-[11px] font-bold transition-colors ${
                filter === id ? "bg-white text-violet-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {actionError ? (
        <p className="border-b border-red-100 bg-red-50 px-4 py-2 text-xs font-medium text-red-800">{actionError}</p>
      ) : null}
      {copyHint ? (
        <p className="border-b border-emerald-100 bg-emerald-50 px-4 py-2 text-xs font-medium text-emerald-900">
          {copyHint}
        </p>
      ) : null}

      <ul className={`overflow-auto ${isNarrow ? "flex-1 pb-safe" : "max-h-[min(70vh,24rem)]"}`}>
        {notifs.isLoading ? (
          <li className="px-4 py-6 text-center text-sm text-slate-500">Chargement…</li>
        ) : (notifs.data || []).length === 0 ? (
          <li className="px-4 py-6 text-center text-sm font-medium text-slate-600">
            {filter === "unread" ? "Aucune notification non lue." : "Aucune notification récente."}
          </li>
        ) : (
          notifs.data!.map((n) => (
            <NotificationItemRow
              key={n.id}
              notification={n}
              busy={busyId === n.id}
              onNavigate={(href, mark) => void navigateFromNotification(n, href, mark)}
              onMarkRead={() => void markRead(n.id)}
              onCopyLink={onCopyLink}
              onDelete={() => void deleteNotification(n.id)}
            />
          ))
        )}
      </ul>
    </>
  );

  const panel = open ? (
    isNarrow && mounted ? (
      createPortal(
        <div className="fixed inset-0 z-[80] sm:hidden" role="dialog" aria-modal="true" aria-label="Notifications">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/45 backdrop-blur-sm"
            aria-label="Fermer les notifications"
            onClick={() => setOpen(false)}
          />
          <div
            ref={panelRef}
            className="absolute inset-x-0 bottom-0 top-[max(0.75rem,var(--safe-top))] flex flex-col overflow-hidden rounded-t-3xl border-2 border-violet-200 bg-white shadow-2xl"
          >
            <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-slate-300" aria-hidden />
            {panelBody}
          </div>
        </div>,
        document.body,
      )
    ) : (
      <div
        ref={panelRef}
        className="absolute right-0 z-40 mt-2 hidden w-[min(100vw-1.5rem,26rem)] overflow-hidden rounded-2xl border-2 border-violet-200 bg-white shadow-xl sm:block"
      >
        {panelBody}
      </div>
    )
  ) : null;

  return (
    <>
      <div className="relative shrink-0" ref={rootRef}>
        <button
          type="button"
          onClick={() => {
            setActionError("");
            setOpen((v) => !v);
          }}
          className="touch-target relative inline-flex items-center justify-center rounded-xl border-2 border-amber-300 bg-amber-50 px-3 text-lg shadow-sm hover:bg-amber-100"
          aria-label="Notifications dirigeant"
          aria-expanded={open}
        >
          🔔
          {badgeCount > 0 ? (
            <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-extrabold text-white ring-2 ring-white">
              {badgeCount > 9 ? "9+" : badgeCount}
            </span>
          ) : null}
        </button>
        {!isNarrow ? panel : null}
      </div>
      {isNarrow ? panel : null}

      {toast ? (
        <DirectorToast
          notification={toast}
          onDismiss={() => setToast(null)}
          onNavigate={(href) => {
            setToast(null);
            router.push(href);
          }}
          onMarkRead={() => void markRead(toast.id)}
        />
      ) : null}
    </>
  );
}
