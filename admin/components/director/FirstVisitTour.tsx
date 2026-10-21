"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const STORAGE_KEY = "korymb_overview_seen";

const STEPS = [
  { href: "/briefing", label: "Aujourd'hui", text: "Ce qui a besoin de vous." },
  { href: "/gestion/contacts", label: "Personnes", text: "Les gens et les organisations." },
  { href: "/gestion/taches", label: "Tâches", text: "Ce qu'il reste à faire." },
  { href: "/gestion/planning", label: "Calendrier", text: "Les rendez-vous." },
  { href: "/aide", label: "Aide", text: "Les mots du logiciel, et signaler un problème." },
] as const;

/** Parcours cliquable, une fois, au premier passage sur Aujourd'hui. */
export default function FirstVisitTour() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      setOpen(window.localStorage.getItem(STORAGE_KEY) !== "1");
    } catch {
      setOpen(true);
    }
  }, []);

  if (!open) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* navigation privée : le parcours se referme pour cette vue */
    }
    setOpen(false);
  };

  return (
    <section className="mb-4 rounded-2xl border border-violet-200 bg-white px-4 py-3 dark:border-violet-800 dark:bg-slate-950">
      <p className="text-sm font-bold text-slate-950 dark:text-slate-50">Tour d&apos;horizon</p>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
        Cinq endroits pour se repérer. Vous pouvez les ouvrir dans l&apos;ordre.
      </p>
      <ol className="mt-3 space-y-2">
        {STEPS.map((step, index) => (
          <li key={step.href}>
            <Link href={step.href} className="text-sm font-bold text-violet-800 underline dark:text-violet-200">
              {index + 1}. {step.label}
            </Link>
            <span className="ml-2 text-sm text-slate-600 dark:text-slate-300">{step.text}</span>
          </li>
        ))}
      </ol>
      <button type="button" className="btn-secondary mt-3" onClick={dismiss}>
        J&apos;ai compris
      </button>
    </section>
  );
}
