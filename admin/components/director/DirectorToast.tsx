"use client";

import Link from "next/link";
import { useEffect } from "react";

type Props = {
  notification: { title: string; body?: string; action_url?: string };
  onDismiss: () => void;
};

export default function DirectorToast({ notification, onDismiss }: Props) {
  useEffect(() => {
    const t = window.setTimeout(onDismiss, 8000);
    return () => window.clearTimeout(t);
  }, [onDismiss]);

  return (
    <div className="fixed bottom-4 left-3 right-3 z-50 mx-auto max-w-sm rounded-2xl border-2 border-violet-300 bg-white p-4 shadow-2xl sm:left-auto sm:right-4">
      <p className="text-base font-extrabold text-slate-950">{notification.title}</p>
      {notification.body ? <p className="mt-1 text-sm font-semibold text-slate-700">{notification.body}</p> : null}
      <div className="mt-3 flex gap-2">
        {notification.action_url ? (
          <Link href={notification.action_url} onClick={onDismiss} className="btn-primary flex-1 text-center">
            Voir
          </Link>
        ) : null}
        <button type="button" onClick={onDismiss} className="btn-secondary px-3">
          Fermer
        </button>
      </div>
    </div>
  );
}
