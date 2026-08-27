import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { buildLoginUrl, isLoginConfigured } from "@/lib/auth/google-login";
import { isAllowedReturnUrl } from "@/lib/auth/mobile-login";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/auth/mobile/start?return=<deep-link>
 *
 * Where the app's sign-in button sends the browser. Kicks off the same Google
 * login the website uses, but marks the attempt as coming from the app so the
 * shared callback hands back a one-time code instead of setting a cookie.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const returnUrl = url.searchParams.get("return") ?? "";

  if (!isAllowedReturnUrl(returnUrl)) {
    // Refuse rather than redirect: this parameter decides where a sign-in code
    // gets delivered, so an unrecognised destination is not a near-miss.
    return NextResponse.json(
      { error: "Unrecognised return URL." },
      { status: 400 }
    );
  }
  if (!isLoginConfigured()) {
    return NextResponse.json({ error: "Login is not configured." }, { status: 503 });
  }

  const state = randomBytes(24).toString("hex");
  const jar = await cookies();
  const opts = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  };
  // Distinct from `login_state` so the callback can tell an app sign-in from a
  // browser one and respond in the right shape.
  jar.set("mobile_login_state", state, opts);
  jar.set("mobile_return", returnUrl, opts);

  return NextResponse.redirect(buildLoginUrl(state));
}
