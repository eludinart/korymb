"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Ancienne URL — redirige vers le hub Équipes. */
export default function AdministrationAgentGroupsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/administration/equipes");
  }, [router]);
  return <p className="text-sm text-slate-500">Redirection vers Équipes d’agents…</p>;
}
