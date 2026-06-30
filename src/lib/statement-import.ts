import "server-only";
import { prisma } from "@/lib/prisma";
import { normalizeMerchantMatcher } from "@/lib/rules";
import { parseHdfcStatement, type ParsedRow } from "@/lib/statement";
import {
  extractHsbcStatementWithGemini,
  type HsbcParsedRow,
} from "@/lib/statement-hsbc";
import {
  parseStatementFile,
  type UniversalRow,
} from "@/lib/statement-universal";
import { getCategoryOptions } from "@/lib/categories";

const HSBC_CARDHOLDER = "SANIA KOTHARI";
const HSBC_CUTOFF = new Date(2026, 0, 1); // Jan 1, 2026 — per user spec

export type ImportResult = {
  bank: string;
  totalRows: number;
  upiDebits: number;
  inserted: number;
  /** Skipped because we already had a Transaction with the same ref number. */
  skippedByRef: number;
  /** Skipped because a same-day same-amount same-merchant transaction already exists. */
  skippedByFuzzy: number;
  /** Skipped before insert because of an error. */
  failed: number;
  /** Universal importer: split of inserted rows. */
  debits?: number;
  credits?: number;
  /** Non-fatal notes (e.g. truncation) to surface to the user. */
  warnings?: string[];
};

/**
 * Universal statement importer. Accepts any bank's .pdf / .xlsx / .xls / .csv,
 * extracts transactions via Gemini, categorizes (rules → LLM suggestion →
 * default), and de-duplicates against existing transactions. Optionally filters
 * to one cardholder for joint/family statements.
 */
export async function importUniversalStatement(params: {
  userId: string;
  fileBuffer: Buffer;
  filename: string;
  cardholderName?: string | null;
}): Promise<ImportResult> {
  const categoryOptions = await getCategoryOptions(params.userId);
  const labelToId = new Map(categoryOptions.map((c) => [c.label, c.id] as const));

  const parsed = await parseStatementFile({
    buffer: params.fileBuffer,
    filename: params.filename,
    cardholderName: params.cardholderName,
    categories: categoryOptions.map((c) => ({ label: c.label, id: c.id })),
  });

  const out: ImportResult = {
    bank: parsed.bank,
    totalRows: parsed.rows.length,
    upiDebits: parsed.rows.length,
    inserted: 0,
    skippedByRef: 0,
    skippedByFuzzy: 0,
    failed: 0,
    debits: 0,
    credits: 0,
    warnings: parsed.warnings,
  };
  if (parsed.rows.length === 0) return out;

  const rules = await prisma.categorizationRule.findMany({
    where: { userId: params.userId, matcherType: "merchant" },
    orderBy: { priority: "desc" },
  });
  const miscId = await getMiscCategoryId(params.userId);
  const incomeOtherId = await getIncomeOtherCategoryId(params.userId);

  const batch = await prisma.importBatch.create({
    data: {
      userId: params.userId,
      filename: params.filename,
      bank: parsed.bank.slice(0, 40),
      rowCount: parsed.rows.length,
    },
  });

  for (const row of parsed.rows) {
    try {
      const externalId = universalRef(row);
      const dup = await findUniversalDuplicate(params.userId, row, externalId);
      if (dup === "ref") {
        out.skippedByRef++;
        continue;
      }
      if (dup === "fuzzy") {
        out.skippedByFuzzy++;
        continue;
      }

      const llmCatId = row.categoryLabel
        ? labelToId.get(row.categoryLabel) ?? null
        : null;
      const categoryId =
        row.type === "credit"
          ? llmCatId ?? incomeOtherId
          : pickRuleCategory(rules, row.merchant) ?? llmCatId ?? miscId;

      await prisma.transaction.create({
        data: {
          userId: params.userId,
          merchant: row.merchant,
          merchantRaw: row.narration || null,
          amount: row.amount,
          occurredAt: row.date,
          paymentMode: row.paymentMode,
          source: "csv",
          type: row.type,
          externalId,
          importBatchId: batch.id,
          note: null,
          lines: { create: [{ categoryId, amount: row.amount }] },
        },
      });
      out.inserted++;
      if (row.type === "credit") out.credits = (out.credits ?? 0) + 1;
      else out.debits = (out.debits ?? 0) + 1;
    } catch (e) {
      console.error("[universal import] row failed:", row, e);
      out.failed++;
    }
  }
  return out;
}

/** Deterministic dedup key: the bank's reference if present, else synthesized. */
function universalRef(row: UniversalRow): string {
  if (row.reference) return `ref-${row.reference}`;
  const date = row.date.toISOString().slice(0, 10);
  const merchant = row.merchant.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return `syn-${row.type}-${date}-${row.amount.toFixed(2)}-${merchant.slice(0, 30)}`;
}

