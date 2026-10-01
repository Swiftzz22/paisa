import "server-only";
import { prisma } from "@/lib/prisma";
import { applyAlias, getAliasMap } from "@/lib/merchant-alias";
import { looksLikeTransactionEmail } from "@/lib/email/classify";
import {
  extractTransactionBatch,
  isGeminiConfigured,
  GeminiRateLimitError,
  OutOfTimeError,
  BATCH_SIZE,
  type CategoryChoice,
  type EmailInput,
  type ExtractedTransaction,
} from "@/lib/email/parser";
import { normalizeMerchantMatcher } from "@/lib/rules";
import { getCategoryOptions } from "@/lib/categories";

/**
 * Headroom to insist on before starting another model call.
 *
 * A batch of five takes 9-15s against this endpoint, so 18s leaves room for
 * a slow one plus the writes that follow. Starting a call with four seconds
 * left just produces a timeout and marks good mail failed.
 */
const PARSE_RESERVE_MS = 18_000;

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
  maxToProcess: number = BATCH_SIZE,
  deadline?: number
): Promise<ProcessResult> {
  // Never-tried mail first, retries only with the capacity left over.
  //
  // This was one query over {pending, failed} ordered by receivedAt desc, and
  // it deadlocked: ten emails failed on 16 September, all of them newer than
  // the 400 still pending, and BATCH_SIZE is ten — so every run picked exactly
  // those ten, retried them, failed again, and never reached the backlog. Four
  // hundred emails sat untouched for a fortnight while the same ten spun.
  const pending = await prisma.receivedEmail.findMany({
    where: { userId, parseStatus: "pending" },
    orderBy: { receivedAt: "desc" },
    take: maxToProcess,
  });
  if (pending.length < maxToProcess) {
    pending.push(
      ...(await prisma.receivedEmail.findMany({
        where: { userId, parseStatus: "failed" },
        orderBy: { receivedAt: "desc" },
        take: maxToProcess - pending.length,
      }))
    );
  }

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

  // Names the user has already corrected. Applied before the duplicate check
  // so a renamed merchant is compared against stored rows under the same name.
  const aliases = await getAliasMap(userId);

  let parsed = 0;
  let ignored = toIgnore.length;
  let failed = 0;
  let rateLimitedAfter: number | null = null;

  // 3. Process in batches
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    // One batch of ten used to be the whole run, and the cron fires once a
    // day — so the ceiling was ten emails a day however much time was left.
    // Keep going while there is room for another model call.
    if (deadline !== undefined && deadline - Date.now() < PARSE_RESERVE_MS) break;
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
        deadline,
      });
    } catch (e) {
      if (e instanceof OutOfTimeError) {
        // Leave the batch pending and return what we have — being killed
        // mid-call instead would lose the whole run's result.
        break;
      }
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

      // Resolve the display name first: a rule the user taught was saved
      // against the name they saw, which is the corrected one.
      const merchantName = applyAlias(aliases, extract.merchant);

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
        const ruleCategoryId = pickRuleCategory(rules, merchantName);
        categoryId =
          ruleCategoryId ?? llmCategoryId ?? (await miscFallback(userId));
      }

      // Bank/UPI notifications are sent within seconds of the transaction, so
      // the email's own arrival time IS the transaction time. The LLM's
      // transacted_at is not used: it reads dates out of the body with no
      // timezone context and has produced times hours ahead of the real one
      // (delivery ETAs, statement due dates, DD/MM-vs-MM/DD swaps).
      const txAt = email.receivedAt;
      const amount = round2(extract.amount_inr);

      const dup = await findDuplicateTransaction({
        userId,
        merchant: merchantName,
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

      // One write, so the two cannot disagree.
      //
      // These were separate statements, and a test email was once left marked
      // "parsed" with no transaction behind it — a state this code has no path
      // to produce, which is exactly why it was impossible to investigate
      // afterwards. Whatever caused it, "parsed" now means a transaction
      // exists, because the same commit created both. The id is logged so a
      // row that later goes missing can be traced rather than guessed at.
      const created = await prisma.$transaction(async (tx) => {
        const row = await tx.transaction.create({
          data: {
            userId,
            merchant: merchantName,
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
          select: { id: true },
        });
        await tx.receivedEmail.update({
          where: { id: email.id },
          data: { parseStatus: "parsed", parseError: null },
        });
        return row;
      });
      console.log(
        `[parse] ${email.id} -> transaction ${created.id} (${extract.kind} ${amount} ${merchantName})`
      );
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
