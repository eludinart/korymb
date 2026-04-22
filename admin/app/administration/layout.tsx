"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/administration/dashboard", label: "Tableau de bord santé" },
  { href: "/administration/agents", label: "Agents métiers" },
  { href: "/administration/templates", label: "Templates de missions" },
  { href: "/administration/memory", label: "Mémoire entreprise" },
  { href: "/administration/budget", label: "Budget & Coûts" },
  { href: "/administration/autonomie", label: "Tâches autonomes" },
  { href: "/administration/approbations", label: "Approbations" },
];

export default function AdministrationLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
      <aside className="shrink-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:w-60">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Administration</p>
        <nav className="mt-3 flex flex-col gap-1">
          {LINKS.map((l) => {
            const active =
              pathname === l.href ||
              pathname.startsWith(`${l.href}/`) ||
              (l.href === "/administration/dashboard" && pathname === "/administration");
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                  active ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
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
