import { NextResponse } from "next/server";
import { KORYMB_TOKEN_COOKIE, KORYMB_WORKSPACE_COOKIE } from "../../../../lib/authSession";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(KORYMB_TOKEN_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  response.cookies.set(KORYMB_WORKSPACE_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}
