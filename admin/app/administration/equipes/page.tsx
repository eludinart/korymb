"use client";

import { Suspense } from "react";
import AgentTeamsHub from "../../../components/admin/AgentTeamsHub";

export default function AdministrationEquipesPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-400">Chargement des équipes…</p>}>
      <AgentTeamsHub />
    </Suspense>
  );
}
