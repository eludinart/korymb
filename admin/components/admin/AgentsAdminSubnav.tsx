"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/administration/equipes", label: "Équipes", match: (p: string) => p.startsWith("/administration/equipes") || p.startsWith("/administration/agent-groups") },
  { href: "/administration/agents", label: "Fiches agents", match: (p: string) => p === "/administration/agents" || (p.startsWith("/administration/agents/") && !p.startsWith("/administration/agents/nouveau")) },
  { href: "/administration/agents/nouveau", label: "+ Nouvel agent", match: (p: string) => p.startsWith("/administration/agents/nouveau") },
] as const;

/** Sous-navigation locale : uniquement sur le périmètre gestion des agents. */
export default function AgentsAdminSubnav() {
  const pathname = usePathname() || "";

  return (
    <div className="rounded-2xl border-2 border-violet-300 bg-gradient-to-r from-violet-100 via-white to-violet-50 p-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-wider text-violet-800">Gestion des agents</p>
          <p className="mt-0.5 text-xs text-slate-600">
            Équipes · fiches · mémoire (onglet dans chaque équipe)
          </p>
        </div>
        <nav className="flex flex-wrap gap-1.5" aria-label="Navigation gestion des agents">
          {TABS.map((t) => {
            const active = t.match(pathname);
            return (
              <Link
                key={t.href}
                href={t.href}
                className={
                  active
                    ? "rounded-xl bg-violet-700 px-3 py-2 text-sm font-bold text-white shadow-sm"
                    : "rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm font-bold text-violet-900 hover:bg-violet-50"
                }
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
