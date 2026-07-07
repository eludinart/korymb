"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  GESTION_NAV_LINKS,
  GESTION_QUICK_ACTIONS,
  isGestionLinkActive,
} from "../../lib/gestionNav";

export default function GestionLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "";

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
      <aside className="shrink-0 rounded-2xl border-2 border-emerald-200 bg-white p-3 shadow-md sm:p-4 lg:sticky lg:top-28 lg:w-64">
        <p className="text-xs font-extrabold uppercase tracking-wider text-emerald-800">Gestion</p>
        <p className="mt-1 px-2 text-[11px] leading-snug text-slate-500">
          Pilotage commercial & opérationnel · factures via Tiime
        </p>
        <nav className="-mx-1 mt-3 space-y-1 lg:mx-0" aria-label="Modules gestion">
          {GESTION_NAV_LINKS.map((item) => {
            const active = isGestionLinkActive(pathname, item);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`${active ? "gestion-nav-link gestion-nav-link-active" : "gestion-nav-link gestion-nav-link-idle"} flex items-center gap-2.5`}
              >
                <span className="text-base leading-none" aria-hidden>
                  {item.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{item.label}</span>
                  <span className={`block truncate text-[10px] font-medium ${active ? "text-emerald-100" : "text-slate-500"}`}>
                    {item.hint}
                  </span>
                </span>
              </Link>
            );
          })}
        </nav>
        <div className="mt-4 border-t border-emerald-100 pt-3">
          <p className="px-2 text-[10px] font-extrabold uppercase tracking-wider text-slate-500">Actions rapides</p>
          <div className="mt-1 space-y-1">
            {GESTION_QUICK_ACTIONS.map((action) => (
              <Link
                key={action.id}
                href={action.href}
                className="gestion-nav-link gestion-nav-link-idle block text-sm !py-2.5 !font-semibold"
              >
                + {action.label}
              </Link>
            ))}
          </div>
        </div>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
