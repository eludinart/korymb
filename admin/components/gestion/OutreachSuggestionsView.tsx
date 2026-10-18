"use client";

import AgentMessageMarkdown from "../AgentMessageMarkdown";
import { parseOutreachSuggestions, type OutreachAngle } from "../../lib/outreachSuggestions";

function AngleCard({ angle }: { angle: OutreachAngle }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
      <h3 className="text-sm font-semibold leading-snug text-slate-950">{angle.title}</h3>
      {angle.pitch ? <p className="mt-1.5 text-sm leading-relaxed text-slate-700">{angle.pitch}</p> : null}
      {angle.details.length ? (
        <dl className="mt-2 space-y-2 border-t border-slate-100 pt-2">
          {angle.details.map((detail) => (
            <div key={`${detail.label}-${detail.value.slice(0, 24)}`}>
              <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{detail.label}</dt>
              <dd className="mt-0.5 text-sm leading-relaxed text-slate-800">{detail.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}

export default function OutreachSuggestionsView({ source }: { source: string }) {
  const entries = parseOutreachSuggestions(source);
  if (!entries.length) return null;

  return (
    <div className="space-y-3">
      {entries.map((entry, index) => (
        <article key={`${entry.when}-${index}`} className="space-y-2">
          {entry.when ? (
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{entry.when}</p>
          ) : null}
          {entry.intro ? <p className="text-sm leading-relaxed text-slate-700">{entry.intro}</p> : null}
          {entry.angles.length ? (
            <div className="space-y-2">
              {entry.angles.map((angle, angleIndex) => (
                <AngleCard key={`${angle.title}-${angleIndex}`} angle={angle} />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800">
              <AgentMessageMarkdown source={entry.body} />
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
