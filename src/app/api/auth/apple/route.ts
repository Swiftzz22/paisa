import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createMobileToken } from "@/lib/auth/mobile";
import {
  exchangeAppleCode,
  verifyAppleIdentityToken,
} from "@/lib/auth/apple-login";
import { resolveUserForAppleLogin } from "@/lib/auth/apple-users";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({
  identityToken: z.string().min(20).max(8000),
  /** Traded for a refresh token now — it is single-use and expires in 5 minutes. */
  authorizationCode: z.string().min(5).max(2000).optional(),
  nonce: z.string().min(16).max(200),
  /**
   * Apple sends the name only on the very first authorization, and it comes
   * from the device rather than from Apple — so it is unauthenticated, and
   * sanitised before storage.
   */
  fullName: z.string().max(200).optional(),
});

/**
 * POST /api/auth/apple — sign in with Apple from the app.
 *
 * Verifies the identity token against Apple's keys, consumes the nonce this
 * server issued, resolves or creates the user, and returns a bearer token in
 * the same shape as the Google flow.
 */
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Bad request." }, { status: 400 });
  }
  const { identityToken, authorizationCode, nonce, fullName } = parsed.data;

  // Consume the nonce first, whether or not the rest succeeds — a nonce that
  // survives a failed attempt could be reused.
  const row = await prisma.appleNonce.findUnique({ where: { nonce } });
  await prisma.appleNonce.deleteMany({ where: { nonce } });
  if (!row || row.expiresAt.getTime() < Date.now()) {
    return Response.json(
      { error: "That sign-in attempt expired. Please try again." },
      { status: 401 }
    );
  }

  let identity;
  try {
    identity = await verifyAppleIdentityToken(identityToken, nonce);
  } catch (e) {
    console.error("[apple sign-in] token rejected:", e);
    return Response.json({ error: "Apple sign-in failed." }, { status: 401 });
  }

  // Best effort: without Apple server credentials there is no refresh token,
  // and sign-in should still work. Deletion falls back to asking the user to
  // revoke in iOS Settings.
  let refreshToken: string | null = null;
  if (authorizationCode) {
    try {
      refreshToken = await exchangeAppleCode(authorizationCode);
    } catch (e) {
      console.error("[apple sign-in] code exchange failed:", e);
    }
  }

  try {
    const { id } = await resolveUserForAppleLogin(identity, fullName, refreshToken);
    return Response.json({ token: await createMobileToken(id) });
  } catch (e) {
    console.error("[apple sign-in] user resolution failed:", e);
    return Response.json({ error: "Couldn't sign you in." }, { status: 500 });
  }
}
