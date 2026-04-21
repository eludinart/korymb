"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/dashboard", label: "Metier" },
  { href: "/missions", label: "Missions" },
  { href: "/chat", label: "Chat" },
  { href: "/historique", label: "Historique" },
  { href: "/configuration", label: "Configuration" },
  { href: "/administration", label: "Administration" },
  { href: "/mission/nouvelle", label: "Nouvelle mission" },
  { href: "/mission/guided", label: "Mission guidee" },
];

export default function AppNav() {
  const pathname = usePathname() || "";
  const adminActive = pathname === "/administration" || pathname.startsWith("/administration/");
  return (
    <div className="flex min-w-0 flex-1 flex-col items-end gap-2">
      <nav className="flex flex-wrap justify-end gap-2">
        {NAV.map((item) => {
          const active =
            pathname === item.href ||
            (item.href !== "/administration" && pathname.startsWith(`${item.href}/`)) ||
            (item.href === "/administration" && adminActive);
          return (
            <Link
              key={item.href}
              href={item.href === "/administration" ? "/administration/dashboard" : item.href}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      {adminActive ? (
        <nav className="flex flex-wrap justify-end gap-1.5 border-t border-slate-100 pt-2 text-xs" aria-label="Sous-menu administration">
          <Link
            href="/administration/dashboard"
            className={`rounded-full px-2.5 py-1 font-medium ${
              pathname.startsWith("/administration/dashboard") || pathname === "/administration"
                ? "bg-violet-100 text-violet-900"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            Santé & outils
          </Link>
          <Link
            href="/administration/agents"
            className={`rounded-full px-2.5 py-1 font-medium ${
              pathname.startsWith("/administration/agents") ? "bg-violet-100 text-violet-900" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            Agents & mémoire
          </Link>
        </nav>
      ) : null}
    </div>
  );
}
