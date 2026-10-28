import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { hasKnownTime } from "@/lib/time";
import { SPLIT_INCLUDE, serializeSplit } from "@/lib/splits";

/** What the app's lists are built from: categories one level up, plus splits. */
export const MOBILE_TXN_INCLUDE = {
  lines: { include: { category: { include: { parent: true } } } },
  ...SPLIT_INCLUDE,
} satisfies Prisma.TransactionInclude;

type MobileTxnRow = Prisma.TransactionGetPayload<{ include: typeof MOBILE_TXN_INCLUDE }>;

/**
 * One transaction in the shape the native app's lists expect. Shared by Home's
 * recent list and the calendar's day view, so a row opened from either one
 * edits the same way.
 */
export function toMobileTxn(t: MobileTxnRow) {
  const cat = t.lines[0]?.category ?? null;
  const catName = cat ? (cat.parent ? cat.parent.name : cat.name) : "Uncategorized";
  return {
    id: t.id,
    merchant: t.merchant,
    category: catName,
    categoryId: t.lines[0]?.categoryId ?? null,
    amount: Math.round(Number(t.amount)),
    type: t.type as "debit" | "credit",
    paymentMode: t.paymentMode,
    occurredAt: t.occurredAt.toISOString(),
    timeKnown: hasKnownTime(t.occurredAt, t.source),
    // Same shape as the transactions endpoint, so editing from Home opens a
    // foreign expense in the currency it was paid in.
    original:
      t.originalCurrency && t.originalAmount != null
        ? {
            amount: Number(t.originalAmount),
            currency: t.originalCurrency,
            rate: Number(t.fxRate),
            rateDate: t.fxRateDate,
          }
        : null,
    split: serializeSplit(t),
  };
}
