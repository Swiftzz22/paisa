import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/auth/session";
import { MOBILE_TOKEN_PREFIX, isMobileToken } from "@/lib/auth/token-kind";

const MOBILE_TOKEN_DAYS = 365;

/**
 * Mint a long-lived token for the native app. A mobile token is just a Session
 * row (revocable — delete it to sign the device out), returned to the user to
 * paste into the app instead of being set as a cookie.
 */
export async function createMobileToken(userId: string): Promise<string> {
  const token = MOBILE_TOKEN_PREFIX + randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + MOBILE_TOKEN_DAYS * 24 * 60 * 60 * 1000);
  await prisma.session.create({ data: { token, userId, expiresAt } });
  return token;
}

/** Resolve the user from an `Authorization: Bearer <token>` header, or null. */
export async function getMobileUser(
  authHeader: string | null
): Promise<SessionUser | null> {
  if (!authHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  const token = match?.[1];
  if (!token) return null;
  // A browser session cookie is not a device credential, even though both are
  // Session rows.
  if (!isMobileToken(token)) return null;

  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    image: session.user.image,
  };
}
