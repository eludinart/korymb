import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Politique de confidentialité — Korymb",
  description:
    "Politique de confidentialité de la plateforme Korymb : données Gmail/OAuth, CRM, finalités et droits.",
};

export default function ConfidentialitePage() {
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
          Politique de confidentialité
        </h1>
        <p className="mt-2 text-sm text-slate-600">Dernière mise à jour : 11 septembre 2026</p>

        <div className="prose prose-slate mt-8 max-w-none space-y-6 text-[15px] leading-relaxed">
          <p>
            La présente politique décrit comment <strong>l&apos;éditeur de la plateforme Korymb</strong>{" "}
            collecte et utilise des données personnelles dans le cadre du logiciel multi-espaces{" "}
            <strong>Korymb</strong> (administration, agents IA, CRM, intégrations). Chaque workspace
            (locataire) peut en outre publier sa propre notice pour sa vitrine ou son espace
            participants.
          </p>

          <section>
            <h2 className="text-xl font-bold text-slate-950">1. Responsable du traitement</h2>
            <p>
              Pour le fonctionnement de la plateforme logicielle : l&apos;éditeur de la plateforme
              Korymb.
              <br />
              Contact : support via l&apos;espace connecté (administration Korymb).
              <br />
              Les traitements propres à l&apos;activité d&apos;un workspace (prospection, clients,
              contenus de vitrine) relèvent en principe du responsable désigné pour cet espace.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-950">2. Données collectées</h2>
            <p>Selon l&apos;usage de Korymb et de la connexion Google / Gmail, nous pouvons traiter :</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Identifiants de compte Google (adresse e-mail du compte connecté).</li>
              <li>Jetons d&apos;accès techniques OAuth nécessaires aux API Google (Gmail, éventuellement Drive/Agenda).</li>
              <li>
                Contenu et métadonnées d&apos;e-mails envoyés ou synchronisés (destinataires, objet, corps,
                dates, identifiants de message / fil).
              </li>
              <li>Données CRM : contacts, notes, suggestions d&apos;approche, historiques d&apos;interactions, relances.</li>
              <li>
                Données d&apos;usage applicatif : missions, briefing, décisions, livrables, journaux techniques
                (horodatage, statut d&apos;envoi, erreurs).
              </li>
              <li>Données de compte Korymb (e-mail, espace de travail, rôles collaborateurs).</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-950">3. Finalités du traitement</h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>Préparer et envoyer des e-mails professionnels après validation humaine (HITL).</li>
              <li>Synchroniser les réponses reçues pour le suivi commercial et opérationnel.</li>
              <li>Tenir un historique relationnel (CRM) utile à l&apos;activité de l&apos;espace connecté.</li>
              <li>Orchestrer missions, agents et livrables dans le cockpit Korymb.</li>
              <li>Assurer le fonctionnement, la sécurité, le diagnostic et l&apos;amélioration du service.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-950">4. Base légale</h2>
            <p>
              Traitement fondé sur l&apos;intérêt légitime de l&apos;éditeur à faire fonctionner Korymb
              et/ou sur l&apos;exécution de démarches initiées avec les contacts concernés, dans le
              respect de la réglementation applicable (notamment RGPD).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-950">5. Destinataires</h2>
            <p>
              Les données sont accessibles aux personnes autorisées de l&apos;espace Korymb concerné
              (opérateurs et collaborateurs invités). Elles peuvent être traitées par des
              sous-traitants techniques nécessaires au service, notamment Google (Gmail / OAuth) et
              l&apos;hébergeur de l&apos;infrastructure. Aucune vente de données personnelles à des tiers.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-950">6. Transferts hors UE</h2>
            <p>
              L&apos;usage de services Google peut entraîner un traitement hors Union européenne selon les
              conditions de Google. Des garanties contractuelles ou mécanismes prévus par Google peuvent
              s&apos;appliquer.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-950">7. Durée de conservation</h2>
            <p>
              Les données sont conservées pendant la durée nécessaire aux finalités ci-dessus, puis
              supprimées ou archivées selon les besoins opérationnels et obligations légales. Les jetons
              OAuth peuvent être révoqués à tout moment ; les accès Gmail cessent alors pour Korymb.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-950">8. Sécurité</h2>
            <p>
              Nous mettons en œuvre des mesures raisonnables : accès restreint, secrets non publics,
              validation humaine avant envoi d&apos;e-mails, journalisation technique. Aucune mesure ne
              garantit une sécurité absolue.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-950">9. Vos droits</h2>
            <p>
              Conformément au RGPD, vous pouvez demander l&apos;accès, la rectification, l&apos;effacement,
              la limitation, l&apos;opposition, ou la portabilité lorsque applicable, via le support de
              l&apos;espace connecté. Vous pouvez aussi introduire une réclamation auprès de la CNIL (
              <a className="text-violet-800 underline" href="https://www.cnil.fr">
                cnil.fr
              </a>
              ).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-950">10. Révocation de l&apos;accès Google</h2>
            <p>
              Vous pouvez retirer l&apos;autorisation accordée à Korymb à tout moment via{" "}
              <a
                className="text-violet-800 underline"
                href="https://myaccount.google.com/permissions"
              >
                https://myaccount.google.com/permissions
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-950">11. Contact</h2>
            <p>
              Pour toute question relative à cette politique : support via l&apos;espace connecté
              (administration Korymb).
            </p>
          </section>
        </div>

        <p className="mt-10 text-sm text-slate-600">
          Voir aussi :{" "}
          <Link href="/cgu" className="font-semibold text-violet-800 underline">
            Conditions d&apos;utilisation
          </Link>
        </p>
      </div>
    </main>
  );
}
