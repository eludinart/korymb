"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertBox, LoadingLine } from "../ui/PageChrome";
import { businessApi } from "../../lib/business";

const ACTIVE = new Set(["pending", "running", "accepted", "awaiting_validation"]);

type Props = {
  contactId: string;
  value: string;
  onChange: (next: string) => void;
};

export default function ContactOutreachSuggestionsField({ contactId, value, onChange }: Props) {
  const qc = useQueryClient();
  const [feedback, setFeedback] = useState("");
  const appliedJobRef = useRef<string | null>(null);

  const job = useQuery({
    queryKey: ["contact-outreach", contactId],
    queryFn: () => businessApi.getOutreachSuggestionsJob(contactId),
    refetchInterval: (q) => {
      const st = String(q.state.data?.status || "");
      if (ACTIVE.has(st)) return 4_000;
      return false;
    },
  });

  const apply = useMutation({
    mutationFn: () => businessApi.applyOutreachSuggestions(contactId),
    onSuccess: (data) => {
      if (data.applied && data.contact?.outreach_suggestions != null) {
        onChange(String(data.contact.outreach_suggestions));
        setFeedback("Suggestions avancées ajoutées à la fiche.");
      } else if (data.skipped && data.reason === "already_applied_for_job") {
        setFeedback("Ces suggestions ont déjà été appliquées.");
      } else {
        setFeedback(data.reason ? `Non appliqué (${data.reason}).` : "Suggestions enregistrées.");
      }
      void qc.invalidateQueries({ queryKey: ["business-contact", contactId] });
      void qc.invalidateQueries({ queryKey: ["contact-outreach", contactId] });
      void qc.invalidateQueries({ queryKey: ["business-interactions", contactId] });
    },
    onError: (e: Error) => setFeedback(e.message || "Impossible d'appliquer les suggestions."),
  });

  const launch = useMutation({
    mutationFn: () => businessApi.launchOutreachSuggestions(contactId),
    onSuccess: (data) => {
      setFeedback(
        data.job_id
          ? `Suggestions avancées lancées (#${data.job_id}).`
          : data.message || "Mission lancée.",
      );
      appliedJobRef.current = null;
      void qc.invalidateQueries({ queryKey: ["contact-outreach", contactId] });
    },
    onError: (e: Error) => setFeedback(e.message || "Impossible de lancer les suggestions."),
  });

  useEffect(() => {
    const jobId = job.data?.job_id;
    if (!jobId) return;
    if (job.data?.status !== "completed") return;
    if (!job.data?.can_apply) return;
    if (appliedJobRef.current === jobId) return;
    if (apply.isPending) return;
    appliedJobRef.current = jobId;
    apply.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.data?.job_id, job.data?.status, job.data?.can_apply]);

  const active = Boolean(job.data?.status && ACTIVE.has(String(job.data.status)));
  const jobId = job.data?.job_id || launch.data?.job_id || null;

  return (
    <div className="sm:col-span-2 space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <span className="font-medium text-slate-700">Suggestions pour le contacter</span>
          <p className="mt-0.5 text-xs text-slate-500">
            Angle d’approche, canal, accroche, offre — approfondi à partir des missions / interactions passées.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary text-sm"
          disabled={launch.isPending || active}
          onClick={() => {
            setFeedback("");
            launch.mutate();
          }}
        >
          {launch.isPending || active ? "Suggestions en cours…" : "Suggestions avancées"}
        </button>
      </div>

      <textarea
        className="input-field mt-1 w-full"
        rows={5}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Ex. : email perso + accroche intelligence collective…"
      />

      {active ? (
        <AlertBox tone="success" title="Suggestions avancées">
          Le Commercial approfondit l’approche
          {jobId ? ` (#${jobId})` : ""}. Le texte sera mis à jour à la fin.
          {jobId ? (
            <>
              {" "}
              <Link href={`/missions?job=${encodeURIComponent(jobId)}`} className="font-bold underline">
                Suivre →
              </Link>
            </>
          ) : null}
        </AlertBox>
      ) : null}

      {apply.isPending ? <LoadingLine label="Écriture des suggestions…" /> : null}

      {feedback ? (
        <AlertBox tone={launch.isError || apply.isError ? "error" : "success"} title="Suggestions">
          {feedback}
          {jobId && !active ? (
            <>
              {" "}
              <Link href={`/missions?job=${encodeURIComponent(jobId)}`} className="font-bold underline">
                Voir la mission →
              </Link>
            </>
          ) : null}
        </AlertBox>
      ) : null}
    </div>
  );
}
