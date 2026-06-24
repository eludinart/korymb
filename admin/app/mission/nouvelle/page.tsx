import { redirect } from "next/navigation";

/** @deprecated Utiliser /missions?create=quick */
export default function MissionNouvellePage() {
  redirect("/missions?create=quick");
}
