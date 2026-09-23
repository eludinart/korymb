/** Cookie session utilisateur Korymb (httpOnly, posé par /api/auth/*). */
export const KORYMB_TOKEN_COOKIE = "korymb_token";
export const KORYMB_WORKSPACE_COOKIE = "korymb_workspace_id";

export type AuthUser = {
  id: string;
  email: string;
  display_name?: string;
};

export type AuthWorkspace = {
  id: string;
  name: string;
  slug?: string;
  role?: string;
  public_enabled?: boolean;
  tagline?: string;
  starter_pack_id?: string;
};

export type AuthMeResponse = {
  mode?: string;
  user: AuthUser | null;
  workspace: AuthWorkspace | null;
  workspaces?: AuthWorkspace[];
  members?: Array<{ id: string; email: string; display_name?: string; role: string }>;
  role?: string;
  membership_status?: string;
};

export function accountDisplayName(me: AuthMeResponse | null | undefined): string {
  const name = (me?.user?.display_name || "").trim();
  if (name) return name;
  return (me?.user?.email || "").trim();
}

export function accountFirstName(me: AuthMeResponse | null | undefined): string {
  const full = (me?.user?.display_name || "").trim();
  if (full) return full.split(/\s+/)[0] || full;
  return (me?.user?.email || "").split("@")[0] || "";
}
