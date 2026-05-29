"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { agentHeaders, requestJson } from "../../../lib/api";
import { PageHeader, PageShell } from "../../../components/ui/PageChrome";

type Playbook = {
  id: string;
  name: string;
  description?: string;
  category?: string;
  steps?: Record<string, unknown>;
};

export default function PlaybooksPage() {
  const qc = useQueryClient();
  const playbooks = useQuery({
    queryKey: ["playbooks"],
    queryFn: async () => (await requestJson("/playbooks", { headers: agentHeaders() })).data.playbooks as Playbook[],
  });

  const launch = useMutation({
    mutationFn: async ({ id, supervised }: { id: string; supervised: boolean }) =>
      (
        await requestJson(`/playbooks/${encodeURIComponent(id)}/launch`, {
          method: "POST",
          headers: agentHeaders(),
          body: JSON.stringify({ require_user_validation: supervised }),
        })
      ).data,
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ["playbooks"] });
      if (data?.job_id) {
        window.location.href = `/missions?job=${encodeURIComponent(String(data.job_id))}`;
      }
    },
  });

  const grouped = {
    fleur: (playbooks.data || []).filter((p) => p.category === "fleur"),
    sivana: (playbooks.data || []).filter((p) => p.category === "sivana"),
    generic: (playbooks.data || []).filter((p) => !p.category || p.category === "generic"),
  };

  return (
    <PageShell className="space-y-6">
      <PageHeader
        accent="violet"
        badge="Fleur / Sivana"
        title="Playbooks métier"
        description="Bibliothèque prête à l'emploi — lancement supervisé ou autonome en un clic."
      />
      {playbooks.isLoading ? <p className="text-sm text-slate-400">Chargement…</p> : null}
      {(["fleur", "sivana", "generic"] as const).map((cat) => (
        <section key={cat} className="section-card">
          <h2 className="section-title capitalize">{cat}</h2>
          <ul className="mt-4 space-y-3">
            {grouped[cat].length === 0 ? (
              <li className="text-sm text-slate-500">Aucun playbook.</li>
            ) : (
              grouped[cat].map((pb) => (
                <li key={pb.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-100 p-4">
                  <div>
                    <p className="font-medium text-slate-900">{pb.name}</p>
                    <p className="mt-1 text-sm text-slate-600">{pb.description}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={launch.isPending}
                      onClick={() => launch.mutate({ id: pb.id, supervised: true })}
                      className="rounded-lg bg-violet-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      Lancer supervisé
                    </button>
                    <button
                      type="button"
                      disabled={launch.isPending}
                      onClick={() => launch.mutate({ id: pb.id, supervised: false })}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                    >
                      Autonome
                    </button>
                  </div>
                </li>
              ))
            )}
          </ul>
        </section>
      ))}
      <Link href="/briefing" className="btn-link-secondary inline-flex">
        ← Retour briefing
      </Link>
    </PageShell>
  );
}
