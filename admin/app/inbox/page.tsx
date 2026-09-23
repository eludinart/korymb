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
import { asInboxItems, fetchAdminInboxItems } from "../../lib/inboxQuery";
import { DIRECTOR_QUEUE_EMPTY, DIRECTOR_QUEUE_HREF, DIRECTOR_QUEUE_LABEL, DIRECTOR_QUEUE_SUBTITLE, DIRECTOR_QUEUE_TITLE } from "../../lib/directorQueue";
import { closeInboxBulk } from "../../lib/missionActions";

function InboxPageContent() {
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const triageMode = searchParams.get("triage") === "1";
  const [bulkMsg, setBulkMsg] = useState("");

  const inbox = useQuery({
    queryKey: ["admin-inbox"],
    queryFn: () => fetchAdminInboxItems(100),
    refetchInterval: 60_000,
    staleTime: 45_000,
    refetchOnWindowFocus: false,
  });

  const items = filterSnoozedItems(asInboxItems(inbox.data));
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
        badge={DIRECTOR_QUEUE_SUBTITLE}
        title={DIRECTOR_QUEUE_TITLE}
        description="À relire avant envoi, questions et clôtures — distinct des messages (Gestion → Messages)."
        actions={
          <>
            <PageLink href={`${DIRECTOR_QUEUE_HREF}?triage=1`}>Traiter</PageLink>
            <PageLink href="/briefing">Aujourd&apos;hui</PageLink>
            <PageLink href="/missions" variant="secondary">
              Travaux
            </PageLink>
          </>
        }
      />

      {!inbox.isLoading && pending > 0 ? (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard label="En attente" value={pending} tone="urgent" hint={`Mode triage : Ctrl+K → ${DIRECTOR_QUEUE_LABEL}`} />
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
                      `Clôturer ${closableCount} travail(x) terminé(s) ou en échec ?\n\nLes questions et validations en attente restent intactes.`,
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

      {inbox.isLoading ? <LoadingLine label="Chargement des décisions…" /> : null}
      {inbox.isError ? (
        <AlertBox tone="error" title="Impossible de charger les décisions">
          {inbox.error instanceof Error ? inbox.error.message : "Erreur réseau"}
        </AlertBox>
      ) : null}

      {!inbox.isLoading ? (
        <DirectorInboxList
          items={items}
          emptyTitle={DIRECTOR_QUEUE_EMPTY}
          emptyHint="Toutes vos décisions sont traitées. Retournez au briefing pour la suite de votre journée."
        />
      ) : null}
    </PageShell>
  );
}

export default function InboxPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-500">Chargement des décisions…</div>}>
      <InboxPageContent />
    </Suspense>
  );
}
