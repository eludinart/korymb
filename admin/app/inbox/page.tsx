"use client";

import { useQuery } from "@tanstack/react-query";
import DirectorInboxList from "../../components/director/DirectorInboxList";
import type { InboxActionItem } from "../../components/director/InboxActionCard";
import {
  AlertBox,
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
    refetchInterval: 60_000,
    staleTime: 45_000,
    refetchOnWindowFocus: false,
  });

  const items = inbox.data || [];
  const pending = items.length;
  const overdueCount = items.filter((i) => Number(i.days_overdue ?? 0) > 0).length;

  return (
    <PageShell size="narrow">
      <PageHeader
        accent="amber"
        badge="Actions requises"
        title="Inbox dirigeant"
        description="HITL, questions CIO, clôtures, qualité, apprentissage et approbations — triez, filtrez et agissez sans quitter cette page."
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
          <StatCard
            label="En retard"
            value={overdueCount}
            tone={overdueCount > 0 ? "warn" : "ok"}
            hint={overdueCount > 0 ? "Au-delà du délai cible" : "Dans les délais"}
          />
        </div>
      ) : null}

      {inbox.isLoading ? <LoadingLine label="Chargement de l'inbox…" /> : null}
      {inbox.isError ? (
        <AlertBox tone="error" title="Impossible de charger l'inbox">
          {inbox.error instanceof Error ? inbox.error.message : "Erreur réseau"} — vérifiez que le backend tourne (
          <code className="font-mono text-xs">.\start-dev-cursor.ps1 -MariaDbTunnel</code>).
        </AlertBox>
      ) : null}

      {!inbox.isLoading ? (
        <DirectorInboxList
          items={items}
          emptyTitle="Aucune action en attente"
          emptyHint="Votre inbox est vide pour le moment."
        />
      ) : null}
    </PageShell>
  );
}
