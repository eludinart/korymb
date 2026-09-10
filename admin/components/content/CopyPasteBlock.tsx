"use client";

import { useState } from "react";

export default function CopyPasteBlock({
  text,
  label = "Texte copiable",
}: {
  text: string;
  label?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");
  const body = (text || "").trim();
  if (!body) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(body);
      setState("copied");
    } catch {
      setState("error");
    }
  };

  const rows = Math.min(14, Math.max(4, body.split("\n").length + 1));

  return (
    <div className="mt-2">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <button
          type="button"
          onClick={() => void copy()}
          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-800 hover:bg-slate-50"
        >
          {state === "copied" ? "Copié" : state === "error" ? "Sélectionnez le texte ci-dessous" : "Copier"}
        </button>
      </div>
      <textarea
        readOnly
        value={body}
        rows={rows}
        className="w-full resize-y rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-slate-800"
      />
      {state === "copied" ? <p className="mt-1 text-[11px] text-emerald-800">Copié dans le presse-papiers.</p> : null}
      {state === "error" ? (
        <p className="mt-1 text-[11px] text-amber-800">Copie automatique impossible — sélectionnez tout le texte puis Ctrl+C.</p>
      ) : null}
    </div>
  );
}
