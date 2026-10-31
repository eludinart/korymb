"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ESSENTIAL_ADMIN_ENTRY } from "../../lib/adminNav";
import { useUiMode } from "../../lib/uiMode";

/** Entrée Administration : mémoire pour l'espace ; santé système seulement en Avancé + owner. */
export default function AdministrationIndexPage() {
  const router = useRouter();
  const { loading, showAdvanced, isPlatformOwner } = useUiMode();

  useEffect(() => {
    if (loading) return;
    const target =
      showAdvanced && isPlatformOwner ? "/administration/dashboard" : ESSENTIAL_ADMIN_ENTRY;
    router.replace(target);
  }, [loading, showAdvanced, isPlatformOwner, router]);

  return <p className="text-sm font-medium text-slate-500">Ouverture de l&apos;administration…</p>;
}
