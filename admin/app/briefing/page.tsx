import { cookies } from "next/headers";
import PwaLaunch from "../../components/PwaLaunch";
import { KORYMB_TOKEN_COOKIE } from "../../lib/authSession";
import BriefingScreen from "./BriefingScreen";

export const dynamic = "force-dynamic";

/** Sans cookie : le middleware renvoie vers /. Secours si la page est rendue seule. */
export default async function BriefingPage() {
  const token = (await cookies()).get(KORYMB_TOKEN_COOKIE)?.value?.trim();
  if (!token) return <PwaLaunch assumeLoggedOut />;
  return <BriefingScreen />;
}
