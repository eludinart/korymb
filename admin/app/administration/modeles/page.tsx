import { redirect } from "next/navigation";

/** Ancienne page « Prise de connaissance » : le parcours complet est la science de l'entreprise. */
export default function AdministrationModelesPage() {
  redirect("/administration/contexte");
}
