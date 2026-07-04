import { redirect } from "next/navigation";

type Props = {
  searchParams?: Promise<{ session?: string }>;
};

/** @deprecated Utiliser /missions?mode=guided */
export default async function MissionGuidedRedirect({ searchParams }: Props) {
  const sp = (await searchParams) ?? {};
  const session = (sp?.session || "").trim();
  const qs = session ? `?mode=guided&session=${encodeURIComponent(session)}` : "?mode=guided";
  redirect(`/missions${qs}`);
}
