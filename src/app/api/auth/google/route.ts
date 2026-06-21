import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { buildAuthUrl, isGoogleConfigured } from "@/lib/email/google-oauth";

export const dynamic = "force-dynamic";

/** GET /api/auth/google — kicks off the Google OAuth consent flow. */
export async function GET() {
  if (!isGoogleConfigured()) {
    return NextResponse.redirect(
      new URL("/settings/email?status=err&error=Google+OAuth+not+configured.+See+README.", "http://localhost:3000")
    );
  }

  // CSRF: random state, persisted in an httpOnly cookie. The callback verifies match.
  const state = randomBytes(32).toString("hex");
  const cookieStore = await cookies();
  cookieStore.set("oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60, // 10 min
  });

  return NextResponse.redirect(buildAuthUrl(state));
}
