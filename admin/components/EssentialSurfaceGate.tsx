"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { isEssentialAllowedPath } from "../lib/essentialSurface";
import { useUiMode } from "../lib/uiMode";

/** En mode Essentiel, une adresse hors allowlist renvoie à la conversation (y compris pages opérateur). */
export default function EssentialSurfaceGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "";
  const router = useRouter();
  const { isEssential, loading } = useUiMode();
  const blocked = !isEssentialAllowedPath(pathname);
  const hidePage = blocked && (loading || isEssential);

  useEffect(() => {
    if (loading || !isEssential || !blocked) return;
    router.replace("/chat");
  }, [blocked, isEssential, loading, router]);

  if (hidePage) {
    return (
      <p className="text-sm font-medium text-slate-500">
        {isEssential ? "Retour à la conversation…" : "Chargement…"}
      </p>
    );
  }
  return children;
}
