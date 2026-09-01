import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Friendlier names for the merchant strings banks send.
 *
 * UPI narrations arrive as "DEVMAN VENTURES PRIVAT" or a stranger's legal name.
 * Nobody can match those to a purchase they remember, so a list full of them is
 * a list people stop reading. When someone fixes one, the fix is kept and
 * reused — the same raw string is renamed on sight from then on.
 *
 * Deliberately the same shape as the category rules in lib/rules.ts: correct it
 * once, and the app stops getting it wrong.
 */

/** Stable key for a merchant string: trimmed and lowercased. */
export function normalizeMerchantKey(merchant: string): string {
  return merchant.trim().toLowerCase();
}

export type AliasMap = Map<string, string>;

/** Every alias this user has, keyed by normalized original text. */
export async function getAliasMap(userId: string): Promise<AliasMap> {
  const rows = await prisma.merchantAlias.findMany({
    where: { userId },
    select: { matchValue: true, displayName: true },
  });
  return new Map(rows.map((r) => [r.matchValue, r.displayName]));
}

/** The name to show for a merchant, given a map from getAliasMap. */
export function applyAlias(map: AliasMap, merchant: string): string {
  return map.get(normalizeMerchantKey(merchant)) ?? merchant;
}

export type AliasResult = {
  /** How many existing transactions were renamed. */
  renamed: number;
};

/**
 * Remember that `originalMerchant` should be shown as `displayName`, and bring
 * existing transactions along.
 *
 * Renaming past rows is the point: the value of fixing "DEVMAN VENTURES PRIVAT"
 * is that the ten previous ones stop being unreadable too.
 */
export async function upsertMerchantAlias(params: {
  userId: string;
  originalMerchant: string;
  displayName: string;
  /** Don't rename this one — the caller has already updated it. */
  skipTransactionId?: string;
}): Promise<AliasResult> {
  const matchValue = normalizeMerchantKey(params.originalMerchant);
  const displayName = params.displayName.trim();
  if (!matchValue || !displayName) return { renamed: 0 };

  // A rename to the same text teaches nothing and would create an alias that
  // maps a string to itself.
  if (matchValue === normalizeMerchantKey(displayName)) return { renamed: 0 };

  await prisma.merchantAlias.upsert({
    where: {
      userId_matchValue: { userId: params.userId, matchValue },
    },
    update: { displayName },
    create: { userId: params.userId, matchValue, displayName },
  });

  // Matched in JS rather than SQL: SQLite has no case-insensitive filter in
  // Prisma, and personal-scale data makes one scan cheaper than the workaround.
  const candidates = await prisma.transaction.findMany({
    where: { userId: params.userId },
    select: { id: true, merchant: true },
  });
  const ids = candidates
    .filter(
      (t) =>
        t.id !== params.skipTransactionId &&
        normalizeMerchantKey(t.merchant) === matchValue
    )
    .map((t) => t.id);
  if (ids.length === 0) return { renamed: 0 };

  const { count } = await prisma.transaction.updateMany({
    where: { id: { in: ids }, userId: params.userId },
    data: { merchant: displayName },
  });
  return { renamed: count };
}

/** Forget an alias. Past renames stay as they are; only future ones stop. */
export async function deleteMerchantAlias(
  userId: string,
  id: string
): Promise<void> {
  await prisma.merchantAlias.deleteMany({ where: { id, userId } });
}
