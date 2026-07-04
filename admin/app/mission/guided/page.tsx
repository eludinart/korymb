import { redirect } from "next/navigation";

type Props = {
  searchParams?: Promise<{ session?: string }> | { session?: string };
};

/** @deprecated Utiliser /missions?mode=guided */
export default async function MissionGuidedRedirect({ searchParams }: Props) {
  const sp = searchParams instanceof Promise ? await searchParams : searchParams;
  const session = (sp?.session || "").trim();
  const qs = session ? `?mode=guided&session=${encodeURIComponent(session)}` : "?mode=guided";
  redirect(`/missions${qs}`);
}
