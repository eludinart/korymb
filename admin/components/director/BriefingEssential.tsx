"use client";

import Link from "next/link";
import { DIRECTOR_QUEUE_HREF, DIRECTOR_QUEUE_SUBTITLE } from "../../lib/directorQueue";
import { missionTitleLabel } from "../../lib/missionLabel";
import { starterPackLabel } from "../../lib/starterPacks";
import { SectionCard } from "../ui/PageChrome";

type DecisionItem = {
  id?: string;
  kind?: string;
  title?: string;
  mission?: string;
  href?: string;
};

type RunningMission = {
  job_id: string;
  mission?: string;
};

type Props = {
  userName?: string;
  showWelcome: boolean;
  packId?: string | null;
  decisions: DecisionItem[];
  inboxTotal: number;
  missionsRunning: RunningMission[];
  onDismissWelcome?: () => void;
};

const ONBOARDING_STEPS = [
  {
    n: 1,
    title: "Présenter votre activité",
    hint: "Quelques lignes dans la mémoire partagée guident les agents.",
    href: "/administration/memory",
    cta: "Ouvrir la mémoire",
  },
  {
    n: 2,
    title: "Lancer un playbook",
    hint: "Scénario prêt à l’emploi — résultat à valider ensuite.",
    href: "/gestion/playbooks",
    cta: "Voir les playbooks",
  },
  {
    n: 3,
    title: "Configurer la page publique",
    hint: "Vitrine /p/… pour vos participants.",
    href: "/administration/vitrine",
    cta: "Ouvrir la vitrine",
  },
] as const;

export default function BriefingEssential({
  userName,
  showWelcome,
  packId,
  decisions,
  inboxTotal,
  missionsRunning,
}: Props) {
  const greet = userName ? `Bonjour ${userName}` : "Bonjour";
  const topDecisions = decisions.slice(0, 5);

  return (
    <div className="space-y-6">
      <header className="rounded-2xl border border-violet-100 bg-gradient-to-br from-violet-50 to-white px-4 py-5 sm:px-6">
        <p className="text-xs font-extrabold uppercase tracking-wider text-violet-700">Accueil</p>
        <h1 className="mt-1 text-2xl font-extrabold text-slate-900">{greet}</h1>
        <p className="mt-1 text-sm text-slate-600">
          Quatre priorités : valider, suivre, lancer, personnaliser. Mode Essentiel — basculez en Avancé dans
          Configuration si besoin.
        </p>
      </header>

      {showWelcome ? (
        <section className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 px-4 py-4 sm:px-6">
          <p className="text-sm font-bold text-emerald-900">Premiers pas</p>
          <p className="mt-1 text-sm text-emerald-800">
            {packId && packId !== "blank" ? (
              <>
                Le modèle <strong>{starterPackLabel(packId)}</strong> a préparé des playbooks. Enchaînez ces 3
                étapes :
              </>
            ) : (
              <>Espace prêt. Enchaînez ces 3 étapes pour le spécialiser :</>
            )}
          </p>
          <ol className="mt-4 space-y-3">
            {ONBOARDING_STEPS.map((step) => (
              <li
                key={step.n}
                className="flex flex-col gap-2 rounded-xl border border-emerald-200 bg-white/80 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-900">
                    <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-700 text-xs text-white">
                      {step.n}
                    </span>
                    {step.title}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">{step.hint}</p>
                </div>
                <Link href={step.href} className="btn-link-primary shrink-0 text-sm">
                  {step.cta} →
                </Link>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <SectionCard title="À relire et valider" description={DIRECTOR_QUEUE_SUBTITLE}>
        {topDecisions.length === 0 ? (
          <p className="text-sm text-slate-600">Rien en attente. Vous êtes à jour.</p>
        ) : (
          <ul className="space-y-2">
            {topDecisions.map((item, idx) => (
              <li key={item.id || `${item.kind}-${idx}`}>
                <Link
                  href={item.href || DIRECTOR_QUEUE_HREF}
                  className="flex items-start justify-between gap-3 rounded-xl border border-amber-100 bg-amber-50/60 px-3 py-2.5 hover:border-amber-300"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-bold text-slate-900">
                      {item.title || item.mission || "Décision"}
                    </span>
                    {item.mission && item.title ? (
                      <span className="mt-0.5 block text-xs text-slate-600">
                        {missionTitleLabel(item.mission, 80)}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-xs font-bold text-amber-800">Ouvrir →</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {inboxTotal > topDecisions.length ? (
          <p className="mt-3 text-sm">
            <Link href={DIRECTOR_QUEUE_HREF} className="font-bold text-violet-700 hover:underline">
              Voir toutes les décisions ({inboxTotal}) →
            </Link>
          </p>
        ) : (
          <p className="mt-3 text-sm">
            <Link href={DIRECTOR_QUEUE_HREF} className="font-semibold text-violet-700 hover:underline">
              Ouvrir Décisions →
            </Link>
          </p>
        )}
      </SectionCard>

      <SectionCard title="En cours" description="Traitements et missions actives">
        {missionsRunning.length === 0 ? (
          <p className="text-sm text-slate-600">Aucun traitement en cours.</p>
        ) : (
          <ul className="space-y-2">
            {missionsRunning.slice(0, 6).map((m) => (
              <li key={m.job_id}>
                <Link
                  href={`/missions?job=${encodeURIComponent(m.job_id)}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 hover:border-violet-300"
                >
                  <span className="min-w-0 text-sm font-bold text-slate-900">
                    {missionTitleLabel(m.mission, 90) || m.job_id}
                  </span>
                  <span className="shrink-0 text-xs font-bold text-violet-700">Suivre →</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-sm">
          <Link href="/missions" className="font-semibold text-violet-700 hover:underline">
            Toutes les missions →
          </Link>
        </p>
      </SectionCard>

      <SectionCard title="Démarrer" description="Playbooks et actions rapides">
        <div className="flex flex-wrap gap-2">
          <Link
            href="/gestion/playbooks"
            className="rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-violet-800"
          >
            Lancer un playbook
          </Link>
          <Link
            href="/mission/nouvelle"
            className="rounded-xl border-2 border-violet-700 px-4 py-2.5 text-sm font-bold text-violet-800"
          >
            Nouvelle mission
          </Link>
          <Link
            href="/chat"
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-800 hover:bg-slate-50"
          >
            Ouvrir le chat
          </Link>
        </div>
      </SectionCard>
    </div>
  );
}
