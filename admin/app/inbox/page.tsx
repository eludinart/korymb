"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import DirectorInboxList from "../../components/director/DirectorInboxList";
import InboxTriageMode from "../../components/director/InboxTriageMode";
import {
  AlertBox,
  LoadingLine,
  PageHeader,
  PageLink,
  PageShell,
  StatCard,
} from "../../components/ui/PageChrome";
import { filterSnoozedItems } from "../../lib/inboxSnooze";
import { asInboxItems, fetchAdminInboxItems } from "../../lib/inboxQuery";
import { DIRECTOR_QUEUE_EMPTY, DIRECTOR_QUEUE_HREF, DIRECTOR_QUEUE_LABEL, DIRECTOR_QUEUE_SUBTITLE, DIRECTOR_QUEUE_TITLE } from "../../lib/directorQueue";
import { closeInboxBulk, resolveLearningBulk } from "../../lib/missionActions";

function InboxPageContent() {
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const triageMode = searchParams.get("triage") === "1";
  const severityParam = (searchParams.get("severity") || "").trim().toLowerCase();
  const initialSeverity =
    severityParam === "critical" || severityParam === "high" || severityParam === "actionable"
      ? severityParam
      : null;
  const [bulkMsg, setBulkMsg] = useState("");
  const [bulkTone, setBulkTone] = useState<"success" | "error">("success");

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
  const memoryCount = items.filter((i) => i.kind === "learning_suggestion").length;

  const onDismissed = () => {
    void qc.invalidateQueries({ queryKey: ["admin-inbox"] });
    void qc.invalidateQueries({ queryKey: ["admin-briefing"] });
  };

  const bulkClose = useMutation({
    mutationFn: () => closeInboxBulk(["closure", "mission_error"]),
    onSuccess: (data) => {
      const n = Number(data.closed_count || 0);
      setBulkTone("success");
      setBulkMsg(n > 0 ? `${n} mission(s) clôturée(s).` : "Aucune mission à clôturer.");
      onDismissed();
      void qc.invalidateQueries({ queryKey: ["jobs-cards"] });
    },
    onError: (err) => {
      setBulkTone("error");
      setBulkMsg(err instanceof Error ? err.message : "Échec de la clôture groupée.");
    },
  });

  const bulkMemory = useMutation({
    mutationFn: (decision: "approve" | "reject") => resolveLearningBulk(decision, 100),
    onSuccess: (data, decision) => {
      const n = Number(data.resolved_count || 0);
      setBulkTone("success");
      setBulkMsg(
        decision === "approve"
          ? n > 0
            ? `${n} suggestion(s) intégrée(s) à la mémoire.`
            : "Aucune suggestion mémoire à intégrer."
          : n > 0
            ? `${n} suggestion(s) mémoire ignorée(s).`
            : "Aucune suggestion mémoire à ignorer.",
      );
      onDismissed();
    },
    onError: (err) => {
      setBulkTone("error");
      setBulkMsg(err instanceof Error ? err.message : "Échec du traitement mémoire groupé.");
    },
  });

  const bulkBusy = bulkClose.isPending || bulkMemory.isPending;

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
                disabled={bulkBusy}
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

      {!inbox.isLoading && memoryCount > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-3 py-3">
          <p className="mr-auto text-sm text-emerald-950">
            <span className="font-bold">{memoryCount}</span> suggestion
            {memoryCount > 1 ? "s" : ""} mémoire — intégrer ou ignorer en un geste.
          </p>
          <button
            type="button"
            disabled={bulkBusy}
            onClick={() => {
              if (
                typeof window !== "undefined" &&
                !window.confirm(`Intégrer ${memoryCount} suggestion(s) à la mémoire entreprise ?`)
              ) {
                return;
              }
              setBulkMsg("");
              bulkMemory.mutate("approve");
            }}
            className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            {bulkMemory.isPending ? "Traitement…" : `Tout intégrer (${memoryCount})`}
          </button>
          <button
            type="button"
            disabled={bulkBusy}
            onClick={() => {
              if (
                typeof window !== "undefined" &&
                !window.confirm(`Ignorer ${memoryCount} suggestion(s) mémoire ?`)
              ) {
                return;
              }
              setBulkMsg("");
              bulkMemory.mutate("reject");
            }}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 disabled:opacity-50"
          >
            Tout ignorer
          </button>
        </div>
      ) : null}

      {bulkMsg ? (
        <AlertBox tone={bulkTone} title={bulkTone === "error" ? "Action groupée" : "OK"}>
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
          initialSeverity={initialSeverity}
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
