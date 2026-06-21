import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCode } from "@/lib/email/google-oauth";
import { saveEmailAccount } from "@/lib/email/account";
import { getCurrentUser } from "@/lib/user";
import { exchangeLoginCode } from "@/lib/auth/google-login";
import { resolveUserForLogin } from "@/lib/auth/users";
import { createSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * Shared Google OAuth callback. Two flows come back here (so only ONE redirect
 * URI needs registering in Google Cloud Console):
 *   - LOGIN — initiated by /api/auth/login, marked by the `login_state` cookie.
 *   - GMAIL CONNECT — initiated by /api/auth/google, marked by `oauth_state`.
 * We branch on whichever state cookie is present.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const cookieStore = await cookies();
  const loginState = cookieStore.get("login_state")?.value;

  // -------- LOGIN flow --------
  if (loginState) {
    cookieStore.delete("login_state");
    const fail = (msg: string) =>
      NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent(msg)}`, url.origin)
      );
    if (error) return fail(`Google declined: ${error}`);
    if (!code || !state) return fail("Missing code or state from Google.");
    if (loginState !== state) return fail("Sign-in state mismatch. Try again.");
    try {
      const identity = await exchangeLoginCode(code);
      const { id: userId } = await resolveUserForLogin(identity);
      await createSession(userId);
      return NextResponse.redirect(new URL("/", url.origin));
    } catch (e) {
      console.error("[login callback] failed:", e);
      return fail(e instanceof Error ? e.message : String(e));
    }
  }

  // -------- GMAIL CONNECT flow --------
  const settingsUrl = new URL("/settings/email", url.origin);

  if (error) {
    settingsUrl.search = new URLSearchParams({
      status: "err",
      error: `Google declined: ${error}`,
    }).toString();
    return NextResponse.redirect(settingsUrl);
  }

  if (!code || !state) {
    settingsUrl.search = new URLSearchParams({
      status: "err",
      error: "Missing code or state from Google.",
    }).toString();
    return NextResponse.redirect(settingsUrl);
  }

  // Verify CSRF state.
  const expected = cookieStore.get("oauth_state")?.value;
  cookieStore.delete("oauth_state");
  if (!expected || expected !== state) {
    settingsUrl.search = new URLSearchParams({
      status: "err",
      error: "OAuth state mismatch. Try connecting again.",
    }).toString();
    return NextResponse.redirect(settingsUrl);
  }

  try {
    const user = await getCurrentUser();
    const tokens = await exchangeCode(code);
    await saveEmailAccount({
      userId: user.id,
      email: tokens.email,
      refreshToken: tokens.refreshToken,
      accessToken: tokens.accessToken,
      expiresAt: tokens.expiresAt,
      scope: tokens.scope,
    });

    settingsUrl.search = new URLSearchParams({
      status: "connected",
      email: tokens.email,
    }).toString();
    return NextResponse.redirect(settingsUrl);
  } catch (e) {
    console.error("[oauth callback] failed:", e);
    const msg = e instanceof Error ? e.message : String(e);
    settingsUrl.search = new URLSearchParams({
      status: "err",
      error: msg.slice(0, 400),
    }).toString();
    return NextResponse.redirect(settingsUrl);
  }
}
