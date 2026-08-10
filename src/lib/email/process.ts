import "server-only";
import { prisma } from "@/lib/prisma";
import { looksLikeTransactionEmail } from "@/lib/email/classify";
import {
  extractTransactionBatch,
  isGeminiConfigured,
  GeminiRateLimitError,
  BATCH_SIZE,
  type CategoryChoice,
  type EmailInput,
  type ExtractedTransaction,
} from "@/lib/email/parser";
import { normalizeMerchantMatcher } from "@/lib/rules";
import { getCategoryOptions } from "@/lib/categories";

export type ProcessResult = {
  total: number;
  parsed: number;
  ignored: number;
  failed: number;
  rateLimitedAfter: number | null;
};

/**
 * Process pending/failed emails for this user, up to `maxToProcess` at a time.
 *
 * Pipeline:
 *   1. Run the cheap classifier locally. Non-transaction emails are bulk-updated
 *      to 'ignored' — no LLM cost.
 *   2. Send transaction-shaped survivors through Gemini in a single batched call
 *      (one API call processes up to BATCH_SIZE emails).
 *   3. Per result: rule-match wins → LLM-suggested → Misc.
 *   4. Insert Transaction + ExpenseLine, dedupe within a 60-min window.
 *
 * The default `maxToProcess` equals BATCH_SIZE, so each user-triggered click
 * uses exactly one Gemini call. They re-trigger to process the next batch.
 */
export async function processPendingForUser(
  userId: string,
  maxToProcess: number = BATCH_SIZE
): Promise<ProcessResult> {
  const pending = await prisma.receivedEmail.findMany({
    where: { userId, parseStatus: { in: ["pending", "failed"] } },
    orderBy: { receivedAt: "desc" },
    take: maxToProcess,
  });

  if (pending.length === 0) {
    return { total: 0, parsed: 0, ignored: 0, failed: 0, rateLimitedAfter: null };
  }

  if (!isGeminiConfigured()) {
    await prisma.receivedEmail.updateMany({
      where: { id: { in: pending.map((e) => e.id) } },
      data: { parseStatus: "failed", parseError: "Gemini API key not set." },
    });
    return {
      total: pending.length,
      parsed: 0,
      ignored: 0,
      failed: pending.length,
      rateLimitedAfter: null,
    };
  }

  // 1. Cheap pre-filter
  const candidates: typeof pending = [];
  const toIgnore: string[] = [];
  for (const e of pending) {
    if (looksLikeTransactionEmail({ fromAddress: e.fromAddress, subject: e.subject })) {
      candidates.push(e);
    } else {
      toIgnore.push(e.id);
    }
  }
  if (toIgnore.length > 0) {
    await prisma.receivedEmail.updateMany({
      where: { id: { in: toIgnore } },
      data: { parseStatus: "ignored", parseError: null },
    });
  }

  if (candidates.length === 0) {
    return {
      total: pending.length,
      parsed: 0,
      ignored: toIgnore.length,
      failed: 0,
      rateLimitedAfter: null,
    };
  }

  // 2. Fetch category list once
  const categoryOptions = await getCategoryOptions(userId);
  const choices: CategoryChoice[] = categoryOptions.map((c) => ({
    label: c.label,
    id: c.id,
  }));
  const labelToId = new Map(choices.map((c) => [c.label, c.id] as const));

  // Pre-cache rules for the user so we don't re-query per-result.
  const rules = await prisma.categorizationRule.findMany({
    where: { userId, matcherType: "merchant" },
    orderBy: { priority: "desc" },
  });

  let parsed = 0;
  let ignored = toIgnore.length;
  let failed = 0;
  let rateLimitedAfter: number | null = null;

  // 3. Process in batches
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    const inputs: EmailInput[] = batch.map((e) => ({
      id: e.id,
      fromAddress: e.fromAddress,
      subject: e.subject,
      bodyText: e.bodyText,
      rawHtml: e.rawHtml,
      emailReceivedAt: e.receivedAt,
    }));

    let results: Map<string, ExtractedTransaction>;
    try {
      results = await extractTransactionBatch({
        emails: inputs,
        categories: choices,
      });
    } catch (e) {
      if (e instanceof GeminiRateLimitError) {
        rateLimitedAfter = e.retryAfterSeconds;
        break; // leave the batch pending; user retries when ready
      }
      // Real (non-rate-limit) error — mark whole batch as failed and continue.
      const msg = e instanceof Error ? e.message : String(e);
      await prisma.receivedEmail.updateMany({
        where: { id: { in: batch.map((b) => b.id) } },
        data: { parseStatus: "failed", parseError: msg.slice(0, 500) },
      });
      failed += batch.length;
      continue;
    }

    // 4. Per-email follow-up
    for (const email of batch) {
      const extract = results.get(email.id);
      if (!extract) {
        // Gemini didn't return a result for this id — treat as failed.
        await prisma.receivedEmail.update({
          where: { id: email.id },
          data: {
            parseStatus: "failed",
            parseError: "No result returned for this email in batch response.",
          },
        });
        failed++;
        continue;
      }

      if (
        !extract.is_transaction ||
        !extract.amount_inr ||
        !extract.merchant
      ) {
        await prisma.receivedEmail.update({
          where: { id: email.id },
          data: { parseStatus: "ignored", parseError: null },
        });
        ignored++;
        continue;
      }

      // Pick category — for debits, user-taught rules win over LLM suggestion.
      // For credits, skip rules (they're tuned for spending merchants) and trust
      // the LLM's Income › X choice, falling back to Income › Other.
      const llmCategoryId = extract.category_label
        ? labelToId.get(extract.category_label) ?? null
        : null;
      let categoryId: string;
      if (extract.kind === "credit") {
        categoryId =
          llmCategoryId ?? (await incomeOtherFallback(userId)) ?? (await miscFallback(userId));
      } else {
        const ruleCategoryId = pickRuleCategory(rules, extract.merchant);
        categoryId =
          ruleCategoryId ?? llmCategoryId ?? (await miscFallback(userId));
      }

      // Bank/UPI notifications are sent right when the transaction happens, so
      // the transaction time can't be meaningfully after the email arrived. If
      // the LLM's date is missing, invalid, or lands in the future (e.g. a
      // DD/MM-vs-MM/DD misparse of "11/08/2026" → Nov 8), fall back to when the
      // email was received — which is within minutes of the real transaction.
      const parsedAt = extract.transacted_at ? new Date(extract.transacted_at) : null;
      const usableDate =
        parsedAt !== null &&
        !Number.isNaN(parsedAt.getTime()) &&
        parsedAt.getTime() <= email.receivedAt.getTime() + 24 * 60 * 60 * 1000;
      const txAt = usableDate ? parsedAt : email.receivedAt;
      const amount = round2(extract.amount_inr);

      const dup = await findDuplicateTransaction({
        userId,
        merchant: extract.merchant,
        amount,
        occurredAt: txAt,
        type: extract.kind,
      });
      if (dup) {
        await prisma.receivedEmail.update({
          where: { id: email.id },
          data: {
            parseStatus: "ignored",
            parseError: `Duplicate of transaction ${dup.id}.`,
          },
        });
        ignored++;
        continue;
      }

      await prisma.transaction.create({
        data: {
          userId,
          merchant: extract.merchant,
          merchantRaw: email.fromAddress,
          amount,
          occurredAt: txAt,
          paymentMode: extract.payment_mode ?? "card",
          source: "email",
          type: extract.kind,
          emailId: email.id,
          note: extract.note ?? null,
          lines: {
            create: [{ categoryId, amount }],
          },
        },
      });
      await prisma.receivedEmail.update({
        where: { id: email.id },
        data: { parseStatus: "parsed", parseError: null },
      });
      parsed++;
    }
  }

  return {
    total: pending.length,
    parsed,
    ignored,
    failed,
    rateLimitedAfter,
  };
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

