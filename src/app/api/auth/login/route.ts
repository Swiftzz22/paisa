import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { buildLoginUrl, isLoginConfigured } from "@/lib/auth/google-login";
import { safeNext } from "@/lib/auth/next-path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/auth/login — kick off Google sign-in (basic identity scopes). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;
  if (!isLoginConfigured()) {
    return NextResponse.redirect(
      new URL("/login?error=Login+is+not+configured", origin)
    );
  }

  // CSRF: random state echoed back by Google, verified in the callback.
  const state = randomBytes(24).toString("hex");
  const jar = await cookies();
  jar.set("login_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600, // 10 min
  });

  // Carried in a cookie rather than through Google's state, so the value never
  // leaves our own origin.
  const next = safeNext(url.searchParams.get("next"));
  if (next) {
    jar.set("login_next", next, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 600,
    });
  }

  return NextResponse.redirect(buildLoginUrl(state));
}
