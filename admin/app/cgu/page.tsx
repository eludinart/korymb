import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Conditions d'utilisation — Korymb",
  description: "Conditions d'utilisation de Korymb (Élude In Art).",
};

export default function CguPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <p className="text-sm font-semibold tracking-wide text-violet-800">
          <Link href="/" className="hover:underline">
            Korymb
          </Link>
          {" · "}Élude In Art
        </p>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-950">
          Conditions d&apos;utilisation
        </h1>
        <p className="mt-2 text-sm text-slate-600">Dernière mise à jour : 9 septembre 2026</p>

        <div className="mt-8 space-y-6 text-[15px] leading-relaxed text-slate-800">
          <p>
            Korymb est un cockpit agentique édité par Élude In Art. L&apos;accès est réservé aux
            comptes autorisés. En utilisant la connexion Google / Gmail, vous acceptez ces conditions
            ainsi que la{" "}
            <Link href="/confidentialite" className="font-semibold text-violet-800 underline">
              politique de confidentialité
            </Link>
            .
          </p>

          <section>
            <h2 className="text-xl font-bold text-slate-950">Objet</h2>
            <p className="mt-2">
              Korymb permet de préparer, valider et envoyer des e-mails, synchroniser des réponses,
              piloter des missions IA, et suivre l&apos;activité commerciale liée à Élude In Art /
              Fleur d&apos;ÅmÔurs.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-950">Responsabilités</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Usage professionnel et conforme à la loi.</li>
              <li>Les envois Gmail restent soumis à validation humaine avant exécution.</li>
              <li>
                Élude In Art s&apos;efforce d&apos;assurer un service fiable, sans garantie
                d&apos;absence d&apos;interruption.
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
              <a className="text-violet-800 underline" href="mailto:eludinart@gmail.com">
                eludinart@gmail.com
              </a>
              {" · "}
              <a className="text-violet-800 underline" href="https://eludein.art">
                eludein.art
              </a>
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
