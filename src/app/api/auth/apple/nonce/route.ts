import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** How long a sign-in attempt may sit before the nonce goes stale. */
const NONCE_TTL_MS = 10 * 60_000;

/**
 * POST /api/auth/apple/nonce
 *
 * Issues the nonce for a Sign in with Apple attempt.
 *
 * It has to come from the server. Apple echoes the nonce back verbatim on the
 * native flow rather than hashing it, so a nonce the client invented proves
 * nothing — the client could replay its own token together with its own nonce.
 * Only a value this server issued and remembers can rule that out.
 */
export async function POST() {
  const nonce = randomBytes(32).toString("hex");
  await prisma.appleNonce.create({
    data: { nonce, expiresAt: new Date(Date.now() + NONCE_TTL_MS) },
  });

  // Cheap upkeep on a route that already writes; nothing else prunes this.
  prisma.appleNonce
    .deleteMany({ where: { expiresAt: { lt: new Date() } } })
    .catch(() => {});

  return Response.json({ nonce });
}
