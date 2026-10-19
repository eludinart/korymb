"use client";

import type { StarterPackSummary } from "../lib/starterPacks";

type Props = {
  packs: StarterPackSummary[];
  value: string;
  onChange: (packId: string) => void;
  disabled?: boolean;
  name?: string;
};

export default function StarterPackPicker({ packs, value, onChange, disabled, name = "starter_pack_id" }: Props) {
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-sm font-semibold text-slate-700 dark:text-slate-200">Modèle de démarrage</legend>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Optionnel. Un modèle prépare des demandes types et quelques phrases sur l&apos;activité — vous pourrez tout
        modifier ensuite.
      </p>
      <div className="space-y-2">
        {packs.map((pack) => {
          const selected = value === pack.id;
          return (
            <label
              key={pack.id}
              className={`flex cursor-pointer gap-3 rounded-xl border px-3 py-2.5 text-sm transition ${
                selected
                  ? "border-violet-600 bg-violet-50 ring-1 ring-violet-600 dark:border-violet-400 dark:bg-violet-950/50 dark:ring-violet-400"
                  : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-950 dark:hover:border-slate-500"
              }`}
            >
              <input
                type="radio"
                className="mt-1 accent-violet-700"
                name={name}
                value={pack.id}
                checked={selected}
                onChange={() => onChange(pack.id)}
              />
              <span className="min-w-0">
                <span className="block font-bold text-slate-900 dark:text-slate-50">{pack.label}</span>
                <span className="mt-0.5 block text-xs text-slate-600 dark:text-slate-300">{pack.description}</span>
                {pack.playbook_count > 0 ? (
                  <span className="mt-1 block text-[11px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
                    {pack.playbook_count} playbook{pack.playbook_count > 1 ? "s" : ""}
                    {pack.has_memory_seed ? " · mémoire initiale" : ""}
                  </span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
