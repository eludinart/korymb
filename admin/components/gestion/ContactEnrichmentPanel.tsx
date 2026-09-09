"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import AgentMessageMarkdown from "../AgentMessageMarkdown";
import ContactEnrichmentValue from "./ContactEnrichmentValue";
import { AlertBox, LoadingLine } from "../ui/PageChrome";
import { businessApi, type BizContact, type ContactEnrichmentProposal } from "../../lib/business";
import {
  contactFieldLabel,
  currentContactValue,
  formatProposedValue,
  getContactReachability,
} from "../../lib/contactReachability";
import { defaultEnrichmentSelected, enrichmentFieldCaution } from "../../lib/contactFieldTrust";

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
  const [forceExplore, setForceExplore] = useState(false);
  const autoFilledJobRef = useRef<string | null>(null);

  const reach = getContactReachability(contact);
  const isComplete = reach.level === "complete";

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
    mutationFn: () => businessApi.fillContactFromExploration(contact.id, false),
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
      } else if (data.proposal) {
        setFeedback("Proposition extraite — coche uniquement ce qui est sûr, puis applique.");
      } else if (data.skipped) {
        setFeedback(`Pas de proposition (${data.reason || "inconnu"}).`);
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
    for (const k of Object.keys(proposal.proposed || {})) {
      next[k] = defaultEnrichmentSelected(contact, k, proposal.proposed[k]);
    }
    setSelected(next);
    setSelectionProposalId(proposal.id);
  }, [proposal, selectionProposalId]);

  // Extrait une proposition à valider (jamais d'écriture auto sur la fiche).
  useEffect(() => {
    const jobId = exploration.data?.job_id;
    if (!jobId) return;
    if (exploration.data?.status !== "completed") return;
    if (!exploration.data?.can_fill) return;
    if (proposal) return;
    if (autoFilledJobRef.current === jobId) return;
    if (fillFromExploration.isPending) return;
    autoFilledJobRef.current = jobId;
    fillFromExploration.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutate once per completed job
  }, [exploration.data?.job_id, exploration.data?.status, exploration.data?.can_fill, proposal]);

  const explore = useMutation({
    mutationFn: (force: boolean) => businessApi.exploreContact(contact.id, force),
    onSuccess: (data) => {
      setFeedback(
        data.job_id
          ? `Exploration lancée (#${data.job_id}). Tu valideras les champs trouvés avant écriture.`
          : data.message || "Exploration lancée.",
      );
      setShowFullResult(false);
      setForceExplore(false);
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
      {isComplete && !exploreActive ? (
        <AlertBox tone="success" title="Fiche déjà complète">
          Email et canal de contact présents — pas d&apos;exploration systématique.
          Tu peux forcer une nouvelle recherche seulement si tu veux vérifier / compléter (réseaux, Resalib…).
        </AlertBox>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {isComplete && !forceExplore ? (
          <button
            type="button"
            className="btn-secondary"
            disabled={explore.isPending || exploreActive}
            onClick={() => setForceExplore(true)}
          >
            Forcer une exploration…
          </button>
        ) : (
          <button
            type="button"
            className="btn-primary"
            disabled={explore.isPending || exploreActive}
            onClick={() => {
              setFeedback("");
              explore.mutate(isComplete);
            }}
          >
            {explore.isPending || exploreActive
              ? "Exploration en cours…"
              : isComplete
                ? "Lancer quand même"
                : "Explorer en détail"}
          </button>
        )}
        {forceExplore && isComplete && !exploreActive ? (
          <button type="button" className="btn-link-secondary text-xs" onClick={() => setForceExplore(false)}>
            Annuler
          </button>
        ) : null}
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
            {fillFromExploration.isPending ? "Extraction…" : "Extraire une proposition"}
          </button>
        ) : null}
        <p className="text-xs text-slate-600">
          {isComplete
            ? "Exploration optionnelle — utile pour réseaux / annuaires, pas pour re-remplir l’essentiel."
            : "Recherche email, tél, site, adresse, réseaux — puis proposition à valider (rien n’est écrit tout seul)."}
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
          {exploreJobId ? ` (#${exploreJobId})` : ""}.
          {isComplete
            ? " La fiche est déjà complète — le résultat servira surtout à vérifier / enrichir."
            : " Tu valideras les champs trouvés avant qu’ils soient écrits sur la fiche."}
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

      {fillFromExploration.isPending ? <LoadingLine label="Extraction de la proposition (sans écriture)…" /> : null}

      {!exploreActive && exploreResult ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4">
          <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-sm font-extrabold text-emerald-950">
                {alreadyFilled ? "Résultat déjà validé sur la fiche" : "Résultat trouvé — à vérifier"}
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
                {" — les cases douteuses sont décochées."}
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
              const caution = enrichmentFieldCaution(contact, key, proposed);
              const currentRaw =
                key === "socials"
                  ? contact.socials || {}
                  : key === "notes_append"
                    ? ""
                    : key === "outreach_suggestions"
                      ? contact.outreach_suggestions || ""
                      : (contact as Record<string, unknown>)[key];
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
                    <div className="text-slate-500">
                      <span className="text-[11px] font-bold uppercase tracking-wide">Actuel</span>
                      <div className="mt-0.5 text-slate-800">
                        <ContactEnrichmentValue field={key} value={currentRaw} />
                      </div>
                    </div>
                    <div className={`mt-2 ${changed ? "text-emerald-950" : "text-slate-700"}`}>
                      <span className="text-[11px] font-bold uppercase tracking-wide text-emerald-800">Proposé</span>
                      <div className="mt-0.5">
                        <ContactEnrichmentValue field={key} value={proposed} />
                      </div>
                    </div>
                    {caution ? <p className="mt-1 text-xs font-medium text-amber-800">{caution}</p> : null}
                  </div>
                </li>
              );
            })}
          </ul>
          {proposal.sources?.length ? (
            <p className="mt-3 text-xs text-slate-600">
              Sources :{" "}
              {proposal.sources.slice(0, 8).map((src, i) => (
                <span key={`${src}-${i}`}>
                  {i > 0 ? " · " : null}
                  {/^https?:\/\//i.test(src) ? (
                    <a href={src} target="_blank" rel="noreferrer" className="underline">
                      {src.replace(/^https?:\/\//, "").slice(0, 48)}
                    </a>
                  ) : (
                    src
                  )}
                </span>
              ))}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
