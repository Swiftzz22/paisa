"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/user";
import { upsertMerchantRule } from "@/lib/rules";
import { upsertMerchantAlias } from "@/lib/merchant-alias";
import { fetchAndStoreRecent } from "@/lib/email/fetch";
import {
  deleteEmailAccount,
  getRefreshToken,
} from "@/lib/email/account";
import { revokeToken } from "@/lib/email/google-oauth";
import { processPendingForUser } from "@/lib/email/process";
import { runSyncForUser } from "@/lib/sync";
import { importUniversalStatement } from "@/lib/statement-import";
import { recategorizeMiscForUser } from "@/lib/recategorize";
import { GeminiRateLimitError } from "@/lib/email/parser";
import { normalizePaymentValue } from "@/lib/payment-modes";

function readString(form: FormData, key: string): string {
  const v = form.get(key);
  if (typeof v !== "string") return "";
  return v.trim();
}

function readBool(form: FormData, key: string): boolean {
  return form.get(key) != null;
}

function parseAmount(raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error("Amount must be a positive number.");
  }
  return Math.round(n * 100) / 100;
}

// Parse a YYYY-MM-DD date from the date input. We anchor the time to noon
// local so the timestamp sorts cleanly and doesn't bounce across days due to
// timezone offsets.
function parseDate(raw: string): Date {
  if (!raw) throw new Error("Date is required.");
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) {
    // Fall back to native Date parsing for safety, but treat as invalid if NaN.
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) throw new Error("Date is invalid.");
    return d;
  }
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  return new Date(year, month, day, 12, 0, 0, 0);
}

async function parsePaymentMode(raw: string, userId: string): Promise<string> {
  if (!raw) throw new Error("Payment mode is required.");
  // Validate against the user's PaymentMode list — supports user-added modes
  // (Wallet, Gift card, etc.) alongside the seeded built-ins.
  const exists = await prisma.paymentMode.findFirst({
    where: { userId, value: raw, archived: false },
    select: { id: true },
  });
  if (!exists) {
    throw new Error(
      `Payment mode "${raw}" not found. Add it on /settings/payment-modes first.`
    );
  }
  return raw;
}

function parseType(raw: string): "debit" | "credit" {
  return raw === "credit" ? "credit" : "debit";
}

type TransactionFormFields = {
  merchant: string;
  amount: number;
  occurredAt: Date;
  paymentMode: string;
  categoryId: string;
  note: string | null;
  saveRule: boolean;
  /** Reuse this merchant name for the bank's original text in future. */
  saveAlias: boolean;
  type: "debit" | "credit";
};

async function readTransactionForm(
  form: FormData,
  userId: string
): Promise<TransactionFormFields> {
  const merchant = readString(form, "merchant");
  if (!merchant) throw new Error("Merchant is required.");

  const amount = parseAmount(readString(form, "amount"));
  const occurredAt = parseDate(readString(form, "occurredAt"));
  const paymentMode = await parsePaymentMode(
    readString(form, "paymentMode"),
    userId
  );
  const type = parseType(readString(form, "type"));

  const categoryId = readString(form, "categoryId");
  if (!categoryId) throw new Error("Category is required.");

  const category = await prisma.category.findFirst({
    where: { id: categoryId, userId },
  });
  if (!category) throw new Error("Selected category not found.");

  const note = readString(form, "note");
  return {
    merchant,
    amount,
    occurredAt,
    paymentMode,
    categoryId,
    note: note ? note : null,
    saveRule: readBool(form, "saveRule"),
    saveAlias: readBool(form, "saveAlias"),
    type,
  };
}

export async function createTransactionAction(form: FormData) {
  const user = await getCurrentUser();
  const data = await readTransactionForm(form, user.id);

  await prisma.transaction.create({
    data: {
      userId: user.id,
      merchant: data.merchant,
      amount: data.amount,
      occurredAt: data.occurredAt,
      paymentMode: data.paymentMode,
      source: "manual",
      type: data.type,
      note: data.note,
      lines: {
        create: [{ categoryId: data.categoryId, amount: data.amount }],
      },
    },
  });

  let retroCount = 0;
  if (data.saveRule) {
    const r = await upsertMerchantRule({
      userId: user.id,
      merchant: data.merchant,
      categoryId: data.categoryId,
    });
    retroCount = r.retroactivelyApplied;
  }

  revalidatePath("/");
  revalidatePath("/rules");
  if (retroCount > 0) {
    redirect(`/?ruleApplied=${retroCount}&merchant=${encodeURIComponent(data.merchant)}`);
  }
  redirect("/");
}

