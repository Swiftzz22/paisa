import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { buildAuthUrl, isGoogleConfigured } from "@/lib/email/google-oauth";
import {
  isAllowedReturnUrl,
  redeemGmailConnectTicket,
} from "@/lib/auth/mobile-login";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/auth/google/connect-start?ticket=…&return=<deep-link>
 *
 * Starts the Gmail consent flow from inside the app.
 *
 * The web version relies on a session cookie to know who is connecting; a
 * browser opened from the app has none. The ticket carries that identity
 * instead, and is stashed in an httpOnly cookie for the shared callback.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const ticket = url.searchParams.get("ticket") ?? "";
  const returnUrl = url.searchParams.get("return") ?? "";

  if (!isAllowedReturnUrl(returnUrl)) {
    return NextResponse.json({ error: "Unrecognised return URL." }, { status: 400 });
  }
  if (!isGoogleConfigured()) {
    return NextResponse.json({ error: "Google is not configured." }, { status: 503 });
  }

  const redeemed = await redeemGmailConnectTicket(ticket);
  if (!redeemed) {
    return NextResponse.redirect(
      `${returnUrl}?error=${encodeURIComponent("That link expired. Try again from the app.")}`
    );
  }

  const state = randomBytes(32).toString("hex");
  const jar = await cookies();
  const opts = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  };
  // Distinct from `oauth_state` so the callback can tell an in-app connect from
  // one started on the website and return to the right place.
  jar.set("mobile_connect_state", state, opts);
  jar.set("mobile_connect_user", redeemed.userId, opts);
  jar.set("mobile_connect_return", returnUrl, opts);

  return NextResponse.redirect(buildAuthUrl(state));
}
