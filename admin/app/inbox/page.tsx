"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import DirectorInboxList from "../../components/director/DirectorInboxList";
import InboxTriageMode from "../../components/director/InboxTriageMode";
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
import { filterSnoozedItems } from "../../lib/inboxSnooze";
import { closeInboxBulk } from "../../lib/missionActions";

function InboxPageContent() {
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const triageMode = searchParams.get("triage") === "1";
  const [bulkMsg, setBulkMsg] = useState("");

  const inbox = useQuery({
    queryKey: ["admin-inbox"],
    queryFn: async () => {
      const { data } = await requestJson("/admin/inbox?limit=100", { headers: agentHeaders(), retries: 2 });
      return (data.items || []) as InboxActionItem[];
    },
    refetchInterval: 60_000,
    staleTime: 45_000,
    refetchOnWindowFocus: false,
  });

  const items = filterSnoozedItems(inbox.data || []);
  const pending = items.length;
  const overdueCount = items.filter((i) => Number(i.days_overdue ?? 0) > 0).length;
  const closableCount = items.filter((i) => i.kind === "closure" || i.kind === "mission_error").length;

  const onDismissed = () => {
    void qc.invalidateQueries({ queryKey: ["admin-inbox"] });
    void qc.invalidateQueries({ queryKey: ["admin-briefing"] });
  };

  const bulkClose = useMutation({
    mutationFn: () => closeInboxBulk(["closure", "mission_error"]),
    onSuccess: (data) => {
      const n = Number(data.closed_count || 0);
      setBulkMsg(n > 0 ? `${n} mission(s) clôturée(s).` : "Aucune mission à clôturer.");
      onDismissed();
      void qc.invalidateQueries({ queryKey: ["jobs-cards"] });
    },
    onError: (err) => {
      setBulkMsg(err instanceof Error ? err.message : "Échec de la clôture groupée.");
    },
  });

  return (
    <PageShell size="narrow">
      {triageMode ? <InboxTriageMode items={items} onDismissed={onDismissed} /> : null}

      <PageHeader
        accent="amber"
        badge="Actions requises"
        title="Inbox dirigeant"
        description="HITL, questions CIO, clôtures (y compris issues du chat) et approbations — une seule file pour toutes vos décisions."
        actions={
          <>
            <PageLink href="/inbox?triage=1">Mode triage</PageLink>
            <PageLink href="/briefing">Briefing</PageLink>
            <PageLink href="/missions" variant="secondary">
              Missions
            </PageLink>
          </>
        }
      />

      {!inbox.isLoading && pending > 0 ? (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard label="En attente" value={pending} tone="urgent" hint="Mode triage : Ctrl+K → inbox" />
          <StatCard
            label="En retard"
            value={overdueCount}
            tone={overdueCount > 0 ? "warn" : "ok"}
            hint={overdueCount > 0 ? "Au-delà du délai cible" : "Dans les délais"}
          />
          {closableCount > 0 ? (
            <div className="col-span-2 sm:col-span-1">
              <button
                type="button"
                disabled={bulkClose.isPending}
                onClick={() => {
                  if (
                    typeof window !== "undefined" &&
                    !window.confirm(
                      `Clôturer ${closableCount} mission(s) terminée(s) ou en échec ?\n\nLes questions CIO et validations HITL restent intactes.`,
                    )
                  ) {
                    return;
                  }
                  setBulkMsg("");
                  bulkClose.mutate();
                }}
                className="btn-secondary w-full justify-center text-sm"
              >
                {bulkClose.isPending ? "Clôture…" : `Tout clôturer (${closableCount})`}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {bulkMsg ? (
        <AlertBox tone={bulkClose.isError ? "error" : "success"} title={bulkClose.isError ? "Clôture groupée" : "OK"}>
          {bulkMsg}
        </AlertBox>
      ) : null}

      {inbox.isLoading ? <LoadingLine label="Chargement de l'inbox…" /> : null}
      {inbox.isError ? (
        <AlertBox tone="error" title="Impossible de charger l'inbox">
          {inbox.error instanceof Error ? inbox.error.message : "Erreur réseau"}
        </AlertBox>
      ) : null}

      {!inbox.isLoading ? (
        <DirectorInboxList
          items={items}
          emptyTitle="Inbox vide ✓"
          emptyHint="Toutes vos décisions sont traitées. Retournez au briefing pour la suite de votre journée."
        />
      ) : null}
    </PageShell>
  );
}

export default function InboxPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-500">Chargement de l'inbox…</div>}>
      <InboxPageContent />
    </Suspense>
  );
}
