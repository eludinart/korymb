"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useRepriseCoverage } from "../lib/repriseCoverage";

const NAV_PRIORITY = [
  { href: "/briefing", label: "Briefing", priority: true },
  { href: "/inbox", label: "Inbox", priority: true },
  { href: "/administration/reprise", label: "Audit reprise", priority: true },
  { href: "/dashboard", label: "Métier" },
  { href: "/missions", label: "Missions" },
  { href: "/chat", label: "Chat" },
  { href: "/historique", label: "Historique" },
  { href: "/mission/nouvelle", label: "Nouvelle mission" },
  { href: "/mission/guided", label: "Mission guidée" },
  { href: "/configuration", label: "Configuration" },
  { href: "/administration", label: "Administration" },
];

const ADMIN_SUB = [
  { href: "/administration/dashboard", label: "Santé & outils" },
  { href: "/administration/agents", label: "Agents & mémoire" },
  { href: "/administration/playbooks", label: "Playbooks" },
  { href: "/administration/approbations", label: "Approbations" },
];

function isNavActive(pathname: string, href: string, adminActive: boolean) {
  return (
    pathname === href ||
    (href !== "/administration" && pathname.startsWith(`${href}/`)) ||
    (href === "/administration" && adminActive)
  );
}

function drawerLinkClass(active: boolean, priority?: boolean) {
  const base = active ? "nav-drawer-link nav-drawer-link-active" : "nav-drawer-link nav-drawer-link-idle";
  return priority && !active ? `${base} nav-drawer-link-priority` : base;
}

function desktopLinkClass(active: boolean, priority?: boolean) {
  if (active) return "rounded-full bg-violet-700 px-3 py-2.5 text-sm font-bold text-white shadow-sm";
  if (priority)
    return "rounded-full border-2 border-amber-300 bg-amber-50 px-3 py-2.5 text-sm font-bold text-amber-950 hover:bg-amber-100";
  return "rounded-full px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-violet-50";
}

function RepriseNavBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-1.5 inline-flex min-h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-extrabold leading-none text-white">
      {count > 9 ? "9+" : count}
    </span>
  );
}

function NavLabel({ item, gapCount }: { item: (typeof NAV_PRIORITY)[number]; gapCount: number }) {
  if (item.href !== "/administration/reprise") return item.label;
  return (
    <>
      {item.label}
      <RepriseNavBadge count={gapCount} />
    </>
  );
}

export default function AppNav() {
  const pathname = usePathname() || "";
  const adminActive = pathname === "/administration" || pathname.startsWith("/administration/");
  const [menuOpen, setMenuOpen] = useState(false);
  const reprise = useRepriseCoverage();
  const repriseGapCount = reprise.data?.gaps?.length ?? 0;

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  useEffect(() => {
    closeMenu();
  }, [pathname, closeMenu]);

  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  const navLinks = (
    <>
      {NAV_PRIORITY.map((item) => {
        const active = isNavActive(pathname, item.href, adminActive);
        return (
          <Link
            key={item.href}
            href={item.href === "/administration" ? "/administration/dashboard" : item.href}
            onClick={closeMenu}
            className={`${drawerLinkClass(active, item.priority)} inline-flex items-center`}
          >
            <NavLabel item={item} gapCount={repriseGapCount} />
          </Link>
        );
      })}
      {adminActive ? (
        <div className="mt-3 space-y-1 border-t-2 border-violet-100 pt-3" aria-label="Sous-menu administration">
          <p className="px-2 text-xs font-extrabold uppercase tracking-wider text-violet-700">Administration</p>
          {ADMIN_SUB.map((item) => {
            const active =
              pathname.startsWith(item.href) ||
              (item.href === "/administration/dashboard" && pathname === "/administration");
            return (
              <Link key={item.href} href={item.href} onClick={closeMenu} className={drawerLinkClass(active)}>
                {item.label}
              </Link>
            );
          })}
        </div>
      ) : null}
    </>
  );

  return (
    <>
      <div className="hidden min-w-0 flex-1 flex-col items-end gap-2 xl:flex">
        <nav className="flex flex-wrap justify-end gap-2">
          {NAV_PRIORITY.map((item) => {
            const active = isNavActive(pathname, item.href, adminActive);
            return (
              <Link
                key={item.href}
                href={item.href === "/administration" ? "/administration/dashboard" : item.href}
                className={`${desktopLinkClass(active, item.priority)} inline-flex items-center`}
              >
                <NavLabel item={item} gapCount={repriseGapCount} />
              </Link>
            );
          })}
        </nav>
        {adminActive ? (
          <nav className="flex flex-wrap justify-end gap-1.5 border-t border-violet-100 pt-2 text-xs" aria-label="Sous-menu administration">
            {ADMIN_SUB.map((item) => {
              const active =
                pathname.startsWith(item.href) ||
                (item.href === "/administration/dashboard" && pathname === "/administration");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-full px-2.5 py-1.5 font-bold ${
                    active ? "bg-violet-100 text-violet-900 ring-1 ring-violet-200" : "text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2 xl:hidden">
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          className="touch-target inline-flex items-center justify-center rounded-xl border-2 border-violet-300 bg-violet-700 px-4 text-sm font-extrabold text-white shadow-md hover:bg-violet-800"
          aria-expanded={menuOpen}
          aria-controls="app-mobile-nav"
        >
          Menu
        </button>
      </div>

      {menuOpen ? (
        <div className="fixed inset-0 z-50 xl:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm"
            aria-label="Fermer le menu"
            onClick={closeMenu}
          />
          <div id="app-mobile-nav" className="nav-drawer">
            <div className="flex items-center justify-between gap-2 border-b-2 border-violet-100 px-4 py-4">
              <p className="text-base font-extrabold text-slate-950">Navigation</p>
              <button type="button" onClick={closeMenu} className="btn-secondary px-3 py-2 text-sm">
                Fermer
              </button>
            </div>
            <nav className="flex-1 space-y-1.5 overflow-y-auto px-3 py-4 pb-safe">{navLinks}</nav>
          </div>
        </div>
      ) : null}
    </>
  );
}
