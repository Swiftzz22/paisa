import "server-only";
import { prisma } from "@/lib/prisma";
import { encrypt, decrypt } from "@/lib/crypto";

export type StoredAccount = {
  id: string;
  accountEmail: string;
  scope: string;
  lastSyncedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
};

export async function getEmailAccount(userId: string): Promise<StoredAccount | null> {
  const acc = await prisma.emailAccount.findUnique({
    where: { userId },
  });
  if (!acc) return null;
  return {
    id: acc.id,
    accountEmail: acc.accountEmail,
    scope: acc.scope,
    lastSyncedAt: acc.lastSyncedAt,
    expiresAt: acc.expiresAt,
    createdAt: acc.createdAt,
  };
}

export async function getRefreshToken(userId: string): Promise<string | null> {
  const acc = await prisma.emailAccount.findUnique({
    where: { userId },
    select: { refreshTokenEnc: true },
  });
  if (!acc) return null;
  return decrypt(acc.refreshTokenEnc);
}

export async function saveEmailAccount(params: {
  userId: string;
  email: string;
  refreshToken: string;
  accessToken: string;
  expiresAt: Date | null;
  scope: string;
}) {
  const data = {
    accountEmail: params.email,
    refreshTokenEnc: encrypt(params.refreshToken),
    accessTokenEnc: encrypt(params.accessToken),
    expiresAt: params.expiresAt,
    scope: params.scope,
  };
  return prisma.emailAccount.upsert({
    where: { userId: params.userId },
    update: data,
    create: {
      userId: params.userId,
      provider: "gmail",
      ...data,
    },
  });
}

export async function deleteEmailAccount(userId: string): Promise<void> {
  await prisma.emailAccount.deleteMany({ where: { userId } });
}

export async function markSynced(userId: string, when: Date = new Date()) {
  await prisma.emailAccount.update({
    where: { userId },
    data: { lastSyncedAt: when },
  });
}
