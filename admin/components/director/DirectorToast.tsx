"use client";

import { useEffect } from "react";
import {
  buildNotificationActions,
  notificationKindLabel,
  type DirectorNotification,
} from "../../lib/directorNotificationUi";

type Props = {
  notification: DirectorNotification;
  onDismiss: () => void;
  onNavigate?: (url: string) => void;
  onMarkRead?: () => void;
};

export default function DirectorToast({ notification, onDismiss, onNavigate, onMarkRead }: Props) {
  const actions = buildNotificationActions(notification);
  const primary = actions.find((a) => a.primary) || actions[0];
  const secondary = actions.find((a) => a !== primary);

  useEffect(() => {
    const t = window.setTimeout(onDismiss, 12000);
    return () => window.clearTimeout(t);
  }, [onDismiss]);

  return (
    <div className="fixed bottom-4 left-3 right-3 z-50 mx-auto max-w-sm rounded-2xl border-2 border-violet-300 bg-white p-4 shadow-2xl sm:left-auto sm:right-4">
      <p className="text-[10px] font-bold uppercase tracking-wide text-violet-800">
        {notificationKindLabel(notification.kind)}
      </p>
      <p className="mt-1 text-base font-extrabold text-slate-950">{notification.title}</p>
      {notification.body ? (
        <p className="mt-1 line-clamp-3 text-sm font-semibold text-slate-700">{notification.body}</p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {primary && onNavigate ? (
          <button
            type="button"
            onClick={() => {
              onMarkRead?.();
              onNavigate(primary.href);
            }}
            className="btn-primary flex-1 text-center text-sm"
          >
            {primary.label}
          </button>
        ) : null}
        {secondary && onNavigate ? (
          <button
            type="button"
            onClick={() => {
              onMarkRead?.();
              onNavigate(secondary.href);
            }}
            className="btn-secondary flex-1 text-center text-sm"
          >
            {secondary.label}
          </button>
        ) : null}
        <button type="button" onClick={onDismiss} className="btn-secondary px-3 text-sm">
          Plus tard
        </button>
      </div>
    </div>
  );
}
