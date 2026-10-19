"use client";

import Link from "next/link";

const linkClass =
  "rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-violet-800 ring-1 ring-violet-200 hover:bg-violet-100 dark:bg-slate-900 dark:text-violet-100 dark:ring-violet-700";

/** Où lire le travail de la flotte, pendant que l'assistant reste l'interlocuteur du chat. */
export default function ChatFleetRelayNote({ label, jobId }: { label: string; jobId?: string }) {
  const mission = jobId ? `/missions?job=${encodeURIComponent(jobId)}` : "/missions";
  const livrables = jobId ? `/gestion/livrables?job=${encodeURIComponent(jobId)}` : "/gestion/livrables";
  const links = [
    { href: mission, label: "Missions" },
    { href: "/briefing", label: "Briefing" },
    { href: livrables, label: "Livrables" },
    { href: "/inbox", label: "Décisions" },
  ];
  return (
    <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 dark:border-violet-800 dark:bg-violet-950/40">
      <p className="text-xs text-violet-950 dark:text-violet-100">
        Le détail de la flotte « {label} » se consulte dans Korymb.
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {links.map((item) => (
          <Link key={item.href + item.label} href={item.href} className={linkClass}>
            {item.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