export async function updateTransactionAction(id: string, form: FormData) {
  const user = await getCurrentUser();
  const data = await readTransactionForm(form, user.id);

  const existing = await prisma.transaction.findFirst({
    where: { id, userId: user.id },
    include: { lines: true },
  });
  if (!existing) throw new Error("Transaction not found.");

  await prisma.$transaction(async (tx) => {
    await tx.transaction.update({
      where: { id },
      data: {
        merchant: data.merchant,
        amount: data.amount,
        occurredAt: data.occurredAt,
        paymentMode: data.paymentMode,
        type: data.type,
        note: data.note,
      },
    });

    if (existing.lines.length === 1) {
      await tx.expenseLine.update({
        where: { id: existing.lines[0].id },
        data: { categoryId: data.categoryId, amount: data.amount },
      });
    } else {
      await tx.expenseLine.deleteMany({ where: { transactionId: id } });
      await tx.expenseLine.create({
        data: { transactionId: id, categoryId: data.categoryId, amount: data.amount },
      });
    }
  });

  let retroCount = 0;
  let ruleSaved = false;
  if (data.saveRule) {
    const r = await upsertMerchantRule({
      userId: user.id,
      merchant: data.merchant,
      categoryId: data.categoryId,
    });
    retroCount = r.retroactivelyApplied;
    ruleSaved = true;
  }

  // Renaming a merchant teaches the app what to call it, the same way changing
  // a category teaches it where things belong.
  let renamedCount = 0;
  let aliasSaved = false;
  const merchantChanged =
    data.saveAlias && data.merchant.trim() !== existing.merchant.trim();
  if (merchantChanged) {
    const a = await upsertMerchantAlias({
      userId: user.id,
      originalMerchant: existing.merchant,
      displayName: data.merchant,
      skipTransactionId: id,
    });
    renamedCount = a.renamed;
    aliasSaved = true;
  }

  revalidatePath("/");
  revalidatePath(`/transactions/${id}/edit`);
  revalidatePath("/rules");

  // Say what was learned, always — not only when past transactions happened to
  // be updated. Saving a rule and hearing nothing back reads as nothing having
  // happened, which is exactly the case that used to fall silent.
  if (ruleSaved || aliasSaved) {
    const params = new URLSearchParams({ merchant: data.merchant });
    if (ruleSaved) {
      const category = await prisma.category.findFirst({
        where: { id: data.categoryId, userId: user.id },
        select: { name: true, parent: { select: { name: true } } },
      });
      params.set(
        "learnedCategory",
        category
          ? category.parent
            ? `${category.parent.name} › ${category.name}`
            : category.name
          : "that category"
      );
      if (retroCount > 0) params.set("ruleApplied", String(retroCount));
    }
    if (aliasSaved) {
      params.set("learnedName", existing.merchant);
      if (renamedCount > 0) params.set("renamed", String(renamedCount));
    }
    redirect(`/?${params.toString()}`);
  }
  redirect("/");
}

export async function deleteTransactionAction(id: string) {
  const user = await getCurrentUser();
  const existing = await prisma.transaction.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!existing) throw new Error("Transaction not found.");

  await prisma.transaction.delete({ where: { id } });
  revalidatePath("/");
  redirect("/");
}

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

