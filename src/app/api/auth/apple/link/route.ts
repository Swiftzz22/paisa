import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getMobileUser } from "@/lib/auth/mobile";
import {
  exchangeAppleCode,
  verifyAppleIdentityToken,
} from "@/lib/auth/apple-login";
import { linkAppleToUser } from "@/lib/auth/apple-users";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({
  identityToken: z.string().min(20).max(8000),
  authorizationCode: z.string().min(5).max(2000).optional(),
  nonce: z.string().min(16).max(200),
});

/**
 * POST /api/auth/apple/link — attach an Apple ID to the account already signed in.
 *
 * The safe half of linking, and the piece that was missing. Signing in with
 * Apple deliberately never joins itself to an existing account: Apple's relay
 * addresses match nothing, and a shared real address would let whoever holds
 * that Apple ID walk into someone else's data. So the only correct way to join
 * the two is from inside the account, which is what this is — the bearer token
 * proves the account, the identity token proves the Apple ID, and consent is
 * the act of tapping the button.
 *
 * Without it the safe branch was the only branch, and anyone who signed in with
 * Apple simply landed in a new, empty app with no way back to their data.
 */
export async function POST(req: NextRequest) {
  const user = await getMobileUser(req.headers.get("authorization"));
  if (!user) {
    return Response.json({ error: "Please sign in first." }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Bad request." }, { status: 400 });
  }
  const { identityToken, authorizationCode, nonce } = parsed.data;

  // Consume the nonce whether or not the rest succeeds, exactly as sign-in
  // does — one that survived a failed attempt could be replayed.
  const row = await prisma.appleNonce.findUnique({ where: { nonce } });
  await prisma.appleNonce.deleteMany({ where: { nonce } });
  if (!row || row.expiresAt.getTime() < Date.now()) {
    return Response.json(
      { error: "That took too long. Please try again." },
      { status: 401 }
    );
  }

  let identity;
  try {
    identity = await verifyAppleIdentityToken(identityToken, nonce);
  } catch {
    return Response.json({ error: "Apple couldn't be verified." }, { status: 401 });
  }

  // Best effort, same as sign-in: the code is single-use and short-lived, so a
  // refresh token has to be obtained now or never. Without one there is nothing
  // to revoke at deletion time, which is a requirement rather than a nicety.
  let refreshToken: string | null = null;
  if (authorizationCode) {
    try {
      refreshToken = await exchangeAppleCode(authorizationCode);
    } catch (e) {
      console.error("[apple link] code exchange failed:", e);
    }
  }

  const result = await linkAppleToUser(user.id, identity, refreshToken);
  if (!result.ok) {
    return Response.json({ error: result.reason }, { status: 409 });
  }
  return Response.json({ ok: true });
}
