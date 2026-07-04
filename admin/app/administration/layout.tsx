"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADMIN_NAV_GROUPS, isAdminLinkActive } from "../../lib/adminNav";
import { useRepriseCoverage } from "../../lib/repriseCoverage";

function RepriseNavBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-auto inline-flex min-h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-extrabold leading-none text-white">
      {count > 9 ? "9+" : count}
    </span>
  );
}

export default function AdministrationLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const reprise = useRepriseCoverage();
  const repriseGapCount = reprise.data?.gaps?.length ?? 0;

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
      <aside className="shrink-0 rounded-2xl border-2 border-violet-200 bg-white p-3 shadow-md sm:p-4 lg:sticky lg:top-28 lg:w-64">
        <p className="text-xs font-extrabold uppercase tracking-wider text-violet-800">Administration</p>
        <nav className="-mx-1 mt-3 space-y-4 lg:mx-0">
          {ADMIN_NAV_GROUPS.map((group) => (
            <div key={group.id}>
              <p className="px-2 text-[10px] font-extrabold uppercase tracking-wider text-slate-500">{group.label}</p>
              <div className="mt-1 flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
                {group.links.map((l) => {
                  const active = isAdminLinkActive(pathname, l.href);
                  const showBadge = l.href === "/administration/reprise" && repriseGapCount > 0;
                  return (
                    <Link
                      key={l.href}
                      href={l.href}
                      className={`${active ? "admin-nav-link admin-nav-link-active" : "admin-nav-link admin-nav-link-idle"} inline-flex items-center gap-2`}
                    >
                      <span className="min-w-0 truncate">{l.label}</span>
                      {showBadge ? <RepriseNavBadge count={repriseGapCount} /> : null}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 flex-1 space-y-6">{children}</div>
    </div>
  );
}
