"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

const NAV = [
  { href: "/dashboard", label: "Métier" },
  { href: "/missions", label: "Missions" },
  { href: "/chat", label: "Chat" },
  { href: "/historique", label: "Historique" },
  { href: "/configuration", label: "Configuration" },
  { href: "/administration", label: "Administration" },
  { href: "/mission/nouvelle", label: "Nouvelle mission" },
  { href: "/mission/guided", label: "Mission guidée" },
];

const ADMIN_SUB = [
  { href: "/administration/dashboard", label: "Santé & outils" },
  { href: "/administration/agents", label: "Agents & mémoire" },
];

function navLinkClass(active: boolean, compact = false) {
  const size = compact ? "px-4 py-3 text-base" : "px-3 py-2 text-sm";
  return `block w-full rounded-xl ${size} font-medium transition-colors ${
    active ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100 active:bg-slate-200"
  }`;
}

function isNavActive(pathname: string, href: string, adminActive: boolean) {
  return (
    pathname === href ||
    (href !== "/administration" && pathname.startsWith(`${href}/`)) ||
    (href === "/administration" && adminActive)
  );
}

export default function AppNav() {
  const pathname = usePathname() || "";
  const adminActive = pathname === "/administration" || pathname.startsWith("/administration/");
  const [menuOpen, setMenuOpen] = useState(false);

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
      {NAV.map((item) => {
        const active = isNavActive(pathname, item.href, adminActive);
        return (
          <Link
            key={item.href}
            href={item.href === "/administration" ? "/administration/dashboard" : item.href}
            onClick={closeMenu}
            className={navLinkClass(active, menuOpen)}
          >
            {item.label}
          </Link>
        );
      })}
      {adminActive ? (
        <div className="mt-2 space-y-1 border-t border-slate-100 pt-3" aria-label="Sous-menu administration">
          <p className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Administration</p>
          {ADMIN_SUB.map((item) => {
            const active =
              pathname.startsWith(item.href) ||
              (item.href === "/administration/dashboard" && pathname === "/administration");
            return (
              <Link key={item.href} href={item.href} onClick={closeMenu} className={navLinkClass(active, menuOpen)}>
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
      {/* Desktop */}
      <div className="hidden min-w-0 flex-1 flex-col items-end gap-2 lg:flex">
        <nav className="flex flex-wrap justify-end gap-2">
          {NAV.map((item) => {
            const active = isNavActive(pathname, item.href, adminActive);
            return (
              <Link
                key={item.href}
                href={item.href === "/administration" ? "/administration/dashboard" : item.href}
                className={`rounded-full px-3 py-2 text-sm font-medium transition-colors ${
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
            {ADMIN_SUB.map((item) => {
              const active =
                pathname.startsWith(item.href) ||
                (item.href === "/administration/dashboard" && pathname === "/administration");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-full px-2.5 py-1.5 font-medium ${
                    active ? "bg-violet-100 text-violet-900" : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        ) : null}
      </div>

      {/* Mobile trigger */}
      <div className="flex shrink-0 items-center gap-2 lg:hidden">
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          className="touch-target inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
          aria-expanded={menuOpen}
          aria-controls="app-mobile-nav"
        >
          Menu
        </button>
      </div>

      {/* Mobile drawer */}
      {menuOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]"
            aria-label="Fermer le menu"
            onClick={closeMenu}
          />
          <div
            id="app-mobile-nav"
            className="absolute inset-y-0 right-0 flex w-[min(100vw-2.5rem,20rem)] flex-col bg-white shadow-2xl pt-safe"
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <p className="text-sm font-bold text-slate-900">Navigation</p>
              <button
                type="button"
                onClick={closeMenu}
                className="touch-target rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Fermer
              </button>
            </div>
            <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4 pb-safe">{navLinks}</nav>
          </div>
        </div>
      ) : null}
    </>
  );
}
