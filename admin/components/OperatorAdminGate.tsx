"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ESSENTIAL_ADMIN_ENTRY, isOperatorAdminPath } from "../lib/adminNav";
import { useUiMode } from "../lib/uiMode";

/** Le cœur du moteur reste fermé pour un admin d'espace client. */
export default function OperatorAdminGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "";
  const router = useRouter();
  const { isPlatformOwner, loading } = useUiMode();
  const operatorPage = isOperatorAdminPath(pathname);
  const blocked = operatorPage && !loading && !isPlatformOwner;

  useEffect(() => {
    if (!blocked) return;
    const target = pathname.startsWith("/administration") ? ESSENTIAL_ADMIN_ENTRY : "/briefing";
    router.replace(target);
  }, [blocked, pathname, router]);

  if (operatorPage && (loading || !isPlatformOwner)) {
    return (
      <p className="text-sm font-medium text-slate-500">
        {blocked ? "Cette page est réservée au profil Élude…" : "Chargement…"}
      </p>
    );
  }
  return children;
}
