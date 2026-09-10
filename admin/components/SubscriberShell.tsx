"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { accountDisplayName, type AuthMeResponse } from "../lib/authSession";
import { ESPACE_NAV_LINKS, espaceHref, isEspaceLinkActive } from "../lib/espaceNav";
import { useSubscriberHome } from "../lib/subscriberHome";
import { PracticePoweredBy, PracticeTheme } from "./practice/PracticeTheme";

export default function SubscriberShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "";
  const router = useRouter();
  const [me, setMe] = useState<AuthMeResponse | null>(null);
  const home = useSubscriberHome();

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

  const pathSlug = decodeURIComponent((pathname.match(/^\/a\/([^/]+)/)?.[1] || "").trim());
  const slug = me?.workspace?.slug || home.data?.slug || pathSlug;
  const vitrineHref = slug ? `/p/${slug}` : "/";
  const isOperator = me?.role === "admin" || me?.role === "member";
  const homeHref = slug ? espaceHref(slug) : "/";
  const compteHref = slug ? espaceHref(slug, "/compte") : "";
  const brand = home.data;
  const practiceName = brand?.name || me?.workspace?.name || "";
  const practiceLabel = practiceName || pathSlug || "Votre espace";
  const userName = accountDisplayName(me);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace(slug ? `/p/${encodeURIComponent(slug)}` : "/");
    router.refresh();
  }

  return (
    <PracticeTheme identity={brand || { name: practiceLabel }}>
      <div className="flex min-h-screen flex-col">
        <header className="border-b bg-white/80 backdrop-blur-md" style={{ borderColor: "color-mix(in srgb, var(--practice-accent) 20%, white)" }}>
          <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-4 sm:px-6">
            <div className="flex items-start justify-between gap-4">
              <Link href={homeHref} className="flex min-w-0 items-center gap-3">
                {brand?.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={brand.logo_url} alt="" className="h-11 w-11 rounded-full object-cover" />
                ) : null}
                <span className="min-w-0">
                  <span className="practice-heading block truncate text-lg font-extrabold sm:text-xl">{practiceLabel}</span>
                  <span className="mt-0.5 block truncate text-xs font-semibold text-slate-600">
                    {brand?.location || (practiceName ? "L’espace où vous êtes inscrit" : " ")}
                  </span>
                </span>
              </Link>
              <div className="flex shrink-0 items-center gap-2 sm:gap-3">
                {isOperator ? (
                  <Link href="/briefing" className="hidden rounded-full bg-violet-700 px-3 py-2 text-sm font-bold text-white hover:bg-violet-800 sm:inline">
                    Cockpit
                  </Link>
                ) : null}
                {me?.user ? (
                  <>
                    <Link href={compteHref} className="min-w-0 max-w-[11rem] text-right sm:max-w-xs">
                      <span className="practice-heading block truncate text-sm font-extrabold sm:text-base">{userName}</span>
                      <span className="block text-xs font-semibold text-slate-600">Votre compte</span>
                    </Link>
                    <button type="button" onClick={() => void logout()} className="rounded-full px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-white">
                      Déconnexion
                    </button>
                  </>
                ) : (
                  <Link href={slug ? `/p/${encodeURIComponent(slug)}/connexion` : "/login"} className="btn-practice px-4 py-2 text-sm">
                    Connexion
                  </Link>
                )}
              </div>
            </div>
            <nav className="flex flex-wrap items-center gap-1.5" aria-label="Espace participant">
              {slug
                ? ESPACE_NAV_LINKS.map((link) => {
                    const href = espaceHref(slug, link.suffix);
                    const active = isEspaceLinkActive(pathname, slug, link);
                    return (
                      <Link
                        key={link.id}
                        href={href}
                        className={
                          active
                            ? "btn-practice rounded-full px-3 py-2 text-sm"
                            : "rounded-full px-3 py-2 text-sm font-semibold hover:bg-white"
                        }
                        style={active ? undefined : { color: "var(--practice-ink)" }}
                      >
                        {link.label}
                      </Link>
                    );
                  })
                : null}
              <Link href={vitrineHref} className="rounded-full px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-white">
                Page publique
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">{children}</main>
        <PracticePoweredBy />
      </div>
    </PracticeTheme>
  );
}
