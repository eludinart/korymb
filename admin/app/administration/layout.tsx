"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/administration/dashboard", label: "Tableau de bord santé" },
  { href: "/administration/agents", label: "Agents métiers" },
  { href: "/administration/playbooks", label: "Playbooks" },
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
      <aside className="shrink-0 rounded-2xl border-2 border-violet-200 bg-white p-3 shadow-md sm:p-4 lg:sticky lg:top-28 lg:w-64">
        <p className="text-xs font-extrabold uppercase tracking-wider text-violet-800">Administration</p>
        <nav className="-mx-1 mt-3 flex gap-2 overflow-x-auto pb-2 lg:mx-0 lg:flex-col lg:overflow-visible lg:pb-0">
          {LINKS.map((l) => {
            const active =
              pathname === l.href ||
              pathname.startsWith(`${l.href}/`) ||
              (l.href === "/administration/dashboard" && pathname === "/administration");
            return (
              <Link
                key={l.href}
                href={l.href}
                className={active ? "admin-nav-link admin-nav-link-active" : "admin-nav-link admin-nav-link-idle"}
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
