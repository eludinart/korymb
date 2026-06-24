import { redirect } from "next/navigation";

/** @deprecated Utiliser /administration/historique */
export default function HistoriquePage() {
  redirect("/administration/historique");
}
