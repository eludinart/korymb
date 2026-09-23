import Link from "next/link";

const STEPS = [
  { title: "Page publique", desc: "Ce que vous proposez, clairement." },
  { title: "Calendrier", desc: "Rendez-vous et contenus à partager, au même endroit." },
  { title: "Accès", desc: "Interne, nommé, ouvert aux inscrits, ou public." },
  { title: "Validation", desc: "L’assistant prépare. Vous validez. Rien ne part sans vous." },
] as const;

export default function LandingPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-10 sm:px-6 sm:pt-16">
      <section className="text-center">
        <p className="text-xs font-extrabold uppercase tracking-widest text-violet-700">Outil de gestion</p>
        <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
          Korymb, votre activité
          <span className="block text-violet-700">et vos livraisons, sur le même fil.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-600">
          Un espace pour votre activité, et une page publique pour les personnes inscrites.
        </p>
      </section>

      <section className="mt-12 grid gap-4 sm:grid-cols-2">
        <article className="rounded-3xl border-2 border-violet-200 bg-white p-6 text-left shadow-sm">
          <p className="text-xs font-extrabold uppercase tracking-widest text-violet-700">Je pilote une activité</p>
          <h2 className="mt-2 text-2xl font-extrabold text-slate-900">Créer un espace Korymb</h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            Personnes, calendrier, messages et page publique. L’assistant prépare ; vous validez.
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
          <p className="text-xs font-extrabold uppercase tracking-widest text-emerald-800">J&apos;ai reçu un lien</p>
          <h2 className="mt-2 text-2xl font-extrabold text-slate-900">Rejoindre votre espace</h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            Vous avez reçu un lien vers une page publique. Ouvrez-le pour ouvrir votre espace : rendez-vous et
            ressources.
          </p>
          <p className="mt-6 text-sm text-slate-500">Utilisez le lien reçu. Il ressemble à une adresse /p/…</p>
        </article>
      </section>

      <section className="mt-16">
        <h2 className="text-center text-xl font-extrabold text-slate-900">Le fil de l&apos;activité</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <article key={s.title} className="rounded-2xl border border-slate-200 bg-white p-5">
              <h3 className="font-bold text-slate-900">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{s.desc}</p>
            </article>
          ))}
        </div>
        <p className="mx-auto mt-6 max-w-xl text-center text-sm text-slate-500">
          Une demande en français vient ensuite : l’assistant prépare, vous validez.
        </p>
      </section>
    </div>
  );
}
