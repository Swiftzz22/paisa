import "server-only";
import { prisma } from "@/lib/prisma";

// Normalize a merchant string into a stable matcher value.
// Lowercase, trimmed. The match logic at ingest time will use case-insensitive
// `contains`, so this just keeps things consistent.
export function normalizeMerchantMatcher(merchant: string): string {
  return merchant.trim().toLowerCase();
}

export type UpsertRuleResult = {
  /** Number of EXISTING transactions retroactively re-categorized. */
  retroactivelyApplied: number;
};

/**
 * Upsert a "merchant → category" rule, then apply it retroactively to every
 * transaction whose merchant matches. Matches the user's mental model:
 * "I'm saving this rule and I want my past stuff to follow it too."
 *
 * Manual debit transactions are touched. Credits are left alone (rules are
 * tuned for spending categorization and don't make sense for refunds).
 */
export async function upsertMerchantRule(params: {
  userId: string;
  merchant: string;
  categoryId: string;
}): Promise<UpsertRuleResult> {
  const matcherValue = normalizeMerchantMatcher(params.merchant);
  if (!matcherValue) return { retroactivelyApplied: 0 };

  await prisma.categorizationRule.upsert({
    where: {
      userId_matcherType_matcherValue: {
        userId: params.userId,
        matcherType: "merchant",
        matcherValue,
      },
    },
    update: { categoryId: params.categoryId },
    create: {
      userId: params.userId,
      matcherType: "merchant",
      matcherValue,
      categoryId: params.categoryId,
    },
  });

  // Retroactive re-categorization. Pull merchants in one query (cheap for
  // personal-scale data), find matches by substring, then bulk-update.
  const txs = await prisma.transaction.findMany({
    where: { userId: params.userId, type: "debit" },
    select: {
      id: true,
      merchant: true,
      lines: { select: { id: true, categoryId: true } },
    },
  });

  const lineIdsToUpdate: string[] = [];
  for (const t of txs) {
    if (!t.merchant.toLowerCase().includes(matcherValue)) continue;
    for (const line of t.lines) {
      if (line.categoryId !== params.categoryId) {
        lineIdsToUpdate.push(line.id);
      }
    }
  }

  if (lineIdsToUpdate.length === 0) return { retroactivelyApplied: 0 };

  await prisma.expenseLine.updateMany({
    where: { id: { in: lineIdsToUpdate } },
    data: { categoryId: params.categoryId },
  });

  return { retroactivelyApplied: lineIdsToUpdate.length };
}
