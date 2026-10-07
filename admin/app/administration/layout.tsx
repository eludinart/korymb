"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import AgentsAdminSubnav from "../../components/admin/AgentsAdminSubnav";
import { ADMIN_NAV_GROUPS, filterAdminNavGroups, isAdminLinkActive, isAgentsAdminPath } from "../../lib/adminNav";
import { useRepriseCoverage } from "../../lib/repriseCoverage";
import { useUiMode } from "../../lib/uiMode";

function RepriseNavBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-auto inline-flex min-h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-extrabold leading-none text-white">
      {count > 9 ? "9+" : count}
    </span>
  );
}

export default function AdministrationLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "";
  const { showAdvanced } = useUiMode();
  const essentialNav = !showAdvanced;
  const adminGroups = filterAdminNavGroups(ADMIN_NAV_GROUPS, { essential: essentialNav });
  const [platformOwner, setPlatformOwner] = useState(false);
  const reprise = useRepriseCoverage();

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setPlatformOwner(Boolean(d?.is_platform_owner)))
      .catch(() => setPlatformOwner(false));
  }, []);
  const repriseGapCount = reprise.data?.gaps?.length ?? 0;
  const agentsZone = isAgentsAdminPath(pathname);
  const asideRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const aside = asideRef.current;
    if (!aside || !window.matchMedia("(min-width: 1024px)").matches) return;
    const active = aside.querySelector<HTMLElement>("[data-admin-nav-active='true']");
    if (!active) return;
    const asideRect = aside.getBoundingClientRect();
    const linkRect = active.getBoundingClientRect();
    if (linkRect.top >= asideRect.top && linkRect.bottom <= asideRect.bottom) return;
    const delta = linkRect.top - asideRect.top;
    const target = aside.scrollTop + delta - (aside.clientHeight - active.clientHeight) / 2;
    aside.scrollTop = Math.max(0, target);
  }, [pathname]);

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
      <aside
        ref={asideRef}
        className="shrink-0 rounded-2xl border-2 border-violet-200 bg-white p-3 shadow-md dark:border-violet-800 dark:bg-slate-900 sm:p-4 lg:sticky lg:top-[calc(var(--app-header-offset,0px)+0.75rem)] lg:z-20 lg:max-h-[calc(100dvh-var(--app-header-offset,0px)-1.5rem)] lg:w-64 lg:self-start lg:overflow-y-auto lg:overscroll-y-contain lg:[scrollbar-width:thin]"
      >
        <p className="text-xs font-extrabold uppercase tracking-wider text-violet-800 dark:text-violet-300">Administration</p>
        <nav className="-mx-1 mt-3 space-y-4 lg:mx-0">
          {adminGroups.map((group) => {
            const agentsBlock = group.emphasis === "agents";
            return (
              <div
                key={group.id}
                className={
                  agentsBlock
                    ? "rounded-xl border-2 border-violet-300 bg-violet-50/80 p-2 ring-1 ring-violet-100 dark:border-violet-700 dark:bg-violet-950/50 dark:ring-violet-900"
                    : undefined
                }
              >
                <p
                  className={`px-2 text-[10px] font-extrabold uppercase tracking-wider ${
                    agentsBlock ? "text-violet-800 dark:text-violet-300" : "text-slate-500 dark:text-slate-400"
                  }`}
                >
                  {group.label}
                </p>
                {group.id === "moteur" ? (
                  <p className="px-2 pb-0.5 text-[10px] leading-snug text-slate-400 dark:text-slate-500">Réglages experts du moteur</p>
                ) : null}
                <div className="h-scroll-nav mt-1 lg:flex-col lg:overflow-visible lg:pb-0">
                  {group.links.map((l) => {
                    const active = isAdminLinkActive(pathname, l.href);
                    const showBadge = l.href === "/administration/reprise" && repriseGapCount > 0;
                    return (
                      <Link
                        key={l.href}
                        href={l.href}
                        data-admin-nav-active={active ? "true" : undefined}
                        className={`${active ? "admin-nav-link admin-nav-link-active" : "admin-nav-link admin-nav-link-idle"} inline-flex shrink-0 items-center gap-2`}
                      >
                        <span className="min-w-0 truncate">{l.label}</span>
                        {showBadge ? <RepriseNavBadge count={repriseGapCount} /> : null}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {platformOwner && showAdvanced ? (
            <div>
              <p className="px-2 text-[10px] font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Instance
              </p>
              <div className="mt-1 space-y-1">
                {(
                  [
                    { href: "/administration/portefeuille", label: "Mes clients" },
                    { href: "/administration/enveloppes", label: "Enveloppes IA" },
                  ] as const
                ).map((item) => {
                  const active = isAdminLinkActive(pathname, item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      data-admin-nav-active={active ? "true" : undefined}
                      className={`${
                        active ? "admin-nav-link admin-nav-link-active" : "admin-nav-link admin-nav-link-idle"
                      } inline-flex shrink-0 items-center gap-2`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ) : null}
        </nav>
      </aside>
      <div className="min-w-0 flex-1 space-y-6">
        {agentsZone && showAdvanced ? <AgentsAdminSubnav /> : null}
        {children}
      </div>
    </div>
  );
}