export async function uploadStatementAction(form: FormData) {
  const user = await getCurrentUser();
  const file = form.get("statement");
  if (!file || typeof file === "string") {
    redirect("/settings/import?status=err&error=No+file+selected.");
  }

  // Reject oversized uploads before reading them into memory.
  if ((file as File).size > MAX_UPLOAD_BYTES) {
    redirect(
      "/settings/import?status=err&error=" +
        encodeURIComponent("File too large — max 10 MB.")
    );
  }

  const cardholderName = readString(form, "cardholderName") || null;

  try {
    const buffer = Buffer.from(await (file as File).arrayBuffer());
    const filename = (file as File).name || "statement";
    const result = await importUniversalStatement({
      userId: user.id,
      fileBuffer: buffer,
      filename,
      cardholderName,
    });

    revalidatePath("/");
    revalidatePath("/settings/import");

    const params = new URLSearchParams({
      status: "imported",
      bank: result.bank,
      rows: String(result.totalRows),
      inserted: String(result.inserted),
      debits: String(result.debits ?? 0),
      credits: String(result.credits ?? 0),
      skippedRef: String(result.skippedByRef),
      skippedFuzzy: String(result.skippedByFuzzy),
      failed: String(result.failed),
    });
    if (result.warnings && result.warnings.length > 0) {
      params.set("warn", result.warnings[0]);
    }
    redirect(`/settings/import?${params.toString()}`);
  } catch (e) {
    if (e instanceof Error && /NEXT_REDIRECT/.test(e.message)) throw e;
    if (e instanceof GeminiRateLimitError) {
      const params = new URLSearchParams({
        status: "err",
        error: `Gemini rate-limited (free tier). Wait ${e.retryAfterSeconds}s and try the upload again — no work was lost.`,
      });
      redirect(`/settings/import?${params.toString()}`);
    }
    console.error("[uploadStatementAction] failed:", e);
    const params = new URLSearchParams({
      status: "err",
      error: (e instanceof Error ? e.message : String(e)).slice(0, 400),
    });
    redirect(`/settings/import?${params.toString()}`);
  }
}

export async function recategorizeMiscAction() {
  const user = await getCurrentUser();
  try {
    const result = await recategorizeMiscForUser(user.id);
    revalidatePath("/");
    revalidatePath("/inbox");
    const params = new URLSearchParams({
      status: "recategorized",
      misc: String(result.miscCount),
      merchants: String(result.uniqueMerchants),
      byRule: String(result.movedByRule),
      byLlm: String(result.movedByLlm),
      unchanged: String(result.unchanged),
      rateLimited: result.rateLimited ? "1" : "0",
    });
    redirect(`/?${params.toString()}`);
  } catch (e) {
    if (e instanceof Error && /NEXT_REDIRECT/.test(e.message)) throw e;
    console.error("[recategorizeMiscAction] failed:", e);
    const params = new URLSearchParams({
      status: "err",
      error: (e instanceof Error ? e.message : String(e)).slice(0, 400),
    });
    redirect(`/?${params.toString()}`);
  }
}

/**
 * Reset every ReceivedEmail in 'ignored' status to 'pending' so the
 * current parser can re-evaluate them. Useful after improving the prompt
 * (e.g. teaching it about credits/refunds) so previously-skipped emails
 * get a second look. Truly non-transaction emails get cheaply re-ignored
 * by the classifier — the cost is a single DB update per email.
 */
export async function reprocessIgnoredEmailsAction() {
  const user = await getCurrentUser();
  const result = await prisma.receivedEmail.updateMany({
    where: { userId: user.id, parseStatus: "ignored" },
    data: { parseStatus: "pending", parseError: null },
  });
  revalidatePath("/settings/email");
  redirect(`/settings/email?status=reprocessed&count=${result.count}`);
}

export async function runSyncNowAction() {
  const user = await getCurrentUser();
  await runSyncForUser(user.id);
  revalidatePath("/settings/email");
  revalidatePath("/inbox");
  revalidatePath("/");
  redirect("/settings/email");
}

export async function disconnectGmailAction() {
  const user = await getCurrentUser();
  // Best-effort: revoke at Google. If the stored token can't be decrypted
  // (e.g. after a TOKEN_ENCRYPTION_KEY rotation), skip revocation — we must
  // still delete the local record so the user isn't trapped and can reconnect.
  try {
    const refreshToken = await getRefreshToken(user.id);
    if (refreshToken) {
      await revokeToken(refreshToken);
    }
  } catch (e) {
    console.error("[disconnectGmailAction] token revoke skipped:", e);
  }
  await deleteEmailAccount(user.id);
  revalidatePath("/settings/email");
  redirect("/settings/email?status=disconnected");
}

