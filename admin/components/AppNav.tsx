"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRepriseCoverage } from "../lib/repriseCoverage";
import { ADMIN_NAV_GROUPS, isAdminLinkActive } from "../lib/adminNav";
import {
  GESTION_HUB_HREF,
  GESTION_NAV_LINKS,
  GESTION_QUICK_ACTIONS,
  isGestionLinkActive,
  isGestionPath,
} from "../lib/gestionNav";

type NavPrimaryItem = { href: string; label: string; priority?: boolean };

const NAV_PRIMARY: NavPrimaryItem[] = [
  { href: "/briefing", label: "Briefing", priority: true },
  { href: "/inbox", label: "Inbox", priority: true },
  { href: "/missions", label: "Missions", priority: true },
  { href: "/chat", label: "Chat" },
];

const NAV_MORE = [
  { href: "/livrables", label: "Livrables" },
  { href: "/dashboard", label: "Vue agents" },
  { href: "/configuration", label: "Configuration" },
  { href: "/administration", label: "Administration" },
] as const;

function isNavActive(pathname: string, href: string) {
  if (href === "/administration") {
    return pathname === "/administration" || pathname.startsWith("/administration/");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function isMoreSectionActive(pathname: string, items: readonly { href: string }[]) {
  return items.some((item) => isNavActive(pathname, item.href));
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

function desktopGestionTriggerClass(active: boolean) {
  if (active) return "rounded-full bg-emerald-700 px-3 py-2.5 text-sm font-bold text-white shadow-sm";
  return "rounded-full border-2 border-emerald-300 bg-emerald-50 px-3 py-2.5 text-sm font-bold text-emerald-950 hover:bg-emerald-100";
}

function RepriseNavBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-1.5 inline-flex min-h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-extrabold leading-none text-white">
      {count > 9 ? "9+" : count}
    </span>
  );
}

function adminHref(href: string) {
  return href === "/administration" ? "/administration/dashboard" : href;
}

export default function AppNav() {
  const pathname = usePathname() || "";
  const adminActive = pathname === "/administration" || pathname.startsWith("/administration/");
  const gestionActive = isGestionPath(pathname);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [gestionOpen, setGestionOpen] = useState(false);
  const [canAdmin, setCanAdmin] = useState(true);
  const moreRef = useRef<HTMLDivElement>(null);
  const gestionRef = useRef<HTMLDivElement>(null);
  const reprise = useRepriseCoverage();
  const repriseGapCount = reprise.data?.gaps?.length ?? 0;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.user) {
          setCanAdmin(true);
          return;
        }
        setCanAdmin(d.role === "admin");
      })
      .catch(() => setCanAdmin(true));
  }, []);

  const navMore = NAV_MORE.filter(
    (item) => canAdmin || (item.href !== "/administration" && item.href !== "/configuration"),
  );
  const moreActive = isMoreSectionActive(pathname, navMore);

  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const closeMore = useCallback(() => setMoreOpen(false), []);
  const closeGestion = useCallback(() => setGestionOpen(false), []);

  useEffect(() => {
    closeMenu();
    closeMore();
    closeGestion();
  }, [pathname, closeMenu, closeMore, closeGestion]);

  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen, closeMenu]);

  useEffect(() => {
    if (!moreOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  useEffect(() => {
    if (!gestionOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (gestionRef.current && !gestionRef.current.contains(e.target as Node)) setGestionOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setGestionOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [gestionOpen]);

  const gestionDropdown = (onNavigate: () => void, variant: "desktop" | "drawer") => (
    <>
      {GESTION_NAV_LINKS.map((item) => {
        const active = isGestionLinkActive(pathname, item);
        const cls =
          variant === "desktop"
            ? `flex items-start gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                active ? "bg-emerald-100 text-emerald-950" : "text-slate-800 hover:bg-slate-50"
              }`
            : `${drawerLinkClass(active)} flex items-center gap-2.5 !py-3`;
        return (
          <Link key={item.href} href={item.href} onClick={onNavigate} className={cls}>
            <span className="text-lg leading-none" aria-hidden>
              {item.icon}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-bold">{item.label}</span>
              {variant === "desktop" ? (
                <span className="block text-[11px] font-medium text-slate-500">{item.hint}</span>
              ) : null}
            </span>
          </Link>
        );
      })}
      {variant === "desktop" ? (
        <div className="mt-2 border-t border-slate-100 pt-2">
          <p className="px-3 pb-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Actions</p>
          {GESTION_QUICK_ACTIONS.map((action) => (
            <Link
              key={action.id}
              href={action.href}
              onClick={onNavigate}
              className="block rounded-xl px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50"
            >
              + {action.label}
            </Link>
          ))}
        </div>
      ) : null}
    </>
  );

  const gestionDrawerBlock = (
    <div className="mt-2 space-y-1 border-t-2 border-emerald-100 pt-3" aria-label="Gestion entreprise">
      <p className="px-2 text-[10px] font-extrabold uppercase tracking-wider text-emerald-700">Gestion entreprise</p>
      {gestionDropdown(closeMenu, "drawer")}
    </div>
  );

  const moreLinks = (
    <>
      {navMore.map((item) => {
        const active = isNavActive(pathname, item.href);
        const showRepriseBadge = item.href === "/administration" && repriseGapCount > 0;
        return (
          <Link
            key={item.href}
            href={adminHref(item.href)}
            onClick={() => {
              closeMenu();
              closeMore();
            }}
            className={`${drawerLinkClass(active)} inline-flex items-center`}
          >
            {item.label}
            {showRepriseBadge ? <RepriseNavBadge count={repriseGapCount} /> : null}
          </Link>
        );
      })}
    </>
  );

  const adminSubLinks = adminActive ? (
    <div className="mt-3 space-y-3 border-t-2 border-violet-100 pt-3" aria-label="Sous-menu administration">
      {ADMIN_NAV_GROUPS.map((group) => (
        <div key={group.id} className="space-y-1">
          <p className="px-2 text-[10px] font-extrabold uppercase tracking-wider text-slate-500">{group.label}</p>
          {group.links.map((item) => {
            const active = isAdminLinkActive(pathname, item.href);
            const showRepriseBadge = item.href === "/administration/reprise" && repriseGapCount > 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={closeMenu}
                className={`${drawerLinkClass(active)} inline-flex items-center text-sm`}
              >
                {item.label}
                {showRepriseBadge ? <RepriseNavBadge count={repriseGapCount} /> : null}
              </Link>
            );
          })}
        </div>
      ))}
    </div>
  ) : null;

  const navLinks = (
    <>
      {NAV_PRIMARY.map((item) => {
        const active = isNavActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={closeMenu}
            className={`${drawerLinkClass(active, item.priority)} inline-flex items-center`}
          >
            {item.label}
          </Link>
        );
      })}
      {gestionDrawerBlock}
      <p className="nav-drawer-link-idle px-2 pt-2 text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
        Plus
      </p>
      {moreLinks}
      {adminSubLinks}
    </>
  );

  const mobileDrawer =
    menuOpen && mounted
      ? createPortal(
          <div className="fixed inset-0 z-[90] xl:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
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
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <div className="hidden min-w-0 flex-1 flex-col items-end gap-2 xl:flex">
        <nav className="flex flex-wrap items-center justify-end gap-2">
          {NAV_PRIMARY.slice(0, 1).map((item) => {
            const active = isNavActive(pathname, item.href);
            return (
              <Link key={item.href} href={item.href} className={`${desktopLinkClass(active, item.priority)} inline-flex items-center`}>
                {item.label}
              </Link>
            );
          })}

          <div className="relative" ref={gestionRef}>
            <button
              type="button"
              onClick={() => setGestionOpen((v) => !v)}
              className={`${desktopGestionTriggerClass(gestionActive)} inline-flex items-center gap-1`}
              aria-expanded={gestionOpen}
              aria-haspopup="menu"
            >
              Gestion
              <span className="text-[10px] opacity-80" aria-hidden>
                ▾
              </span>
            </button>
            {gestionOpen ? (
              <div
                role="menu"
                className="absolute left-0 z-50 mt-2 w-[17rem] rounded-2xl border border-emerald-100 bg-white p-2 shadow-lg ring-1 ring-emerald-50"
              >
                {gestionDropdown(closeGestion, "desktop")}
              </div>
            ) : null}
          </div>

          {NAV_PRIMARY.slice(1).map((item) => {
            const active = isNavActive(pathname, item.href);
            return (
              <Link key={item.href} href={item.href} className={`${desktopLinkClass(active, item.priority)} inline-flex items-center`}>
                {item.label}
              </Link>
            );
          })}

          <div className="relative" ref={moreRef}>
            <button
              type="button"
              onClick={() => setMoreOpen((v) => !v)}
              className={`${desktopLinkClass(moreActive, false)} inline-flex items-center gap-1`}
              aria-expanded={moreOpen}
              aria-haspopup="menu"
            >
              Plus
              <span className="text-[10px] opacity-70" aria-hidden>
                ▾
              </span>
              {!moreActive && repriseGapCount > 0 ? <RepriseNavBadge count={repriseGapCount} /> : null}
            </button>
            {moreOpen ? (
              <div
                role="menu"
                className="absolute right-0 z-50 mt-2 min-w-[12rem] rounded-2xl border border-slate-200 bg-white p-2 shadow-lg ring-1 ring-slate-100"
              >
                {navMore.map((item) => {
                  const active = isNavActive(pathname, item.href);
                  const showRepriseBadge = item.href === "/administration" && repriseGapCount > 0;
                  return (
                    <Link
                      key={item.href}
                      href={adminHref(item.href)}
                      role="menuitem"
                      onClick={closeMore}
                      className={`flex items-center rounded-xl px-3 py-2.5 text-sm font-semibold ${
                        active ? "bg-violet-100 text-violet-900" : "text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      {item.label}
                      {showRepriseBadge ? <RepriseNavBadge count={repriseGapCount} /> : null}
                    </Link>
                  );
                })}
              </div>
            ) : null}
          </div>
        </nav>

        {gestionActive ? (
          <nav
            className="flex max-w-full flex-wrap justify-end gap-1.5 border-t border-emerald-100 pt-2 text-xs"
            aria-label="Sous-menu gestion"
          >
            <span className="self-center pe-1 font-bold text-emerald-600">Gestion:</span>
            {GESTION_NAV_LINKS.map((item) => {
              const active = isGestionLinkActive(pathname, item);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 font-bold ${
                    active ? "bg-emerald-100 text-emerald-900 ring-1 ring-emerald-200" : "text-slate-700 hover:bg-emerald-50"
                  }`}
                >
                  <span aria-hidden>{item.icon}</span>
                  {item.label}
                </Link>
              );
            })}
          </nav>
        ) : null}

        {adminActive ? (
          <nav className="flex max-w-full flex-wrap justify-end gap-x-3 gap-y-1 border-t border-violet-100 pt-2 text-xs" aria-label="Sous-menu administration">
            {ADMIN_NAV_GROUPS.map((group) => (
              <div key={group.id} className="flex flex-wrap items-center gap-1">
                <span className="font-bold text-slate-400">{group.label}:</span>
                {group.links.map((item) => {
                  const active = isAdminLinkActive(pathname, item.href);
                  const showRepriseBadge = item.href === "/administration/reprise" && repriseGapCount > 0;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`inline-flex items-center rounded-full px-2.5 py-1.5 font-bold ${
                        active ? "bg-violet-100 text-violet-900 ring-1 ring-violet-200" : "text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      {item.label}
                      {showRepriseBadge ? <RepriseNavBadge count={repriseGapCount} /> : null}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2 xl:hidden">
        <Link
          href={GESTION_HUB_HREF}
          className={`touch-target hidden items-center justify-center rounded-xl border-2 px-3 text-sm font-extrabold sm:inline-flex ${
            gestionActive
              ? "border-emerald-600 bg-emerald-700 text-white"
              : "border-emerald-300 bg-emerald-50 text-emerald-900"
          }`}
        >
          Gestion
        </Link>
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          className="touch-target inline-flex items-center justify-center rounded-xl border-2 border-violet-300 bg-violet-700 px-3 text-sm font-extrabold text-white shadow-md hover:bg-violet-800 sm:px-4"
          aria-expanded={menuOpen}
          aria-controls="app-mobile-nav"
          aria-haspopup="dialog"
        >
          Menu
        </button>
      </div>

      {mobileDrawer}
    </>
  );
}
