"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  GESTION_NAV_LINKS,
  GESTION_QUICK_ACTIONS,
  groupedGestionNavLinks,
  gestionNavGroupHeadingClass,
  isGestionLinkActive,
} from "../../lib/gestionNav";

function gestionCrumbs(pathname: string): { href: string; label: string }[] {
  const trail = [{ href: "/gestion", label: "Gestion" }];
  if (pathname === "/gestion") return trail;
  const match = GESTION_NAV_LINKS.filter((link) => !link.exact)
    .filter((link) => pathname === link.href || pathname.startsWith(`${link.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
  if (!match) return trail;
  trail.push({ href: match.href, label: match.label });
  if (pathname !== match.href) {
    const rest = pathname.slice(match.href.length + 1);
    trail.push({ href: pathname, label: rest === "nouveau" ? "Nouveau" : "Fiche" });
  }
  return trail;
}

function NavItem({
  item,
  pathname,
}: {
  item: (typeof GESTION_NAV_LINKS)[number];
  pathname: string;
}) {
  const active = isGestionLinkActive(pathname, item);
  return (
    <Link
      href={item.href}
      title={item.hint}
      className={`${active ? "gestion-nav-link gestion-nav-link-active" : "gestion-nav-link gestion-nav-link-idle"} flex shrink-0 items-center gap-2.5`}
    >
      <span className="text-base leading-none" aria-hidden>
        {item.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{item.label}</span>
        <span className={`hidden truncate text-[10px] font-medium sm:block ${active ? "text-emerald-100" : "text-slate-500"}`}>
          {item.hint}
        </span>
      </span>
    </Link>
  );
}

export default function GestionLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "";
  const hub = GESTION_NAV_LINKS.find((l) => l.exact);

  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:gap-8">
      <aside className="shrink-0 rounded-2xl border-2 border-emerald-200 bg-white p-3 shadow-md sm:p-4 lg:sticky lg:top-[calc(var(--app-header-offset,0px)+0.75rem)] lg:z-20 lg:max-h-[calc(100dvh-var(--app-header-offset,0px)-1.5rem)] lg:w-64 lg:self-start lg:overflow-y-auto lg:overscroll-y-contain lg:[scrollbar-width:thin]">
        <p className="text-xs font-extrabold uppercase tracking-wider text-emerald-800">Gestion</p>
        <p className="mt-1 hidden px-2 text-[11px] leading-snug text-slate-500 sm:block">
          Création, équipes projet, commercial et planning
        </p>
        <nav className="-mx-1 mt-3 lg:mx-0" aria-label="Modules gestion">
          <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
            {hub ? <NavItem item={hub} pathname={pathname} /> : null}
            {groupedGestionNavLinks().map((group) => (
              <div key={group.id} className="contents lg:block lg:mt-2">
                <p
                  className={`hidden px-3 pb-1 text-[10px] font-extrabold uppercase tracking-wider lg:block ${gestionNavGroupHeadingClass(group.id)}`}
                >
                  {group.label}
                </p>
                {group.links.map((item) => (
                  <NavItem key={item.href} item={item} pathname={pathname} />
                ))}
              </div>
            ))}
          </div>
        </nav>
        <div className="mt-3 hidden border-t border-emerald-100 pt-3 lg:block">
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
        <div className="mt-3 flex gap-2 overflow-x-auto border-t border-emerald-100 pt-3 lg:hidden">
          {GESTION_QUICK_ACTIONS.map((action) => (
            <Link
              key={action.id}
              href={action.href}
              className="shrink-0 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-900"
            >
              + {action.label}
            </Link>
          ))}
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <nav aria-label="Fil d'Ariane" className="mb-3 text-sm font-semibold text-slate-500">
          <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            {gestionCrumbs(pathname).map((crumb, index, all) => {
              const current = index === all.length - 1;
              return (
                <li key={`${crumb.href}-${crumb.label}`} className="flex items-center gap-1.5">
                  {index > 0 ? <span aria-hidden className="text-slate-300">/</span> : null}
                  {current ? (
                    <span className="text-slate-800 dark:text-slate-100" aria-current="page">
                      {crumb.label}
                    </span>
                  ) : (
                    <Link href={crumb.href} className="text-violet-800 hover:underline dark:text-violet-200">
                      {crumb.label}
                    </Link>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
        {children}
      </div>
    </div>
  );
}