async function findUniversalDuplicate(
  userId: string,
  row: UniversalRow,
  externalId: string
): Promise<"ref" | "fuzzy" | null> {
  const byRef = await prisma.transaction.findFirst({
    where: { userId, externalId },
    select: { id: true },
  });
  if (byRef) return "ref";

  const dayStart = new Date(row.date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(row.date);
  dayEnd.setHours(23, 59, 59, 999);
  const sameDay = await prisma.transaction.findMany({
    where: { userId, occurredAt: { gte: dayStart, lte: dayEnd }, type: row.type },
    select: { merchant: true, amount: true },
  });
  for (const t of sameDay) {
    if (Math.abs(Number(t.amount) - row.amount) > 0.01) continue;
    if (fuzzyMerchantMatch(t.merchant, row.merchant)) return "fuzzy";
  }
  return null;
}

/**
 * Import an HSBC credit-card PDF statement (family / multi-cardholder).
 * Uses Gemini to read the PDF and extract only SANIA KOTHARI's debit rows
 * on or after Jan 1, 2026.
 */
export async function importHsbcStatement(params: {
  userId: string;
  fileBuffer: Buffer;
  filename: string;
}): Promise<ImportResult> {
  const out: ImportResult = {
    bank: "HSBC",
    totalRows: 0,
    upiDebits: 0, // for HSBC this counts card debits, not UPI
    inserted: 0,
    skippedByRef: 0,
    skippedByFuzzy: 0,
    failed: 0,
  };

  const parsed = await extractHsbcStatementWithGemini({
    pdfBuffer: params.fileBuffer,
    targetCardholder: HSBC_CARDHOLDER,
    cutoffDate: HSBC_CUTOFF,
  });
  out.totalRows = parsed.rows.length;
  out.upiDebits = parsed.rows.length;

  if (parsed.rows.length === 0) return out;

  const rules = await prisma.categorizationRule.findMany({
    where: { userId: params.userId, matcherType: "merchant" },
    orderBy: { priority: "desc" },
  });
  const miscId = await getMiscCategoryId(params.userId);

  const batch = await prisma.importBatch.create({
    data: {
      userId: params.userId,
      filename: params.filename,
      bank: "HSBC",
      rowCount: parsed.rows.length,
    },
  });

  for (const row of parsed.rows) {
    try {
      // HSBC PDF lacks a unique ref number — synthesize one for primary dedup.
      const externalId = synthHsbcRef(row);
      const dup = await findHsbcDuplicate(params.userId, row, externalId);
      if (dup === "ref") {
        out.skippedByRef++;
        continue;
      }
      if (dup === "fuzzy") {
        out.skippedByFuzzy++;
        continue;
      }

      const defaultCatId =
        row.type === "credit" ? await getIncomeRefundCategoryId(params.userId) : miscId;
      const categoryId =
        row.type === "debit"
          ? pickRuleCategory(rules, row.merchant) ?? defaultCatId
          : defaultCatId;

      await prisma.transaction.create({
        data: {
          userId: params.userId,
          merchant: row.merchant,
          merchantRaw: row.narration,
          amount: row.amount,
          occurredAt: row.date,
          paymentMode: row.paymentMode,
          source: "csv",
          type: row.type,
          externalId,
          importBatchId: batch.id,
          note: null,
          lines: {
            create: [{ categoryId, amount: row.amount }],
          },
        },
      });
      out.inserted++;
    } catch (e) {
      console.error("[hsbc import] row failed:", row, e);
      out.failed++;
    }
  }
  return out;
}

function synthHsbcRef(row: HsbcParsedRow): string {
  const date = row.date.toISOString().slice(0, 10);
  const merchant = row.merchant.toLowerCase().replace(/[^a-z0-9]+/g, "");
  // Type is included so a refund and a purchase for same merchant/amount/day
  // aren't deduped together (they're different events).
  return `hsbc-${row.type}-${date}-${row.amount.toFixed(2)}-${merchant.slice(0, 30)}`;
}

async function findHsbcDuplicate(
  userId: string,
  row: HsbcParsedRow,
  externalId: string
): Promise<"ref" | "fuzzy" | null> {
  const byRef = await prisma.transaction.findFirst({
    where: { userId, externalId },
    select: { id: true },
  });
  if (byRef) return "ref";

  // Same-day fuzzy match — catches transactions already logged from HSBC emails.
  const dayStart = new Date(row.date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(row.date);
  dayEnd.setHours(23, 59, 59, 999);

  const sameDay = await prisma.transaction.findMany({
    where: {
      userId,
      occurredAt: { gte: dayStart, lte: dayEnd },
      type: row.type,
    },
    select: { id: true, merchant: true, amount: true },
  });
  for (const t of sameDay) {
    if (Math.abs(Number(t.amount) - row.amount) > 0.01) continue;
    if (fuzzyMerchantMatch(t.merchant, row.merchant)) return "fuzzy";
  }
  return null;
}

export async function importHdfcStatement(params: {
  userId: string;
  fileBuffer: Buffer;
  filename: string;
}): Promise<ImportResult> {
  const parsed = parseHdfcStatement(params.fileBuffer);
  const out: ImportResult = {
    bank: parsed.bank,
    totalRows: parsed.totalRows,
    upiDebits: parsed.upiDebits,
    inserted: 0,
    skippedByRef: 0,
    skippedByFuzzy: 0,
    failed: 0,
  };

  if (parsed.bank === "UNKNOWN" || parsed.upiDebits === 0) {
    return out;
  }

  // Pre-cache categorization rules once for the whole batch.
  const rules = await prisma.categorizationRule.findMany({
    where: { userId: params.userId, matcherType: "merchant" },
    orderBy: { priority: "desc" },
  });
  const miscId = await getMiscCategoryId(params.userId);

  // Record an ImportBatch row so the user can audit which file produced what.
  const batch = await prisma.importBatch.create({
    data: {
      userId: params.userId,
      filename: params.filename,
      bank: parsed.bank,
      rowCount: parsed.upiDebits,
    },
  });

  for (const row of parsed.parsed) {
    try {
      const dup = await findDuplicate(params.userId, row);
      if (dup === "ref") {
        out.skippedByRef++;
        continue;
      }
      if (dup === "fuzzy") {
        out.skippedByFuzzy++;
        continue;
      }

      const defaultCatId =
        row.type === "credit" ? await getIncomeOtherCategoryId(params.userId) : miscId;
      const categoryId =
        row.type === "debit"
          ? pickRuleCategory(rules, row.merchant) ?? defaultCatId
          : defaultCatId;

      await prisma.transaction.create({
        data: {
          userId: params.userId,
          merchant: row.merchant,
          merchantRaw: row.narration,
          amount: row.amount,
          occurredAt: row.date,
          paymentMode: row.paymentMode,
          source: "csv",
          type: row.type,
          externalId: row.externalId,
          importBatchId: batch.id,
          note: null,
          lines: {
            create: [{ categoryId, amount: row.amount }],
          },
        },
      });
      out.inserted++;
    } catch (e) {
      console.error("[statement import] row failed:", row.externalId, e);
      out.failed++;
    }
  }

  return out;
}

async function findDuplicate(
  userId: string,
  row: ParsedRow
): Promise<"ref" | "fuzzy" | null> {
  // 1. Definitive: same HDFC ref number anywhere in this user's transactions.
  const byRef = await prisma.transaction.findFirst({
    where: { userId, externalId: row.externalId },
    select: { id: true },
  });
  if (byRef) return "ref";

  // 2. Fuzzy: same calendar day + same amount + similar merchant.
  // Handles the case where an email-sourced transaction already covered this.
  const dayStart = new Date(row.date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(row.date);
  dayEnd.setHours(23, 59, 59, 999);

  const sameDay = await prisma.transaction.findMany({
    where: {
      userId,
      occurredAt: { gte: dayStart, lte: dayEnd },
    },
    select: { id: true, merchant: true, amount: true },
  });
  for (const t of sameDay) {
    if (Math.abs(Number(t.amount) - row.amount) > 0.01) continue;
    if (fuzzyMerchantMatch(t.merchant, row.merchant)) return "fuzzy";
  }
  return null;
}

function fuzzyMerchantMatch(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  // HDFC truncates merchant names; either being a substring of the other counts.
  // Length floor prevents single-letter false matches.
  if (na === nb) return true;
  const shorter = na.length < nb.length ? na : nb;
  const longer = na.length < nb.length ? nb : na;
  return shorter.length >= 4 && longer.includes(shorter);
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

async function getMiscCategoryId(userId: string): Promise<string> {
  const misc = await prisma.category.findFirst({
    where: { userId, name: "Misc", parentId: null },
  });
  if (misc) return misc.id;
  const any = await prisma.category.findFirst({ where: { userId } });
  if (!any) throw new Error("No categories. Run `npm run db:seed`.");
  return any.id;
}

/** "Income > Other" — default category for HDFC UPI credits. */
async function getIncomeOtherCategoryId(userId: string): Promise<string> {
  const income = await prisma.category.findFirst({
    where: { userId, name: "Income", parentId: null },
    include: { children: true },
  });
  if (income) {
    const other = income.children.find((c) => c.name === "Other");
    if (other) return other.id;
    return income.id;
  }
  return getMiscCategoryId(userId);
}

/** "Income > Refund" — default category for HSBC credit-card refunds. */
async function getIncomeRefundCategoryId(userId: string): Promise<string> {
  const income = await prisma.category.findFirst({
    where: { userId, name: "Income", parentId: null },
    include: { children: true },
  });
  if (income) {
    const refund = income.children.find((c) => c.name === "Refund");
    if (refund) return refund.id;
    return income.id;
  }
  return getMiscCategoryId(userId);
}
