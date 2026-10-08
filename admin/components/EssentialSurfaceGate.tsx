"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { isOperatorAdminPath } from "../lib/adminNav";
import { isEssentialAllowedPath } from "../lib/essentialSurface";
import { useUiMode } from "../lib/uiMode";

/** En mode Essentiel, une adresse avancée ne s'affiche pas : retour à Aujourd'hui. */
export default function EssentialSurfaceGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "";
  const router = useRouter();
  const { isEssential, loading } = useUiMode();
  const blocked = !isOperatorAdminPath(pathname) && !isEssentialAllowedPath(pathname);
  const hidePage = blocked && (loading || isEssential);

  useEffect(() => {
    if (loading || !isEssential || !blocked) return;
    router.replace("/briefing");
  }, [blocked, isEssential, loading, router]);

  if (hidePage) {
    return (
      <p className="text-sm font-medium text-slate-500">
        {isEssential ? "Retour à Aujourd'hui…" : "Chargement…"}
      </p>
    );
  }
  return children;
}
