import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { forwardingConfirmationCode } from "@/lib/email/classify";

/**
 * Per-user forwarding addresses.
 *
 * Instead of holding Gmail access, the app gives each user a private address
 * and they set one Gmail filter pointing bank alerts at it. Mail arrives here
 * and is ingested exactly as before — but the app never holds a credential for
 * anyone's mailbox, which is what keeps it out of Google's restricted-scope
 * regime entirely.
 *
 * The key is random rather than derived from the user id: an address is
 * effectively a write capability for someone's ledger, so it must not be
 * guessable from anything public, and it must be replaceable without touching
 * the account it belongs to.
 */

/** Host that accepts forwarded mail, e.g. "in.paisa.app". */
export function inboundDomain(): string | null {
  return process.env.INBOUND_EMAIL_DOMAIN ?? null;
}

/** 16 lowercase base32-ish chars: unguessable, and safe to read aloud. */
function mintKey(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789"; // no look-alikes
  const bytes = randomBytes(16);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

/**
 * This user's forwarding address, minting the key on first use.
 * Returns null when no inbound domain is configured.
 */
export async function getInboundAddress(userId: string): Promise<string | null> {
  const domain = inboundDomain();
  if (!domain) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { inboundKey: true },
  });
  if (!user) return null;

  let key = user.inboundKey;
  if (!key) {
    // Retry on the vanishingly unlikely collision with the unique index.
    for (let attempt = 0; attempt < 5 && !key; attempt++) {
      const candidate = mintKey();
      try {
        await prisma.user.update({
          where: { id: userId },
          data: { inboundKey: candidate },
        });
        key = candidate;
      } catch {
        // Taken — try another.
      }
    }
    if (!key) return null;
  }
  return `${key}@${domain}`;
}

/** Replace the key, invalidating the old address. */
export async function rotateInboundAddress(
  userId: string
): Promise<string | null> {
  const domain = inboundDomain();
  if (!domain) return null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = mintKey();
    try {
      await prisma.user.update({
        where: { id: userId },
        data: { inboundKey: candidate },
      });
      return `${candidate}@${domain}`;
    } catch {
      // Taken — try another.
    }
  }
  return null;
}

/** Resolve a recipient address back to its user, or null. */
export async function userForInboundAddress(
  recipient: string
): Promise<{ id: string } | null> {
  const domain = inboundDomain();
  if (!domain) return null;

  const cleaned = recipient.trim().toLowerCase();
  // Accept "Name <key@domain>" as well as a bare address.
  const angled = /<([^>]+)>/.exec(cleaned);
  const address = (angled?.[1] ?? cleaned).trim();

  const [key, host] = address.split("@");
  if (!key || host !== domain.toLowerCase()) return null;

  return prisma.user.findUnique({
    where: { inboundKey: key },
    select: { id: true },
  });
}

/**
 * Whether forwarding is actually delivering, and what is still needed.
 *
 * Without this the only way to know a filter works is to ask someone to query
 * the database — which is how the first real alert was found, and is not a
 * thing anyone else can do. A setup that cannot tell you it is working is one
 * people abandon while it is working.
 */
export type ForwardingStatus = {
  /** Gmail's confirmation code, while one is waiting to be used. */
  pendingCode: string | null;
  lastReceivedAt: Date | null;
  /** Stored in the last seven days — the sign that a filter is live. */
  recentCount: number;
};

export async function getForwardingStatus(
  userId: string
): Promise<ForwardingStatus> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [notice, last, recentCount] = await Promise.all([
    prisma.receivedEmail.findFirst({
      where: { userId, parseStatus: "notice" },
      orderBy: { receivedAt: "desc" },
      select: { subject: true, bodyText: true },
    }),
    // Notices are Google talking about the setup, not a bank alert — counting
    // them as delivery would report success before anything has been forwarded.
    prisma.receivedEmail.findFirst({
      where: { userId, parseStatus: { not: "notice" } },
      orderBy: { receivedAt: "desc" },
      select: { receivedAt: true },
    }),
    prisma.receivedEmail.count({
      where: {
        userId,
        parseStatus: { not: "notice" },
        receivedAt: { gte: weekAgo },
      },
    }),
  ]);

  return {
    pendingCode: notice
      ? forwardingConfirmationCode(notice.subject, notice.bodyText)
      : null,
    lastReceivedAt: last?.receivedAt ?? null,
    recentCount,
  };
}
