"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { accountDisplayName, type AuthMeResponse } from "../lib/authSession";
import { loadPublicStorefront } from "../lib/storefront";
import { PracticePoweredBy, PracticeTheme } from "./practice/PracticeTheme";

export default function PublicShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "";
  const [me, setMe] = useState<AuthMeResponse | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      setMe(res.ok ? ((await res.json()) as AuthMeResponse) : null);
    } catch {
      setMe(null);
    }
  }, []);

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
    <div className={isVitrine ? "flex min-h-screen flex-col" : "min-h-screen bg-gradient-to-b from-violet-50 via-white to-slate-50"}>
      <header className="border-b bg-white/80 backdrop-blur-md" style={isVitrine ? { borderColor: "color-mix(in srgb, var(--practice-accent) 20%, white)" } : undefined}>
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link href={isVitrine ? `/p/${encodeURIComponent(vitrineSlug)}` : "/"} className="flex min-w-0 items-center gap-3">
            {isVitrine && brand?.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brand.logo_url} alt="" className="h-10 w-10 rounded-full object-cover" />
            ) : null}
            <span className="min-w-0">
              <span className={`block truncate text-lg font-extrabold ${isVitrine ? "practice-heading" : "app-brand"}`}>
                {isVitrine ? brandName : "Korymb"}
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
                  <Link href="/briefing" className="rounded-full bg-violet-700 px-4 py-2 text-sm font-bold text-white hover:bg-violet-800">
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
                <Link href="/login" className="rounded-full px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-violet-50">
                  Connexion
                </Link>
                <Link href="/register" className="rounded-full bg-violet-700 px-4 py-2 text-sm font-bold text-white hover:bg-violet-800">
                  Créer un espace
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>
      <main className={isVitrine ? "flex-1" : undefined}>{children}</main>
      {isVitrine ? (
        <PracticePoweredBy />
      ) : (
        <footer className="border-t bg-white/60 py-8 text-center text-xs text-slate-500">
          Korymb — outil de gestion pour accompagner et livrer
        </footer>
      )}
    </div>
  );

  if (isVitrine) {
    return <PracticeTheme identity={brand || { name: brandName }}>{inner}</PracticeTheme>;
  }
  return inner;
}
