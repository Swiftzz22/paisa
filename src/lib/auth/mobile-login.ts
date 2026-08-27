import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";

/**
 * Brokered sign-in for the app.
 *
 * The app cannot talk to Google directly: Expo Go's redirect is an `exp://`
 * URL, which Google refuses to register (a custom scheme must contain a dot,
 * and the loopback option is deprecated for mobile). Expo's old `auth.expo.io`
 * proxy that used to bridge this was withdrawn over a credential-theft
 * vulnerability.
 *
 * So the app opens a browser pointed at *our* server, we run the same Google
 * code flow the website already uses, and we hand the result back to the app
 * over its deep link. Google only ever sees our existing HTTPS callback, so
 * nothing changes in the Google Cloud console — which matters, because editing
 * redirect URIs on that project risks re-triggering review of the
 * `gmail.readonly` scope the whole ingestion pipeline depends on.
 */

/** Two minutes: long enough to hand over, short enough to be worthless later. */
const CODE_TTL_MS = 120_000;

/**
 * Deep links the app may be sent back to.
 *
 * This is an allowlist because the return URL arrives as a query parameter. Any
 * URL accepted here receives a one-time sign-in code, so an open redirect would
 * hand accounts to whoever asked.
 */
export function isAllowedReturnUrl(returnUrl: string): boolean {
  if (!returnUrl) return false;
  // A real build's own scheme.
  if (returnUrl.startsWith("com.saniakothari.paisa://")) return true;
  // Expo Go can only receive exp:// links, and only ever in development.
  if (process.env.NODE_ENV !== "production" && returnUrl.startsWith("exp://")) {
    return true;
  }
  return false;
}

/** Mint a single-use code the app can trade for a bearer token. */
export async function createMobileAuthCode(userId: string): Promise<string> {
  const code = randomBytes(32).toString("hex");
  await prisma.mobileAuthCode.create({
    data: { code, userId, expiresAt: new Date(Date.now() + CODE_TTL_MS) },
  });
  return code;
}

/**
 * Redeem a code, returning the user it belongs to. The row is deleted whether
 * or not it was still valid, so a code can never be used twice.
 */
export async function redeemMobileAuthCode(
  code: string
): Promise<{ userId: string } | null> {
  const row = await prisma.mobileAuthCode.findUnique({ where: { code } });
  await prisma.mobileAuthCode.deleteMany({ where: { code } });
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  return { userId: row.userId };
}

/** Clear expired codes so the table cannot grow unbounded. */
export async function pruneExpiredAuthCodes(): Promise<number> {
  const { count } = await prisma.mobileAuthCode.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return count;
}
