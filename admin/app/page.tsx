import Link from "next/link";

const STEPS = [
  { title: "Catalogue", desc: "Offres, dates et ressources — ce que vous proposez, clairement." },
  { title: "Parcours", desc: "Rendez-vous (atelier, visio) et contenus à ouvrir (vidéo, podcast, documents) sur le même calendrier." },
  { title: "Calendrier", desc: "Capacité, inscriptions, ce qui est public, nominatif, ou pour les inscrits." },
  { title: "HITL", desc: "L’IA prépare ; vous validez. Rien ne part sans vous." },
] as const;

export default function LandingPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-10 sm:px-6 sm:pt-16">
      <section className="text-center">
        <p className="text-xs font-extrabold uppercase tracking-widest text-violet-700">Outil de gestion</p>
        <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
          Korymb, pour accompagner
          <span className="block text-violet-700">et livrer sur le même fil.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-600">
          Un espace de pilotage pour votre activité — et une page publique pour les personnes que vous accompagnez.
          Ce n’est pas un compte participant.
        </p>
      </section>

      <section className="mt-12 grid gap-4 sm:grid-cols-2">
        <article className="rounded-3xl border-2 border-violet-200 bg-white p-6 text-left shadow-sm">
          <p className="text-xs font-extrabold uppercase tracking-widest text-violet-700">Je pilote une activité</p>
          <h2 className="mt-2 text-2xl font-extrabold text-slate-900">Créer un espace Korymb</h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            Missions, planning, CRM, vitrine et espace inscrits. L’IA prépare ; vous restez aux commandes.
          </p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            <Link href="/register" className="inline-flex justify-center rounded-2xl bg-violet-700 px-5 py-3 text-sm font-bold text-white hover:bg-violet-800">
              Créer un espace
            </Link>
            <Link href="/login" className="inline-flex justify-center rounded-2xl border-2 border-violet-200 px-5 py-3 text-sm font-bold text-violet-900 hover:bg-violet-50">
              Connexion
            </Link>
          </div>
        </article>
        <article className="rounded-3xl border-2 border-emerald-200 bg-white p-6 text-left shadow-sm">
          <p className="text-xs font-extrabold uppercase tracking-widest text-emerald-800">Je suis accompagné</p>
          <h2 className="mt-2 text-2xl font-extrabold text-slate-900">Rejoindre votre espace</h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            Vous avez reçu un lien vers une page publique (atelier, stage, parcours). Ouvrez-le pour créer votre
            compte participant — pas un compte Korymb.
          </p>
          <p className="mt-6 text-sm text-slate-500">Utilisez le lien envoyé par votre accompagnant. Il ressemble à une adresse /p/…</p>
        </article>
      </section>

      <section className="mt-16">
        <h2 className="text-center text-xl font-extrabold text-slate-900">Le fil, côté dirigeant</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <article key={s.title} className="rounded-2xl border border-slate-200 bg-white p-5">
              <h3 className="font-bold text-slate-900">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{s.desc}</p>
            </article>
          ))}
        </div>
        <p className="mx-auto mt-6 max-w-xl text-center text-sm text-slate-500">
          Les missions IA et le chat dirigeant viennent ensuite : c’est le moteur, pas l’entrée.
        </p>
      </section>
    </div>
  );
}
