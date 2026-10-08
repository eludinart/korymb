"use client";

import { useEffect, useState } from "react";

/**
 * Premier écran de l'icône téléphone. La réponse HTTP doit être 200 :
 * une redirection au démarrage laisse l'app installée sur le splash.
 */
export default function PwaLaunch({
  next = "/briefing",
  assumeLoggedOut = false,
}: {
  next?: string;
  /** Le serveur a déjà vu l'absence de cookie : ne pas attendre l'API. */
  assumeLoggedOut?: boolean;
}) {
  const [stuck, setStuck] = useState(false);
  const loginHref = `/login?next=${encodeURIComponent(next)}`;

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!cancelled) setStuck(true);
    }, 8000);

    if (assumeLoggedOut) {
      window.location.replace(loginHref);
      return () => {
        cancelled = true;
        window.clearTimeout(timer);
      };
    }

    void (async () => {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        if (cancelled) return;
        if (res.ok) {
          const me = (await res.json()) as {
            user?: { id?: string } | null;
            role?: string | null;
            workspace?: { slug?: string } | null;
          };
          if (me?.role === "subscriber") {
            const slug = me.workspace?.slug || "espace";
            window.location.replace(`/a/${encodeURIComponent(slug)}`);
            return;
          }
          if (me?.user) {
            window.location.replace(next);
            return;
          }
        }
        window.location.replace(loginHref);
      } catch {
        if (!cancelled) setStuck(true);
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [assumeLoggedOut, loginHref, next]);

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-extrabold text-slate-900 dark:text-slate-50">Ouverture de Korymb</h1>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        {stuck ? "La connexion automatique n’a pas abouti." : "Chargement de votre espace…"}
      </p>
      <a href={loginHref} className="rounded-xl bg-violet-700 px-4 py-3 text-sm font-bold text-white">
        Aller à la connexion
      </a>
    </div>
  );
}
