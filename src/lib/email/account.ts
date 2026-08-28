import "server-only";
import { prisma } from "@/lib/prisma";
import { encrypt, decrypt } from "@/lib/crypto";

/**
 * Connected mailboxes.
 *
 * A user may have several. Bank alerts are routinely split across a personal
 * Gmail and a work or Outlook address, and only reading one of them loses half
 * someone's spending without ever saying so.
 */

export type StoredAccount = {
  id: string;
  provider: string;
  accountEmail: string;
  scope: string;
  lastSyncedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
};

function toStored(acc: {
  id: string;
  provider: string;
  accountEmail: string;
  scope: string;
  lastSyncedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}): StoredAccount {
  return {
    id: acc.id,
    provider: acc.provider,
    accountEmail: acc.accountEmail,
    scope: acc.scope,
    lastSyncedAt: acc.lastSyncedAt,
    expiresAt: acc.expiresAt,
    createdAt: acc.createdAt,
  };
}

/** Every mailbox this user has connected, oldest first. */
export async function getEmailAccounts(userId: string): Promise<StoredAccount[]> {
  const rows = await prisma.emailAccount.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toStored);
}

/**
 * The user's first mailbox, or null.
 *
 * Kept for callers that only need to know whether *any* mailbox is connected.
 * Anything that actually reads mail should use getEmailAccounts.
 */
export async function getEmailAccount(userId: string): Promise<StoredAccount | null> {
  const rows = await getEmailAccounts(userId);
  return rows[0] ?? null;
}

/** Decrypted refresh token for one specific mailbox. */
export async function getRefreshTokenFor(accountId: string): Promise<string | null> {
  const acc = await prisma.emailAccount.findUnique({
    where: { id: accountId },
    select: { refreshTokenEnc: true },
  });
  return acc ? decrypt(acc.refreshTokenEnc) : null;
}

/** Refresh token for the user's first mailbox. Prefer getRefreshTokenFor. */
export async function getRefreshToken(userId: string): Promise<string | null> {
  const acc = await prisma.emailAccount.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { refreshTokenEnc: true },
  });
  return acc ? decrypt(acc.refreshTokenEnc) : null;
}

/** Every mailbox with its decrypted token, for a sync pass. */
export async function getAccountsWithTokens(
  userId: string
): Promise<Array<StoredAccount & { refreshToken: string }>> {
  const rows = await prisma.emailAccount.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });

  // A row can fail to decrypt if it was written under a previous
  // ENCRYPTION_KEY. Now that a user can hold several mailboxes, letting that
  // throw would take down the sync for all of them — so drop the unreadable
  // one and carry on with the rest. The user sees that mailbox stop updating
  // and can reconnect it; the others keep working.
  const out: Array<StoredAccount & { refreshToken: string }> = [];
  for (const r of rows) {
    try {
      out.push({ ...toStored(r), refreshToken: decrypt(r.refreshTokenEnc) });
    } catch {
      console.error(
        `[email] cannot decrypt token for ${r.accountEmail} (account ${r.id}) — skipping; it needs reconnecting`
      );
    }
  }
  return out;
}

/**
 * Store or update a mailbox, keyed on the address rather than the user — so
 * reconnecting the same address refreshes it, and connecting a different one
 * adds it alongside.
 */
export async function saveEmailAccount(params: {
  userId: string;
  email: string;
  refreshToken: string;
  accessToken: string;
  expiresAt: Date | null;
  scope: string;
  provider?: string;
}) {
  const data = {
    refreshTokenEnc: encrypt(params.refreshToken),
    accessTokenEnc: encrypt(params.accessToken),
    expiresAt: params.expiresAt,
    scope: params.scope,
    provider: params.provider ?? "gmail",
  };
  return prisma.emailAccount.upsert({
    where: {
      userId_accountEmail: { userId: params.userId, accountEmail: params.email },
    },
    update: data,
    create: { userId: params.userId, accountEmail: params.email, ...data },
  });
}

/**
 * Microsoft rotates its refresh token on every use and expects the old one to
 * be discarded, so a sync that does not write the new one back leaves the
 * connection dead within 90 days.
 */
export async function updateRefreshToken(
  accountId: string,
  refreshToken: string
): Promise<void> {
  await prisma.emailAccount.update({
    where: { id: accountId },
    data: { refreshTokenEnc: encrypt(refreshToken) },
  });
}

/** Disconnect one mailbox, leaving the user's others alone. */
export async function deleteEmailAccountById(accountId: string): Promise<void> {
  await prisma.emailAccount.deleteMany({ where: { id: accountId } });
}

/** Disconnect every mailbox for a user. */
export async function deleteEmailAccount(userId: string): Promise<void> {
  await prisma.emailAccount.deleteMany({ where: { userId } });
}

export async function markSyncedAccount(
  accountId: string,
  when: Date = new Date()
): Promise<void> {
  await prisma.emailAccount.update({
    where: { id: accountId },
    data: { lastSyncedAt: when },
  });
}

/** Mark every one of the user's mailboxes as just synced. */
export async function markSynced(userId: string, when: Date = new Date()) {
  await prisma.emailAccount.updateMany({
    where: { userId },
    data: { lastSyncedAt: when },
  });
}
