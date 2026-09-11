import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Conditions d'utilisation — Korymb",
  description: "Conditions d'utilisation de la plateforme Korymb.",
};

export default function CguPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <p className="text-sm font-semibold tracking-wide text-violet-800">
          <Link href="/" className="hover:underline">
            Korymb
          </Link>
          {" · "}Plateforme multi-espaces
        </p>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-950">
          Conditions d&apos;utilisation
        </h1>
        <p className="mt-2 text-sm text-slate-600">Dernière mise à jour : 11 septembre 2026</p>

        <div className="mt-8 space-y-6 text-[15px] leading-relaxed text-slate-800">
          <p>
            Korymb est un logiciel de pilotage d&apos;activité (cockpit agentique) édité par{" "}
            <strong>l&apos;éditeur de la plateforme Korymb</strong>. L&apos;accès à l&apos;espace
            d&apos;administration est réservé aux comptes autorisés. En utilisant la connexion Google /
            Gmail, vous acceptez ces conditions ainsi que la{" "}
            <Link href="/confidentialite" className="font-semibold text-violet-800 underline">
              politique de confidentialité
            </Link>
            .
          </p>
          <p>
            Les vitrines et espaces participants rattachés à un workspace (locataire) peuvent disposer
            de leurs propres mentions légales ou conditions spécifiques, distinctes de celles de la
            plateforme.
          </p>

          <section>
            <h2 className="text-xl font-bold text-slate-950">Objet</h2>
            <p className="mt-2">
              Korymb permet de préparer, valider et envoyer des e-mails, synchroniser des réponses,
              piloter des missions IA, et suivre l&apos;activité commerciale et opérationnelle d&apos;un
              espace de travail.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-950">Responsabilités</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Usage professionnel et conforme à la loi.</li>
              <li>Les envois Gmail restent soumis à validation humaine avant exécution.</li>
              <li>
                L&apos;éditeur de la plateforme Korymb s&apos;efforce d&apos;assurer un service fiable,
                sans garantie d&apos;absence d&apos;interruption.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-950">Compte Google</h2>
            <p className="mt-2">
              L&apos;autorisation OAuth donne à Korymb un accès limité Gmail (envoi / lecture) pour le
              compte connecté. Vous pouvez révoquer cet accès à tout moment dans les paramètres de
              sécurité de votre compte Google.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-950">Contact</h2>
            <p className="mt-2">
              Pour toute question relative à ces conditions : support via l&apos;espace connecté
              (administration Korymb).
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
