"use client";

type Props = {
  plan: Record<string, unknown>;
  className?: string;
};

export default function CioPlanReadableSummary({ plan, className = "" }: Props) {
  const syn = String(plan.synthese_attendue || "").trim();
  const agents = Array.isArray(plan.agents) ? plan.agents.map((a) => String(a)).filter(Boolean) : [];
  const subs =
    plan.sous_taches && typeof plan.sous_taches === "object" && !Array.isArray(plan.sous_taches)
      ? (plan.sous_taches as Record<string, unknown>)
      : {};

  const subEntries = Object.entries(subs).filter(([, v]) => String(v || "").trim());

  if (!syn && !agents.length && !subEntries.length) {
    return (
      <p className={`rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950 ${className}`}>
        Plan CIO non chargé — rafraîchissez la page ou rouvrez la mission depuis l&apos;inbox.
      </p>
    );
  }

  return (
    <div className={`space-y-3 rounded-xl border border-violet-100 bg-white p-3 shadow-inner ${className}`}>
      {syn ? (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-violet-800">Synthèse attendue</p>
          <p className="mt-1 text-sm leading-relaxed text-slate-800">{syn}</p>
        </div>
      ) : null}
      {agents.length ? (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-violet-800">Agents mobilisés</p>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {agents.map((a) => (
              <li key={a} className="rounded-md bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-900">
                {a}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {subEntries.length ? (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-violet-800">Sous-tâches par rôle</p>
          <ul className="mt-1 space-y-2">
            {subEntries.map(([role, task]) => (
              <li key={role} className="rounded-lg border border-slate-100 bg-slate-50/80 px-2.5 py-2">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{role}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-800">{String(task)}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
