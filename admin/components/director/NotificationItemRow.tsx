"use client";

import { useState } from "react";
import {
  buildNotificationActions,
  formatNotificationWhen,
  notificationKindLabel,
  notificationKindStyle,
  notificationShareUrl,
  type DirectorNotification,
} from "../../lib/directorNotificationUi";
import { BTN_DELETE } from "../../lib/deleteMissionBundle";

type Props = {
  notification: DirectorNotification;
  busy?: boolean;
  onNavigate: (href: string, markRead: boolean) => void;
  onMarkRead: () => void;
  onCopyLink: (url: string) => void;
  onDelete: () => void;
};

export default function NotificationItemRow({
  notification: n,
  busy = false,
  onNavigate,
  onMarkRead,
  onCopyLink,
  onDelete,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const actions = buildNotificationActions(n);
  const primary = actions.find((a) => a.primary) || actions[0];
  const secondary = actions.filter((a) => a !== primary);
  const body = String(n.body || "").trim();
  const longBody = body.length > 140;
  const isUnread = !n.read_at;

  return (
    <li
      className={`border-b border-slate-100 px-4 py-3 ${isUnread ? "bg-violet-50/40" : "bg-white"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${notificationKindStyle(n.kind)}`}
            >
              {notificationKindLabel(n.kind)}
            </span>
            {n.created_at ? (
              <span className="text-[10px] font-medium text-slate-400">{formatNotificationWhen(n.created_at)}</span>
            ) : null}
            {n.job_id ? (
              <span className="font-mono text-[10px] text-slate-400">#{String(n.job_id).slice(0, 8)}</span>
            ) : null}
          </div>
          <p className="mt-1 text-sm font-extrabold leading-snug text-slate-950">{n.title}</p>
          {body ? (
            <div className="mt-1">
              <p className={`text-sm font-medium text-slate-700 ${expanded || !longBody ? "" : "line-clamp-2"}`}>
                {body}
              </p>
              {longBody ? (
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  className="mt-0.5 text-[11px] font-semibold text-violet-800 hover:underline"
                >
                  {expanded ? "Réduire" : "Voir plus"}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        {isUnread ? (
          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-violet-600" title="Non lue" aria-hidden />
        ) : null}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {primary ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onNavigate(primary.href, true)}
            className="min-h-10 rounded-lg bg-violet-700 px-3 py-2 text-xs font-bold text-white hover:bg-violet-800 disabled:opacity-50"
          >
            {busy ? "…" : primary.label}
          </button>
        ) : null}

        {secondary.slice(0, 2).map((a) => (
          <button
            key={a.id}
            type="button"
            disabled={busy}
            onClick={() => onNavigate(a.href, true)}
            className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          >
            {a.label}
          </button>
        ))}

        <button
          type="button"
          disabled={busy || !isUnread}
          onClick={() => onMarkRead()}
          className="min-h-10 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-40"
        >
          Marquer lu
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={() => onDelete()}
          className={BTN_DELETE}
        >
          {busy ? "…" : "Supprimer"}
        </button>

        <div className="relative">
          <button
            type="button"
            disabled={busy}
            onClick={() => setMenuOpen((v) => !v)}
            className="touch-target inline-flex items-center justify-center rounded-lg border border-slate-200 px-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
            aria-expanded={menuOpen}
            aria-label="Plus d'options"
          >
            ⋯
          </button>
          {menuOpen ? (
            <>
              <button
                type="button"
                className="fixed inset-0 z-10 cursor-default"
                aria-label="Fermer le menu"
                onClick={() => setMenuOpen(false)}
              />
              <div className="absolute right-0 z-20 mt-1 min-w-[10rem] rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                {actions.map((a) => (
                  <button
                    key={`menu-${a.id}`}
                    type="button"
                    className="block w-full px-3 py-2 text-left text-xs font-medium text-slate-800 hover:bg-slate-50"
                    onClick={() => {
                      setMenuOpen(false);
                      onNavigate(a.href, true);
                    }}
                  >
                    {a.label}
                  </button>
                ))}
                {primary ? (
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left text-xs font-medium text-slate-800 hover:bg-slate-50"
                    onClick={() => {
                      setMenuOpen(false);
                      window.open(notificationShareUrl(primary.href), "_blank", "noopener,noreferrer");
                    }}
                  >
                    Nouvel onglet
                  </button>
                ) : null}
                {primary ? (
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left text-xs font-medium text-slate-800 hover:bg-slate-50"
                    onClick={() => {
                      setMenuOpen(false);
                      const url = notificationShareUrl(primary.href);
                      void navigator.clipboard?.writeText(url).catch(() => undefined);
                      onCopyLink(url);
                    }}
                  >
                    Copier le lien
                  </button>
                ) : null}
                {n.job_id ? (
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left text-xs font-medium text-slate-800 hover:bg-slate-50"
                    onClick={() => {
                      setMenuOpen(false);
                      void navigator.clipboard?.writeText(String(n.job_id));
                      onCopyLink(String(n.job_id));
                    }}
                  >
                    Copier l&apos;id mission
                  </button>
                ) : null}
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left text-xs font-medium text-red-800 hover:bg-red-50"
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete();
                  }}
                >
                  Supprimer
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </li>
  );
}