async function findDuplicateTransaction(params: {
  userId: string;
  merchant: string;
  amount: number;
  occurredAt: Date;
  type: "debit" | "credit";
}): Promise<{ id: string } | null> {
  const windowMs = 60 * 60 * 1000;
  const from = new Date(params.occurredAt.getTime() - windowMs);
  const to = new Date(params.occurredAt.getTime() + windowMs);

  const candidates = await prisma.transaction.findMany({
    where: {
      userId: params.userId,
      occurredAt: { gte: from, lte: to },
      type: params.type,
    },
    select: { id: true, merchant: true, amount: true },
  });
  const target = params.merchant.toLowerCase().trim();
  for (const c of candidates) {
    if (c.merchant.toLowerCase().trim() !== target) continue;
    const a = Number(c.amount);
    if (Math.abs(a - params.amount) < 0.01) {
      return { id: c.id };
    }
  }
  return null;
}

async function incomeOtherFallback(userId: string): Promise<string | null> {
  const income = await prisma.category.findFirst({
    where: { userId, name: "Income", parentId: null },
    include: { children: { where: { name: "Other" } } },
  });
  if (income?.children[0]) return income.children[0].id;
  if (income) return income.id;
  return null;
}

async function miscFallback(userId: string): Promise<string> {
  const misc = await prisma.category.findFirst({
    where: { userId, name: "Misc", parentId: null },
  });
  if (misc) return misc.id;
  const anyCategory = await prisma.category.findFirst({ where: { userId } });
  if (!anyCategory) {
    throw new Error("No categories exist for this user. Run `npm run db:seed`.");
  }
  return anyCategory.id;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
