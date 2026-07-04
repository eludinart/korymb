import Link from "next/link";

const FEATURES = [
  {
    title: "Missions IA",
    desc: "Lancez des missions guidées par le CIO : analyse, production, livrables structurés.",
  },
  {
    title: "Chat dirigeant",
    desc: "Échangez en direct avec votre copilote pour affiner, décider et exécuter.",
  },
  {
    title: "Espace isolé",
    desc: "Chaque compte dispose de son propre Korymb : données, mémoire et configuration séparées.",
  },
  {
    title: "Équipe",
    desc: "Invitez des collaborateurs en utilisateur ou admin au sein de votre espace.",
  },
] as const;

export default function LandingPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-10 sm:px-6 sm:pt-16">
      <section className="text-center">
        <p className="text-xs font-extrabold uppercase tracking-widest text-violet-700">Cockpit agentique</p>
        <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
          Votre Korymb.
          <span className="block text-violet-700">Votre activité, pilotée par l&apos;IA.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-600">
          Créez un espace en quelques secondes. Missions, briefing, inbox et livrables — prêts à l&apos;emploi dès
          l&apos;inscription.
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/register"
            className="inline-flex min-w-[200px] items-center justify-center rounded-2xl bg-violet-700 px-8 py-4 text-base font-bold text-white shadow-lg transition hover:bg-violet-800"
          >
            Créer mon espace gratuitement
          </Link>
          <Link
            href="/login"
            className="inline-flex min-w-[200px] items-center justify-center rounded-2xl border-2 border-violet-300 bg-white px-8 py-4 text-base font-bold text-violet-900 transition hover:bg-violet-50"
          >
            Se connecter
          </Link>
        </div>
      </section>

      <section className="mt-20 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((f) => (
          <article key={f.title} className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900">{f.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">{f.desc}</p>
          </article>
        ))}
      </section>

      <section className="mt-20 rounded-3xl border-2 border-violet-200 bg-gradient-to-br from-violet-700 to-violet-900 px-6 py-12 text-center text-white shadow-xl sm:px-12">
        <h2 className="text-2xl font-extrabold sm:text-3xl">Prêt en moins d&apos;une minute</h2>
        <p className="mx-auto mt-4 max-w-xl text-violet-100">
          Inscription, espace vierge configuré, playbooks de démarrage et moteur IA opérationnel — sans migration
          manuelle.
        </p>
        <Link
          href="/register"
          className="mt-8 inline-flex rounded-2xl bg-white px-8 py-3.5 text-base font-bold text-violet-900 shadow-md hover:bg-violet-50"
        >
          Démarrer maintenant
        </Link>
      </section>
    </div>
  );
}