export async function fetchRecentEmailsAction(form?: FormData) {
  const user = await getCurrentUser();
  let count = 30;
  let after: Date | undefined;
  let before: Date | undefined;
  if (form) {
    const rawCount = form.get("count");
    if (typeof rawCount === "string") {
      const n = parseInt(rawCount, 10);
      if (Number.isFinite(n) && n > 0) {
        count = Math.min(2000, Math.max(1, n));
      }
    }
    const rawAfter = form.get("after");
    if (typeof rawAfter === "string" && rawAfter.trim()) {
      const d = new Date(rawAfter);
      if (!Number.isNaN(d.getTime())) after = d;
    }
    const rawBefore = form.get("before");
    if (typeof rawBefore === "string" && rawBefore.trim()) {
      const d = new Date(rawBefore);
      if (!Number.isNaN(d.getTime())) {
        // Make `before:` inclusive of the picked day: bump to start of next day.
        d.setDate(d.getDate() + 1);
        before = d;
      }
    }
  }
  try {
    const result = await fetchAndStoreRecent(user.id, {
      limit: count,
      after,
      before,
    });
    revalidatePath("/inbox");
    revalidatePath("/settings/email");
    revalidatePath("/");
    const params = new URLSearchParams({
      fetched: String(result.fetched),
      inserted: String(result.inserted),
      skipped: String(result.skipped),
      parsed: String(result.parsed),
      ignored: String(result.ignored),
      failed: String(result.failed),
    });
    redirect(`/inbox?${params.toString()}`);
  } catch (e) {
    // redirect() throws; ignore that case and only surface real errors
    if (e instanceof Error && /NEXT_REDIRECT/.test(e.message)) throw e;
    console.error("[fetchRecentEmailsAction] failed:", e);
    const params = new URLSearchParams({
      status: "err",
      error: (e instanceof Error ? e.message : String(e)).slice(0, 300),
    });
    redirect(`/settings/email?${params.toString()}`);
  }
}

export async function parsePendingEmailsAction() {
  const user = await getCurrentUser();
  try {
    const result = await processPendingForUser(user.id);
    revalidatePath("/inbox");
    revalidatePath("/settings/email");
    revalidatePath("/");
    // Count what's left so the user knows whether to click again.
    const remaining = await prisma.receivedEmail.count({
      where: { userId: user.id, parseStatus: { in: ["pending", "failed"] } },
    });
    const params = new URLSearchParams({
      status: result.rateLimitedAfter ? "ratelimited" : "parsed",
      total: String(result.total),
      parsed: String(result.parsed),
      ignored: String(result.ignored),
      failed: String(result.failed),
      remaining: String(remaining),
    });
    if (result.rateLimitedAfter) {
      params.set("retry", String(result.rateLimitedAfter));
    }
    redirect(`/inbox?${params.toString()}`);
  } catch (e) {
    if (e instanceof Error && /NEXT_REDIRECT/.test(e.message)) throw e;
    console.error("[parsePendingEmailsAction] failed:", e);
    const params = new URLSearchParams({
      status: "err",
      error: (e instanceof Error ? e.message : String(e)).slice(0, 400),
    });
    redirect(`/settings/email?${params.toString()}`);
  }
}

export async function addCategoryAction(form: FormData) {
  const user = await getCurrentUser();
  const name = (form.get("name") as string | null)?.trim() ?? "";
  const parentId = (form.get("parentId") as string | null)?.trim() || null;
  const icon = (form.get("icon") as string | null)?.trim() || null;

  if (!name) {
    redirect("/settings/categories?status=err&error=Name+is+required");
  }

  // App-side uniqueness (SQLite treats NULL parentIds as distinct in the
  // unique index, so we check ourselves).
  const existing = await prisma.category.findFirst({
    where: { userId: user.id, parentId, name },
  });
  if (existing) {
    redirect(
      `/settings/categories?status=err&error=${encodeURIComponent(
        `A category named "${name}" already exists here.`
      )}`
    );
  }

  // If parentId given, confirm it belongs to this user.
  if (parentId) {
    const parent = await prisma.category.findFirst({
      where: { id: parentId, userId: user.id },
    });
    if (!parent) {
      redirect("/settings/categories?status=err&error=Parent+not+found");
    }
  }

  await prisma.category.create({
    data: { userId: user.id, name, parentId, icon },
  });
  revalidatePath("/settings/categories");
  revalidatePath("/");
  redirect(`/settings/categories?status=added&name=${encodeURIComponent(name)}`);
}

/**
 * Create a top-level category inline (from the transaction edit form) and
 * return it so the client can select it without a page reload. If one with
 * that name already exists, returns the existing one (idempotent-ish).
 */
