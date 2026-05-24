"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/administration/dashboard", label: "Tableau de bord santé" },
  { href: "/administration/agents", label: "Agents métiers" },
  { href: "/administration/orchestration", label: "Orchestration CIO" },
  { href: "/administration/comportements", label: "Comportements moteur" },
  { href: "/administration/templates", label: "Templates de missions" },
  { href: "/administration/memory", label: "Mémoire entreprise" },
  { href: "/administration/budget", label: "Budget & Coûts" },
  { href: "/administration/autonomie", label: "Tâches autonomes" },
  { href: "/administration/approbations", label: "Approbations" },
];

export default function AdministrationLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
      <aside className="shrink-0 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4 lg:w-60">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Administration</p>
        <nav className="-mx-1 mt-3 flex gap-2 overflow-x-auto pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:pb-0">
          {LINKS.map((l) => {
            const active =
              pathname === l.href ||
              pathname.startsWith(`${l.href}/`) ||
              (l.href === "/administration/dashboard" && pathname === "/administration");
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`shrink-0 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors lg:w-full ${
                  active ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100 active:bg-slate-200"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="min-w-0 flex-1 space-y-6">{children}</div>
    </div>
  );
}
