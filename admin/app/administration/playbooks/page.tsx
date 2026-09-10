import { redirect } from "next/navigation";

/** Les playbooks de production vivent dans Gestion. */
export default function AdministrationPlaybooksRedirect() {
  redirect("/gestion/playbooks");
}