export async function createCategoryInlineAction(
  name: string
): Promise<{ id: string; label: string } | { error: string }> {
  const user = await getCurrentUser();
  const trimmed = (name ?? "").trim();
  if (!trimmed) return { error: "Enter a category name." };
  if (trimmed.length > 40) return { error: "Keep it under 40 characters." };

  const existing = await prisma.category.findFirst({
    where: { userId: user.id, parentId: null, name: trimmed },
  });
  if (existing) return { id: existing.id, label: existing.name };

  const created = await prisma.category.create({
    data: { userId: user.id, name: trimmed, parentId: null },
  });
  revalidatePath("/settings/categories");
  revalidatePath("/");
  return { id: created.id, label: created.name };
}

/** Remove a passkey. Scoped to the current user so nobody can delete another's. */
export async function deletePasskeyAction(id: string) {
  const user = await getCurrentUser();
  await prisma.passkey.deleteMany({ where: { id, userId: user.id } });
  revalidatePath("/settings/passkeys");
}

export async function archiveCategoryAction(id: string) {
  const user = await getCurrentUser();
  await prisma.category.updateMany({
    where: { id, userId: user.id },
    data: { archived: true },
  });
  revalidatePath("/settings/categories");
  redirect("/settings/categories?status=archived");
}

export async function unarchiveCategoryAction(id: string) {
  const user = await getCurrentUser();
  await prisma.category.updateMany({
    where: { id, userId: user.id },
    data: { archived: false },
  });
  revalidatePath("/settings/categories");
  redirect("/settings/categories");
}

export async function addPaymentModeAction(form: FormData) {
  const user = await getCurrentUser();
  const label = (form.get("label") as string | null)?.trim() ?? "";
  if (!label) {
    redirect("/settings/payment-modes?status=err&error=Label+is+required");
  }
  const value = normalizePaymentValue(label);
  if (!value) {
    redirect(
      "/settings/payment-modes?status=err&error=Label+must+contain+letters+or+numbers"
    );
  }

  const dup = await prisma.paymentMode.findFirst({
    where: { userId: user.id, value },
  });
  if (dup) {
    redirect(
      `/settings/payment-modes?status=err&error=${encodeURIComponent(
        `Payment mode "${dup.label}" already exists.`
      )}`
    );
  }

  const max = await prisma.paymentMode.findFirst({
    where: { userId: user.id },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  await prisma.paymentMode.create({
    data: {
      userId: user.id,
      value,
      label,
      sortOrder: (max?.sortOrder ?? 0) + 1,
    },
  });
  revalidatePath("/settings/payment-modes");
  redirect(`/settings/payment-modes?status=added&label=${encodeURIComponent(label)}`);
}

export async function archivePaymentModeAction(id: string) {
  const user = await getCurrentUser();
  await prisma.paymentMode.updateMany({
    where: { id, userId: user.id, builtin: false },
    data: { archived: true },
  });
  revalidatePath("/settings/payment-modes");
  redirect("/settings/payment-modes?status=archived");
}

export async function unarchivePaymentModeAction(id: string) {
  const user = await getCurrentUser();
  await prisma.paymentMode.updateMany({
    where: { id, userId: user.id },
    data: { archived: false },
  });
  revalidatePath("/settings/payment-modes");
  redirect("/settings/payment-modes");
}

export async function upsertBudgetAction(form: FormData) {
  const user = await getCurrentUser();
  const categoryId = readString(form, "categoryId");
  if (!categoryId) {
    redirect("/settings/budgets?status=err&error=Category+is+required");
  }
  const amount = parseAmount(readString(form, "amountInr"));

  const cat = await prisma.category.findFirst({
    where: { id: categoryId, userId: user.id },
  });
  if (!cat) {
    redirect("/settings/budgets?status=err&error=Category+not+found");
  }

  await prisma.budget.upsert({
    where: {
      userId_categoryId: { userId: user.id, categoryId },
    },
    update: { amountInr: amount },
    create: { userId: user.id, categoryId, amountInr: amount },
  });
  revalidatePath("/settings/budgets");
  revalidatePath("/");
  redirect("/settings/budgets?status=saved");
}

export async function deleteBudgetAction(id: string) {
  const user = await getCurrentUser();
  await prisma.budget.deleteMany({
    where: { id, userId: user.id },
  });
  revalidatePath("/settings/budgets");
  revalidatePath("/");
  redirect("/settings/budgets?status=deleted");
}

export async function deleteRuleAction(id: string) {
  const user = await getCurrentUser();
  const existing = await prisma.categorizationRule.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!existing) throw new Error("Rule not found.");

  await prisma.categorizationRule.delete({ where: { id } });
  revalidatePath("/rules");
  redirect("/rules");
}
