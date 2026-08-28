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

/**
 * Codes are namespaced so one purpose's code cannot be spent on another — a
 * sign-in code must never be usable as a Gmail-connect ticket, or vice versa.
 */
const PREFIX = { signin: "si_", connect: "gc_" } as const;
type Purpose = keyof typeof PREFIX;

/** Mint a single-use code the app can trade for a bearer token. */
export async function createMobileAuthCode(userId: string): Promise<string> {
  return mintCode(userId, "signin");
}

/**
 * Ticket proving which signed-in user is about to connect Gmail.
 *
 * The connect flow runs in a browser, which carries no bearer token, and
 * putting the token in the URL would leak it into logs. So the app trades its
 * token for this short-lived ticket over HTTPS and passes only the ticket.
 */
export async function createGmailConnectTicket(userId: string): Promise<string> {
  return mintCode(userId, "connect");
}

async function mintCode(userId: string, purpose: Purpose): Promise<string> {
  const code = PREFIX[purpose] + randomBytes(32).toString("hex");
  await prisma.mobileAuthCode.create({
    data: { code, userId, expiresAt: new Date(Date.now() + CODE_TTL_MS) },
  });
  return code;
}

/** Redeem a Gmail-connect ticket. Single use, like every code here. */
export async function redeemGmailConnectTicket(
  ticket: string
): Promise<{ userId: string } | null> {
  return redeem(ticket, "connect");
}

/** Redeem a sign-in code for the bearer-token exchange. */
export async function redeemMobileAuthCode(
  code: string
): Promise<{ userId: string } | null> {
  return redeem(code, "signin");
}

/**
 * Look up a code, delete it whether or not it was usable, and return its user.
 *
 * Deleting unconditionally is what makes a code single-use: a failed attempt
 * must not leave it spendable. The purpose check is what stops a ticket minted
 * for one flow being presented to another.
 */
async function redeem(
  code: string,
  purpose: Purpose
): Promise<{ userId: string } | null> {
  const row = await prisma.mobileAuthCode.findUnique({ where: { code } });
  await prisma.mobileAuthCode.deleteMany({ where: { code } });
  if (!row) return null;
  if (!code.startsWith(PREFIX[purpose])) return null;
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
