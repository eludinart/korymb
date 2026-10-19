"use client";

import { parseFactNotes } from "../../lib/factNotes";

export default function FactNotesView({ source }: { source: string }) {
  const facts = parseFactNotes(source);
  if (!facts.length) return null;
  if (!facts.some((fact) => fact.label)) {
    return <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{source.trim()}</div>;
  }

  return (
    <dl className="space-y-2">
      {facts.map((fact, index) => (
        <div key={`${fact.label || "note"}-${index}`} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
          {fact.label ? (
            <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{fact.label}</dt>
          ) : null}
          <dd className={`${fact.label ? "mt-0.5 " : ""}text-sm leading-relaxed text-slate-800`}>{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}
