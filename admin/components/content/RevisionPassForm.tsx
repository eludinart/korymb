"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { reviseJob } from "../../lib/contentRevise";

export default function RevisionPassForm({
  jobId,
  formatId = "",
  disabled = false,
  onLaunched,
}: {
  jobId: string;
  formatId?: string;
  disabled?: boolean;
  onLaunched?: (jobId: string) => void;
}) {
  const [instruction, setInstruction] = useState("");
  const revise = useMutation({
    mutationFn: () => reviseJob(jobId, instruction, formatId),
    onSuccess: (data) => {
      setInstruction("");
      if (data.job_id) onLaunched?.(data.job_id);
    },
  });

  return (
    <div className="mt-3 rounded-lg border border-violet-100 bg-violet-50/60 p-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-900">Nouvelle passe</p>
      <p className="mt-0.5 text-[11px] text-violet-800">Le premier jet n’est pas forcément le bon. Demandez une correction.</p>
      <textarea
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        disabled={disabled || revise.isPending}
        rows={3}
        placeholder="Ex. plus court, tutoiement, enlever le jargon, garder uniquement le CTA…"
        className="mt-2 w-full rounded-lg border border-violet-200 bg-white px-2 py-1.5 text-xs text-slate-800 disabled:opacity-50"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={disabled || revise.isPending || instruction.trim().length < 4}
          onClick={() => revise.mutate()}
          className="rounded-lg bg-violet-700 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
        >
          {revise.isPending ? "Nouvelle passe…" : "Demander une correction"}
        </button>
        {revise.isSuccess ? (
          <p className="text-[11px] text-emerald-800">
            Passe lancée.{" "}
            <Link href={`/missions?job=${encodeURIComponent(revise.data.job_id)}`} className="font-semibold underline">
              Ouvrir la mission
            </Link>
          </p>
        ) : null}
      </div>
      {revise.isError ? (
        <p className="mt-2 text-[11px] text-red-700">
          {revise.error instanceof Error ? revise.error.message : "Correction impossible."}
        </p>
      ) : null}
    </div>
  );
}
