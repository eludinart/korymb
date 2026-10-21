/** Couleurs pastel stables par projet (id ou titre) — assez marquées pour se distinguer. */

export type ProjectPastel = {
  id: string;
  card: string;
  chip: string;
  heading: string;
};

const PASTELS: ProjectPastel[] = [
  {
    id: "rose",
    card: "border-2 border-rose-300 bg-rose-100 dark:border-rose-700 dark:bg-rose-950/70",
    chip: "bg-rose-200 text-rose-950 dark:bg-rose-800 dark:text-rose-50",
    heading: "text-rose-800 dark:text-rose-200",
  },
  {
    id: "sky",
    card: "border-2 border-sky-300 bg-sky-100 dark:border-sky-700 dark:bg-sky-950/70",
    chip: "bg-sky-200 text-sky-950 dark:bg-sky-800 dark:text-sky-50",
    heading: "text-sky-800 dark:text-sky-200",
  },
  {
    id: "emerald",
    card: "border-2 border-emerald-300 bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950/70",
    chip: "bg-emerald-200 text-emerald-950 dark:bg-emerald-800 dark:text-emerald-50",
    heading: "text-emerald-800 dark:text-emerald-200",
  },
  {
    id: "amber",
    card: "border-2 border-amber-300 bg-amber-100 dark:border-amber-700 dark:bg-amber-950/70",
    chip: "bg-amber-200 text-amber-950 dark:bg-amber-800 dark:text-amber-50",
    heading: "text-amber-900 dark:text-amber-200",
  },
  {
    id: "violet",
    card: "border-2 border-violet-300 bg-violet-100 dark:border-violet-700 dark:bg-violet-950/70",
    chip: "bg-violet-200 text-violet-950 dark:bg-violet-800 dark:text-violet-50",
    heading: "text-violet-800 dark:text-violet-200",
  },
  {
    id: "teal",
    card: "border-2 border-teal-300 bg-teal-100 dark:border-teal-700 dark:bg-teal-950/70",
    chip: "bg-teal-200 text-teal-950 dark:bg-teal-800 dark:text-teal-50",
    heading: "text-teal-800 dark:text-teal-200",
  },
  {
    id: "orange",
    card: "border-2 border-orange-300 bg-orange-100 dark:border-orange-700 dark:bg-orange-950/70",
    chip: "bg-orange-200 text-orange-950 dark:bg-orange-800 dark:text-orange-50",
    heading: "text-orange-900 dark:text-orange-200",
  },
  {
    id: "fuchsia",
    card: "border-2 border-fuchsia-300 bg-fuchsia-100 dark:border-fuchsia-700 dark:bg-fuchsia-950/70",
    chip: "bg-fuchsia-200 text-fuchsia-950 dark:bg-fuchsia-800 dark:text-fuchsia-50",
    heading: "text-fuchsia-800 dark:text-fuchsia-200",
  },
];

export function projectPastel(seed: string | null | undefined): ProjectPastel {
  const raw = String(seed || "").trim() || "projet";
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) {
    hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
  }
  return PASTELS[hash % PASTELS.length];
}
