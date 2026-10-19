import Link from "next/link";

const USES = [
  {
    title: "Le matin, vous savez par où commencer",
    desc: "Qui relancer, quel texte envoyer, quel rendez-vous proposer. Korymb le pose devant vous, déjà rédigé.",
  },
  {
    title: "Les personnes et le planning restent ensemble",
    desc: "Contacts, messages, devis et calendrier vivent dans le même espace. Vous ne reconstituez plus le fil à la main.",
  },
  {
    title: "Votre activité a une page à elle",
    desc: "Les gens que vous accompagnez voient qui vous êtes, les prochaines dates et les offres. Ils demandent à vous rejoindre depuis cette page.",
  },
] as const;

export default function LandingPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 pb-20 pt-10 sm:px-6 sm:pt-16">
      <section className="mx-auto max-w-3xl text-center">
        <p className="text-xs font-extrabold uppercase tracking-widest text-violet-700 dark:text-violet-300">
          Pour faire tourner votre activité
        </p>
        <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-slate-900 dark:text-slate-50 sm:text-5xl">
          Vous dites quoi faire.
          <span className="mt-1 block text-violet-700 dark:text-violet-300">Korymb le prépare. Vous l’envoyez.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-slate-600 dark:text-slate-300">
          Relances, textes, rendez-vous, devis : vous le formulez comme à quelqu’un de confiance.
          Korymb rédige et organise. Rien ne part tant que vous n’avez pas lu et dit oui.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/register"
            className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-violet-700 px-6 py-3 text-sm font-bold text-white hover:bg-violet-800 sm:w-auto"
          >
            Créer mon espace
          </Link>
          <Link
            href="/login"
            className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl border-2 border-violet-200 px-6 py-3 text-sm font-bold text-violet-900 hover:bg-violet-50 dark:border-violet-800 dark:text-violet-100 dark:hover:bg-violet-950 sm:w-auto"
          >
            J’ai déjà un compte
          </Link>
        </div>
      </section>

      <section className="mx-auto mt-14 max-w-xl">
        <p className="text-center text-sm font-bold text-slate-500 dark:text-slate-400">Voici à quoi ressemble une demande</p>
        <div className="mt-4 space-y-3 rounded-3xl border border-violet-200 bg-white p-5 shadow-sm dark:border-violet-900 dark:bg-slate-900 sm:p-6">
          <p className="ml-8 rounded-2xl rounded-br-md bg-violet-700 px-4 py-3 text-sm leading-relaxed text-white">
            Relance les personnes sans nouvelles, et propose jeudi à 14&nbsp;h.
          </p>
          <p className="mr-8 rounded-2xl rounded-bl-md bg-slate-100 px-4 py-3 text-sm leading-relaxed text-slate-800 dark:bg-slate-800 dark:text-slate-100">
            Trois messages sont prêts, avec un créneau jeudi. Ils attendent votre lecture.
          </p>
          <p className="px-1 pt-1 text-sm font-semibold text-violet-800 dark:text-violet-200">
            Vous corrigez un mot s’il le faut. Vous validez. Les messages partent.
          </p>
        </div>
      </section>

      <section className="mt-16">
        <h2 className="text-center text-xl font-extrabold text-slate-900 dark:text-slate-50">Ce que ça change</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {USES.map((item) => (
            <article
              key={item.title}
              className="rounded-3xl border border-slate-200 bg-white p-6 text-left shadow-sm dark:border-slate-700 dark:bg-slate-900"
            >
              <h3 className="text-lg font-extrabold leading-snug text-slate-900 dark:text-slate-50">{item.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{item.desc}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-16 grid gap-4 sm:grid-cols-2">
        <article className="rounded-3xl border-2 border-violet-200 bg-white p-6 text-left shadow-sm dark:border-violet-800 dark:bg-slate-900">
          <p className="text-xs font-extrabold uppercase tracking-widest text-violet-700 dark:text-violet-300">
            C’est mon activité
          </p>
          <h2 className="mt-2 text-2xl font-extrabold text-slate-900 dark:text-slate-50">Ouvrir mon espace</h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            Vous y retrouvez vos personnes, vos messages, votre planning, et l’assistant qui prépare le travail
            du jour. Vous invitez votre équipe quand vous voulez.
          </p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            <Link
              href="/register"
              className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-violet-700 px-5 py-3 text-sm font-bold text-white hover:bg-violet-800"
            >
              Créer mon espace
            </Link>
            <Link
              href="/login"
              className="inline-flex min-h-11 items-center justify-center rounded-2xl border-2 border-violet-200 px-5 py-3 text-sm font-bold text-violet-900 hover:bg-violet-50 dark:border-violet-800 dark:text-violet-100 dark:hover:bg-violet-950"
            >
              Connexion
            </Link>
          </div>
        </article>
        <article className="rounded-3xl border-2 border-emerald-200 bg-white p-6 text-left shadow-sm dark:border-emerald-900 dark:bg-slate-900">
          <p className="text-xs font-extrabold uppercase tracking-widest text-emerald-800 dark:text-emerald-300">
            On m’a envoyé une page
          </p>
          <h2 className="mt-2 text-2xl font-extrabold text-slate-900 dark:text-slate-50">Je viens en tant qu’invité</h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            Cette page présente une activité : qui la tient, les dates, les offres. Vous demandez à la rejoindre,
            puis vous voyez vos rendez-vous dans votre espace.
          </p>
          <p className="mt-6 text-sm text-slate-500 dark:text-slate-400">
            Ouvrez le lien reçu. Il contient <span className="font-semibold">/p/</span> dans l’adresse.
          </p>
        </article>
      </section>
    </div>
  );
}
