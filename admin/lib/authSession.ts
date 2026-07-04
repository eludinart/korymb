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
};

export type AuthMeResponse = {
  mode?: string;
  user: AuthUser | null;
  workspace: AuthWorkspace | null;
  workspaces?: AuthWorkspace[];
  members?: Array<{ id: string; email: string; display_name?: string; role: string }>;
  role?: string;
};

export function authHeaders(extra: Record<string, string> = {}) {
  return {
    "Content-Type": "application/json",
    ...extra,
  };
}
