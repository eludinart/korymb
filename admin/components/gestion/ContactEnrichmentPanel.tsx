"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import AgentMessageMarkdown from "../AgentMessageMarkdown";
import { AlertBox, LoadingLine } from "../ui/PageChrome";
import { businessApi, type BizContact, type ContactEnrichmentProposal } from "../../lib/business";
import {
  contactFieldLabel,
  currentContactValue,
  formatProposedValue,
} from "../../lib/contactReachability";

type Props = {
  contact: BizContact;
};

const ACTIVE_STATUSES = new Set(["pending", "running", "accepted", "awaiting_validation"]);

export default function ContactEnrichmentPanel({ contact }: Props) {
  const qc = useQueryClient();
  const [feedback, setFeedback] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [selectionProposalId, setSelectionProposalId] = useState<string | null>(null);
  const [showFullResult, setShowFullResult] = useState(false);
  const autoFilledJobRef = useRef<string | null>(null);

  const exploration = useQuery({
    queryKey: ["contact-exploration", contact.id],
    queryFn: () => businessApi.getContactExploration(contact.id),
    refetchInterval: (q) => {
      const st = String(q.state.data?.status || "");
      if (ACTIVE_STATUSES.has(st)) return 4_000;
      return 30_000;
    },
  });

  const proposals = useQuery({
    queryKey: ["contact-enrichment", contact.id],
    queryFn: () => businessApi.listEnrichmentProposals(contact.id, "pending"),
    refetchInterval: 20_000,
  });

  const proposal: ContactEnrichmentProposal | undefined = proposals.data?.[0];
  const proposedKeys = useMemo(() => Object.keys(proposal?.proposed || {}), [proposal]);

  const fillFromExploration = useMutation({
    mutationFn: () => businessApi.fillContactFromExploration(contact.id, true),
    onSuccess: (data) => {
      if (data.applied) {
        const keys = Object.keys(data.fields || {});
        setFeedback(
          keys.length
            ? `Fiche mise à jour : ${keys.filter((k) => k !== "notes_append").join(", ")}.`
            : "Fiche contact mise à jour depuis l'exploration.",
        );
      } else if (data.skipped && data.reason === "already_applied_for_job") {
        setFeedback("Cette exploration a déjà été appliquée à la fiche.");
      } else if (data.skipped) {
        setFeedback(`Pas d'écriture automatique (${data.reason || "inconnu"}).`);
      } else {
        setFeedback("Proposition créée — valide le diff ci-dessous.");
      }
      void qc.invalidateQueries({ queryKey: ["business-contact", contact.id] });
      void qc.invalidateQueries({ queryKey: ["business-contacts"] });
      void qc.invalidateQueries({ queryKey: ["contact-enrichment", contact.id] });
      void qc.invalidateQueries({ queryKey: ["contact-exploration", contact.id] });
      void qc.invalidateQueries({ queryKey: ["business-interactions", contact.id] });
    },
    onError: (e: Error) => setFeedback(e.message || "Impossible de remplir la fiche."),
  });

  useEffect(() => {
    if (!proposal) {
      setSelected({});
      setSelectionProposalId(null);
      return;
    }
    if (selectionProposalId === proposal.id) return;
    const next: Record<string, boolean> = {};
    for (const k of Object.keys(proposal.proposed || {})) next[k] = true;
    setSelected(next);
    setSelectionProposalId(proposal.id);
  }, [proposal, selectionProposalId]);

  // Dès qu'une exploration est terminée avec des infos, remplit la fiche une fois.
  useEffect(() => {
    const jobId = exploration.data?.job_id;
    if (!jobId) return;
    if (exploration.data?.status !== "completed") return;
    if (!exploration.data?.can_fill) return;
    if (autoFilledJobRef.current === jobId) return;
    if (fillFromExploration.isPending) return;
    autoFilledJobRef.current = jobId;
    fillFromExploration.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutate once per completed job
  }, [exploration.data?.job_id, exploration.data?.status, exploration.data?.can_fill]);

  const explore = useMutation({
    mutationFn: () => businessApi.exploreContact(contact.id),
    onSuccess: (data) => {
      setFeedback(
        data.job_id
          ? `Exploration lancée (#${data.job_id}). La fiche sera remplie à la fin.`
          : data.message || "Exploration lancée.",
      );
      setShowFullResult(false);
      autoFilledJobRef.current = null;
      void qc.invalidateQueries({ queryKey: ["contact-exploration", contact.id] });
      void qc.invalidateQueries({ queryKey: ["business-interactions", contact.id] });
    },
    onError: (e: Error) => setFeedback(e.message || "Impossible de lancer l'exploration."),
  });

  const apply = useMutation({
    mutationFn: async () => {
      if (!proposal) throw new Error("Aucune proposition");
      const fields = proposedKeys.filter((k) => selected[k] !== false);
      return businessApi.applyEnrichmentProposal(contact.id, proposal.id, fields);
    },
    onSuccess: () => {
      setFeedback("Enrichissement appliqué.");
      void qc.invalidateQueries({ queryKey: ["business-contact", contact.id] });
      void qc.invalidateQueries({ queryKey: ["business-contacts"] });
      void qc.invalidateQueries({ queryKey: ["contact-enrichment", contact.id] });
      void qc.invalidateQueries({ queryKey: ["business-interactions", contact.id] });
    },
    onError: (e: Error) => setFeedback(e.message),
  });

  const reject = useMutation({
    mutationFn: async () => {
      if (!proposal) throw new Error("Aucune proposition");
      return businessApi.rejectEnrichmentProposal(contact.id, proposal.id);
    },
    onSuccess: () => {
      setFeedback("Proposition ignorée.");
      void qc.invalidateQueries({ queryKey: ["contact-enrichment", contact.id] });
    },
    onError: (e: Error) => setFeedback(e.message),
  });

  const exploreStatus = exploration.data?.status || null;
  const exploreActive = Boolean(exploreStatus && ACTIVE_STATUSES.has(exploreStatus));
  const exploreResult = (exploration.data?.result || "").trim();
  const exploreSummary = (exploration.data?.summary || "").trim();
  const exploreJobId = exploration.data?.job_id || explore.data?.job_id || null;
  const displayMarkdown = showFullResult ? exploreResult : exploreSummary || exploreResult;
  const canFill = Boolean(exploration.data?.can_fill);
  const alreadyFilled = Boolean(exploration.data?.already_filled);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={explore.isPending || exploreActive}
          onClick={() => {
            setFeedback("");
            explore.mutate();
          }}
        >
          {explore.isPending || exploreActive ? "Exploration en cours…" : "Explorer en détail"}
        </button>
        {canFill ? (
          <button
            type="button"
            className="btn-success"
            disabled={fillFromExploration.isPending}
            onClick={() => {
              setFeedback("");
              autoFilledJobRef.current = exploreJobId;
              fillFromExploration.mutate();
            }}
          >
            {fillFromExploration.isPending ? "Remplissage…" : "Remplir la fiche"}
          </button>
        ) : null}
        <p className="text-xs text-slate-600">
          Recherche email, tél, site, adresse, réseaux — puis écriture sur la fiche.
        </p>
      </div>

      {feedback ? (
        <AlertBox
          tone={explore.isError || apply.isError || reject.isError || fillFromExploration.isError ? "error" : "success"}
          title="Exploration"
        >
          {feedback}
          {exploreJobId ? (
            <>
              {" "}
              <Link href={`/missions?job=${encodeURIComponent(exploreJobId)}`} className="font-bold underline">
                Suivre la mission →
              </Link>
            </>
          ) : null}
        </AlertBox>
      ) : null}

      {exploration.isLoading ? <LoadingLine label="Chargement du dernier résultat…" /> : null}

      {exploreActive ? (
        <AlertBox tone="success" title="Recherche en cours">
          Le Commercial analyse le contact
          {exploreJobId ? ` (#${exploreJobId})` : ""}. La fiche sera remplie automatiquement à la fin.
          {exploreJobId ? (
            <>
              {" "}
              <Link href={`/missions?job=${encodeURIComponent(exploreJobId)}`} className="font-bold underline">
                Suivre →
              </Link>
            </>
          ) : null}
        </AlertBox>
      ) : null}

      {fillFromExploration.isPending ? <LoadingLine label="Écriture des infos sur la fiche…" /> : null}

      {!exploreActive && exploreResult ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4">
          <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-sm font-extrabold text-emerald-950">
                {alreadyFilled ? "Résultat appliqué à la fiche" : "Résultat trouvé"}
              </p>
              <p className="mt-0.5 text-xs text-emerald-900">
                Mission #{exploreJobId}
                {exploreStatus ? ` · ${exploreStatus}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {exploreSummary && exploreResult.length > exploreSummary.length ? (
                <button
                  type="button"
                  className="text-xs font-medium text-emerald-900 underline"
                  onClick={() => setShowFullResult((v) => !v)}
                >
                  {showFullResult ? "Voir le résumé" : "Voir le détail complet"}
                </button>
              ) : null}
              {exploreJobId ? (
                <Link
                  href={`/missions?job=${encodeURIComponent(exploreJobId)}`}
                  className="text-xs font-medium text-violet-800 underline"
                >
                  Mission →
                </Link>
              ) : null}
            </div>
          </div>
          <div className="max-h-[22rem] overflow-y-auto rounded-xl border border-emerald-100 bg-white px-3 py-2 text-sm text-slate-800">
            <AgentMessageMarkdown source={displayMarkdown} />
          </div>
        </div>
      ) : null}

      {proposals.isLoading ? <LoadingLine label="Chargement des propositions…" /> : null}

      {proposal ? (
        <div className="rounded-2xl border-2 border-amber-200 bg-amber-50/50 p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-sm font-extrabold text-amber-950">Proposition à valider</p>
              <p className="mt-0.5 text-xs text-amber-900">
                {proposal.summary || "Enrichissement proposé par l'agent Commercial"}
                {proposal.job_id ? ` · mission #${proposal.job_id}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-success text-sm"
                disabled={apply.isPending || reject.isPending}
                onClick={() => apply.mutate()}
              >
                {apply.isPending ? "Application…" : "Appliquer la sélection"}
              </button>
              <button
                type="button"
                className="btn-secondary text-sm"
                disabled={apply.isPending || reject.isPending}
                onClick={() => reject.mutate()}
              >
                Ignorer
              </button>
            </div>
          </div>

          <ul className="space-y-2">
            {proposedKeys.map((key) => {
              const proposed = proposal.proposed[key];
              const current = currentContactValue(contact, key);
              const next = formatProposedValue(key, proposed);
              const changed = current !== next && next !== "—";
              return (
                <li
                  key={key}
                  className="grid gap-2 rounded-xl border border-amber-100 bg-white px-3 py-2 sm:grid-cols-[auto_1fr]"
                >
                  <label className="flex items-start gap-2 pt-0.5">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selected[key] !== false}
                      onChange={(e) => setSelected((s) => ({ ...s, [key]: e.target.checked }))}
                    />
                    <span className="text-xs font-bold uppercase tracking-wide text-slate-600">
                      {contactFieldLabel(key)}
                    </span>
                  </label>
                  <div className="min-w-0 text-sm">
                    <p className="text-slate-500">
                      Actuel : <span className="text-slate-800">{current}</span>
                    </p>
                    <p className={changed ? "font-semibold text-emerald-900" : "text-slate-700"}>
                      Proposé : {next}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
