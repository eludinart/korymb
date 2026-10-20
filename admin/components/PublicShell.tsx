"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { accountDisplayName, type AuthMeResponse } from "../lib/authSession";
import { loadPublicStorefront } from "../lib/storefront";
import { PracticePoweredBy, PracticeTheme } from "./practice/PracticeTheme";
import HudAtmosphere from "./ui/aceternity/HudAtmosphere";
import BrandCore from "./ui/aceternity/BrandCore";

export default function PublicShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "";
  const next = (useSearchParams().get("next") || "").trim();
  const loginHref =
    next.startsWith("/") && !next.startsWith("//") ? `/login?next=${encodeURIComponent(next)}` : "/login";
  const [me, setMe] = useState<AuthMeResponse | null>(null);
  const [homeSettled, setHomeSettled] = useState(pathname !== "/");

  const load = useCallback(async () => {
    const onHome = pathname === "/";
    if (onHome) setHomeSettled(false);
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      const data = res.ok ? ((await res.json()) as AuthMeResponse) : null;
      setMe(data);
      if (onHome && (data?.role === "admin" || data?.role === "member")) {
        window.location.replace("/chat");
        return;
      }
    } catch {
      setMe(null);
    }
    if (onHome) setHomeSettled(true);
  }, [pathname]);

  useEffect(() => {
    void load();
  }, [load, pathname]);

  const vitrineMatch = pathname.match(/^\/p\/([^/]+)/);
  const vitrineSlug = vitrineMatch ? decodeURIComponent(vitrineMatch[1]) : "";
  const isVitrine = Boolean(vitrineSlug);
  const loggedIn = Boolean(me?.user);
  const isSubscriber = me?.role === "subscriber";
  const isOperator = me?.role === "admin" || me?.role === "member";
  const slug = vitrineSlug || me?.workspace?.slug || "";
  const espaceHref = slug ? `/a/${slug}` : "";

  const storefront = useQuery({
    queryKey: ["storefront-public", vitrineSlug],
    queryFn: () => loadPublicStorefront(vitrineSlug),
    enabled: isVitrine,
    staleTime: 30_000,
    retry: 1,
  });
  const brand = storefront.data;
  const brandName = brand?.name || "Espace participant";

  const inner = (
    <div className={isVitrine ? "flex min-h-screen flex-col" : "relative z-10 min-h-screen"}>
      <header data-pull-refresh="" className="border-b border-slate-200 bg-white/80 backdrop-blur-md dark:border-violet-900 dark:bg-slate-950/90" style={isVitrine ? { borderColor: "color-mix(in srgb, var(--practice-accent) 20%, white)" } : undefined}>
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link href={isVitrine ? `/p/${encodeURIComponent(vitrineSlug)}` : "/"} className="flex min-w-0 items-center gap-3">
            {isVitrine && brand?.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brand.logo_url} alt="" className="h-10 w-10 rounded-full object-cover" />
            ) : null}
            <span className="min-w-0">
              <span className={`block truncate text-lg font-extrabold ${isVitrine ? "practice-heading" : "app-brand"}`}>
                {isVitrine ? brandName : (
                  <>
                    <BrandCore />
                    Korymb
                  </>
                )}
              </span>
              {isVitrine && brand?.location ? (
                <span className="mt-0.5 block truncate text-xs font-semibold text-slate-600">{brand.location}</span>
              ) : null}
            </span>
          </Link>
          <nav className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
            {loggedIn ? (
              <>
                {isSubscriber && espaceHref ? (
                  <div className="flex min-w-0 flex-col items-end gap-1">
                    <p className={`truncate text-sm font-extrabold ${isVitrine ? "practice-heading" : ""}`}>
                      {accountDisplayName(me)}
                    </p>
                    <Link href={espaceHref} className={isVitrine ? "btn-practice px-3 py-1.5 text-xs" : "text-xs font-bold text-emerald-800 hover:underline"}>
                      Mon espace
                    </Link>
                  </div>
                ) : null}
                {isOperator ? (
                  <Link href="/chat" className="rounded-full bg-violet-700 px-4 py-2 text-sm font-bold text-white hover:bg-violet-800">
                    Cockpit dirigeant
                  </Link>
                ) : null}
              </>
            ) : isVitrine ? (
              <>
                <Link href={`/p/${encodeURIComponent(vitrineSlug)}/connexion`} className="rounded-full px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-white">
                  Connexion
                </Link>
                <Link href={`/p/${encodeURIComponent(vitrineSlug)}/inscription`} className="btn-practice px-4 py-2 text-sm">
                  Rejoindre l’espace
                </Link>
              </>
            ) : (
              <>
                <Link href={loginHref} className="rounded-full px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-violet-50">
                  Connexion
                </Link>
                <Link href="/register" className="hud-btn rounded-full bg-violet-700 px-4 py-2 text-sm font-bold text-white hover:bg-violet-800">
                  Créer un espace
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>
      <main className={isVitrine ? "flex-1" : undefined}>
        {pathname === "/" && !homeSettled ? (
          <p className="px-4 py-16 text-center text-sm font-medium text-slate-500">Ouverture…</p>
        ) : (
          children
        )}
      </main>
      {isVitrine ? (
        <PracticePoweredBy />
      ) : (
        <footer className="border-t border-slate-200 bg-white/60 py-8 text-center text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950/80 dark:text-slate-400">
          Korymb — vous dites quoi faire, vous validez avant l’envoi.
        </footer>
      )}
    </div>
  );

  if (isVitrine) {
    return <PracticeTheme identity={brand || { name: brandName }}>{inner}</PracticeTheme>;
  }
  return (
    <>
      <HudAtmosphere />
      {inner}
    </>
  );
}
