import "server-only";
import { prisma } from "@/lib/prisma";
import { getCategoryOptions } from "@/lib/categories";
import { normalizeMerchantMatcher } from "@/lib/rules";
import {
  categorizeMerchantBatch,
  isGeminiConfigured,
  GeminiRateLimitError,
  BATCH_SIZE,
  type CategoryChoice,
} from "@/lib/email/parser";

export type RecategorizeResult = {
  miscCount: number;
  uniqueMerchants: number;
  movedByRule: number;
  movedByLlm: number;
  unchanged: number;
  rateLimited: boolean;
};

/**
 * Walk every transaction currently in Misc and try to give it a better
 * category. CategorizationRule matches are applied for free; everything else
 * is sent through Gemini in batches (deduped by merchant, so 50 transactions
 * to "Swiggy" cost one LLM slot).
 */
export async function recategorizeMiscForUser(
  userId: string
): Promise<RecategorizeResult> {
  const miscCategory = await prisma.category.findFirst({
    where: { userId, name: "Misc", parentId: null },
  });
  if (!miscCategory) {
    return {
      miscCount: 0,
      uniqueMerchants: 0,
      movedByRule: 0,
      movedByLlm: 0,
      unchanged: 0,
      rateLimited: false,
    };
  }

  // Find all transactions whose single ExpenseLine points at Misc.
  const lines = await prisma.expenseLine.findMany({
    where: {
      categoryId: miscCategory.id,
      transaction: { userId },
    },
    include: {
      transaction: { select: { merchant: true } },
    },
  });

  const result: RecategorizeResult = {
    miscCount: lines.length,
    uniqueMerchants: 0,
    movedByRule: 0,
    movedByLlm: 0,
    unchanged: 0,
    rateLimited: false,
  };
  if (lines.length === 0) return result;

  // Group by merchant (case/whitespace-insensitive).
  const byMerchant = new Map<string, { canonical: string; lineIds: string[] }>();
  for (const ln of lines) {
    const key = ln.transaction.merchant.trim().toLowerCase();
    const slot = byMerchant.get(key);
    if (slot) slot.lineIds.push(ln.id);
    else byMerchant.set(key, { canonical: ln.transaction.merchant.trim(), lineIds: [ln.id] });
  }
  result.uniqueMerchants = byMerchant.size;

  const categoryOptions = await getCategoryOptions(userId);
  const choices: CategoryChoice[] = categoryOptions.map((c) => ({
    label: c.label,
    id: c.id,
  }));
  const labelToId = new Map(choices.map((c) => [c.label, c.id] as const));

  // 1. Try CategorizationRule for each merchant first — cheap, deterministic.
  const rules = await prisma.categorizationRule.findMany({
    where: { userId, matcherType: "merchant" },
    orderBy: { priority: "desc" },
  });
  const stillUncategorized: Array<{ key: string; canonical: string; lineIds: string[] }> = [];
  for (const [key, info] of byMerchant) {
    const ruleCat = pickRuleCategory(rules, info.canonical);
    if (ruleCat && ruleCat !== miscCategory.id) {
      await prisma.expenseLine.updateMany({
        where: { id: { in: info.lineIds } },
        data: { categoryId: ruleCat },
      });
      result.movedByRule += info.lineIds.length;
    } else {
      stillUncategorized.push({ key, canonical: info.canonical, lineIds: info.lineIds });
    }
  }

  // 2. LLM for the rest, batched.
  if (stillUncategorized.length > 0 && isGeminiConfigured()) {
    for (let i = 0; i < stillUncategorized.length; i += BATCH_SIZE) {
      const chunk = stillUncategorized.slice(i, i + BATCH_SIZE);
      try {
        const suggestions = await categorizeMerchantBatch({
          merchants: chunk.map((c) => c.canonical),
          categories: choices,
        });
        for (const item of chunk) {
          const label = suggestions.get(item.canonical);
          if (!label) {
            result.unchanged += item.lineIds.length;
            continue;
          }
          const newCatId = labelToId.get(label);
          if (!newCatId || newCatId === miscCategory.id) {
            result.unchanged += item.lineIds.length;
            continue;
          }
          await prisma.expenseLine.updateMany({
            where: { id: { in: item.lineIds } },
            data: { categoryId: newCatId },
          });
          result.movedByLlm += item.lineIds.length;
        }
      } catch (e) {
        if (e instanceof GeminiRateLimitError) {
          // Stop the batch — remaining merchants stay Misc, user clicks again later.
          result.rateLimited = true;
          for (const c of stillUncategorized.slice(i)) {
            result.unchanged += c.lineIds.length;
          }
          break;
        }
        console.error("[recategorize] batch error:", e);
        for (const c of chunk) result.unchanged += c.lineIds.length;
      }
    }
  } else if (stillUncategorized.length > 0) {
    for (const c of stillUncategorized) result.unchanged += c.lineIds.length;
  }

  return result;
}

function pickRuleCategory(
  rules: Array<{ matcherValue: string; categoryId: string }>,
  merchant: string
): string | null {
  const m = normalizeMerchantMatcher(merchant);
  for (const r of rules) {
    if (m.includes(r.matcherValue.toLowerCase())) return r.categoryId;
  }
  return null;
}
