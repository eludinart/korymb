"use client";

import { useLockedAction } from "../../lib/useLockedAction";
import { resolveConfigSuggestion } from "../../lib/missionActions";

export type ScienceProposeOutcome = {
  status: "applied" | "rejected";
  count?: number;
};

type Props = {
  suggestionIds: string[];
  initialOutcome?: ScienceProposeOutcome | null;
  onSettled?: (outcome: ScienceProposeOutcome) => void;
};

function OutcomeBanner({ outcome }: { outcome: ScienceProposeOutcome }) {
  const ok = outcome.status === "applied";
  return (
    <div
      className={`mt-3 rounded-2xl border-2 px-4 py-3 text-sm ${
        ok
          ? "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100"
          : "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
      }`}
    >
      {ok
        ? `Enregistré dans Science${outcome.count && outcome.count > 1 ? ` (${outcome.count} écritures)` : ""}. Ouvre Gestion → Science pour voir Identité, fiches et documents.`
        : "Proposition Science annulée — rien n'a été écrit."}
    </div>
  );
}

export default function ScienceProposeCard({
  suggestionIds,
  initialOutcome = null,
  onSettled,
}: Props) {
  const lock = useLockedAction();
  const ids = suggestionIds.map((id) => id.trim()).filter(Boolean);

  if (initialOutcome) {
    return <OutcomeBanner outcome={initialOutcome} />;
  }

  if (!ids.length) return null;

  if (lock.isDone) {
    return (
      <div className="mt-3 rounded-2xl border-2 border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100">
        {lock.doneMessage || "Enregistré dans Science."}
      </div>
    );
  }

  const applyAll = () =>
    void lock.run(
      async () => {
        let applied = 0;
        for (const sid of ids) {
          await resolveConfigSuggestion(sid, "apply");
          applied += 1;
        }
        onSettled?.({ status: "applied", count: applied });
      },
      { doneMessage: "Enregistré dans Science." },
    );

  const dismiss = () =>
    void lock.run(
      async () => {
        for (const sid of ids) {
          try {
            await resolveConfigSuggestion(sid, "dismiss");
          } catch {
            /* ignore déjà traité */
          }
        }
        onSettled?.({ status: "rejected" });
      },
      { doneMessage: "Proposition annulée." },
    );

  return (
    <div className="mt-3 rounded-2xl border-2 border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-800 dark:bg-emerald-950/40">
      <p className="text-sm font-bold text-emerald-950 dark:text-emerald-100">
        Enregistrer dans Science de l&apos;entreprise ?
      </p>
      <p className="mt-1 text-sm text-emerald-900/90 dark:text-emerald-100/90">
        {ids.length > 1
          ? `${ids.length} écritures proposées (faits, fiches ou documents). Rien n'est écrit tant que tu ne valides pas.`
          : "Une écriture est proposée. Rien n'est écrit tant que tu ne valides pas."}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={lock.busy}
          onClick={applyAll}
          className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {lock.busy ? "Enregistrement…" : "Enregistrer dans Science"}
        </button>
        <button
          type="button"
          disabled={lock.busy}
          onClick={dismiss}
          className="rounded-xl px-3 py-2 text-sm font-semibold text-emerald-900/80 hover:bg-emerald-100 dark:text-emerald-100 dark:hover:bg-emerald-900/50"
        >
          Annuler
        </button>
        <a
          href="/gestion/science"
          className="inline-flex items-center rounded-xl px-3 py-2 text-xs font-semibold text-emerald-800 underline-offset-2 hover:underline dark:text-emerald-200"
        >
          Ouvrir Science
        </a>
      </div>
      {lock.error ? <p className="mt-2 text-xs font-semibold text-rose-700">{lock.error}</p> : null}
    </div>
  );
}
