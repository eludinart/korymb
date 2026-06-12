"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADMIN_NAV_LINKS, isAdminLinkActive } from "../../lib/adminNav";

const LINKS = ADMIN_NAV_LINKS;

export default function AdministrationLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
      <aside className="shrink-0 rounded-2xl border-2 border-violet-200 bg-white p-3 shadow-md sm:p-4 lg:sticky lg:top-28 lg:w-64">
        <p className="text-xs font-extrabold uppercase tracking-wider text-violet-800">Administration</p>
        <nav className="-mx-1 mt-3 flex gap-2 overflow-x-auto pb-2 lg:mx-0 lg:flex-col lg:overflow-visible lg:pb-0">
          {LINKS.map((l) => {
            const active = isAdminLinkActive(pathname, l.href);
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
