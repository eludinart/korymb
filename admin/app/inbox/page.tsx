"use client";

import { useQuery } from "@tanstack/react-query";
import InboxActionCard, { type InboxActionItem } from "../../components/director/InboxActionCard";
import {
  AlertBox,
  EmptyState,
  LoadingLine,
  PageHeader,
  PageLink,
  PageShell,
  StatCard,
} from "../../components/ui/PageChrome";
import { agentHeaders, requestJson } from "../../lib/api";

export default function InboxPage() {
  const inbox = useQuery({
    queryKey: ["admin-inbox"],
    queryFn: async () => {
      const { data } = await requestJson("/admin/inbox", { headers: agentHeaders(), retries: 2 });
      return (data.items || []) as InboxActionItem[];
    },
    refetchInterval: 15000,
  });

  const items = inbox.data || [];
  const pending = items.length;

  return (
    <PageShell size="narrow">
      <PageHeader
        accent="amber"
        badge="Actions requises"
        title="Inbox dirigeant"
        description="HITL, questions CIO, clôtures, qualité, apprentissage et approbations — agissez sans quitter cette page."
        actions={
          <>
            <PageLink href="/briefing">Briefing</PageLink>
            <PageLink href="/missions" variant="secondary">
              Missions
            </PageLink>
          </>
        }
      />

      {!inbox.isLoading && pending > 0 ? (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard label="En attente" value={pending} tone="urgent" hint="Tapez « Agir » sur chaque carte" />
        </div>
      ) : null}

      {inbox.isLoading ? <LoadingLine label="Chargement de l'inbox…" /> : null}
      {inbox.isError ? (
        <AlertBox tone="error" title="Impossible de charger l'inbox">
          {inbox.error instanceof Error ? inbox.error.message : "Erreur réseau"} — vérifiez que le backend tourne (
          <code className="font-mono text-xs">.\start-dev-cursor.ps1 -MariaDbTunnel</code>).
        </AlertBox>
      ) : null}

      {!inbox.isLoading && items.length === 0 ? (
        <EmptyState title="Aucune action en attente">Votre inbox est vide pour le moment.</EmptyState>
      ) : null}

      <ul className="space-y-4">
        {items.map((item, idx) => (
          <InboxActionCard key={`${item.kind}-${item.job_id || item.output_id || item.suggestion_id}-${idx}`} item={item} />
        ))}
      </ul>
    </PageShell>
  );
}
