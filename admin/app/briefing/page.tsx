import { cookies } from "next/headers";
import PwaLaunch from "../../components/PwaLaunch";
import { KORYMB_TOKEN_COOKIE } from "../../lib/authSession";
import BriefingScreen from "./BriefingScreen";

export const dynamic = "force-dynamic";

/** Sans cookie : 200 + écran d'ouverture. Une 307 vers /login bloque le splash sur téléphone. */
export default async function BriefingPage() {
  const token = (await cookies()).get(KORYMB_TOKEN_COOKIE)?.value?.trim();
  if (!token) return <PwaLaunch assumeLoggedOut />;
  return <BriefingScreen />;
}
