import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

/**
 * Five tools for the chat-with-your-money agent.
 *
 * Design notes:
 * - Read-only. No write tools in v1 — every tool is safe to call any number
 *   of times.
 * - All money values are returned as numbers in INR (no Decimal objects;
 *   JSON-friendly).
 * - All date inputs accept ISO YYYY-MM-DD; outputs use the same format so
 *   the LLM doesn't have to parse anything weird.
 * - Each tool validates its args with Zod; bad args produce a structured
 *   error the agent can read and react to rather than throwing.
 * - Each tool caps its output (limit param + hard ceiling) so a runaway
 *   query can't blow the LLM's context window.
 */

const HARD_LIMIT = 100;

const ISODate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");

const ISOMonth = z
  .string()
  .regex(/^\d{4}-\d{2}$/, "Month must be YYYY-MM");

const TxType = z.enum(["debit", "credit"]);

/** Parse "YYYY-MM-DD" → Date at local midnight. */
function dateAtStart(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}
function dateAtEnd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}
function monthRange(s: string): { from: Date; to: Date } {
  const [y, m] = s.split("-").map(Number);
  return {
    from: new Date(y, m - 1, 1, 0, 0, 0, 0),
    to: new Date(y, m, 0, 23, 59, 59, 999), // last day of month
  };
}

/* -------------------------------------------------------------------------- */
/* 1. queryTransactions                                                       */
/* -------------------------------------------------------------------------- */

export const queryTransactionsSchema = z.object({
  from: ISODate.optional().describe(
    "Earliest transaction date to include (YYYY-MM-DD, inclusive)."
  ),
  to: ISODate.optional().describe(
    "Latest transaction date to include (YYYY-MM-DD, inclusive)."
  ),
  category: z.string().optional().describe(
    "Top-level rolled-up category name (e.g. 'Food'). Substring match."
  ),
  paymentMode: z.string().optional().describe(
    "Payment mode value (e.g. 'upi', 'card', 'cash', 'bank_transfer')."
  ),
  merchantContains: z.string().optional().describe(
    "Case-insensitive substring search on the merchant name."
  ),
  type: TxType.optional().describe(
    "'debit' for spending or 'credit' for money received."
  ),
  limit: z
    .number()
    .int()
    .positive()
    .max(HARD_LIMIT)
    .optional()
    .describe("Max rows to return (default 20, hard cap 100)."),
});

export type QueryTransactionsArgs = z.infer<typeof queryTransactionsSchema>;

export type TransactionRow = {
  id: string;
  date: string;
  merchant: string;
  amountInr: number;
  category: string;
  categoryLeaf: string | null;
  paymentMode: string;
  type: "debit" | "credit";
  note: string | null;
};

export async function queryTransactions(
  userId: string,
  rawArgs: unknown
): Promise<{ rows: TransactionRow[]; truncated: boolean }> {
  const args = queryTransactionsSchema.parse(rawArgs);
  const limit = Math.min(args.limit ?? 20, HARD_LIMIT);

  const txs = await prisma.transaction.findMany({
    where: {
      userId,
      ...(args.from ? { occurredAt: { gte: dateAtStart(args.from) } } : {}),
      ...(args.to ? { occurredAt: { lte: dateAtEnd(args.to) } } : {}),
      ...(args.from && args.to
        ? {
            occurredAt: {
              gte: dateAtStart(args.from),
              lte: dateAtEnd(args.to),
            },
          }
        : {}),
      ...(args.paymentMode ? { paymentMode: args.paymentMode } : {}),
      ...(args.type ? { type: args.type } : {}),
      ...(args.merchantContains
        ? { merchant: { contains: args.merchantContains } }
        : {}),
    },
    include: {
      lines: { include: { category: { include: { parent: true } } } },
    },
    orderBy: { occurredAt: "desc" },
    take: limit + 1, // peek for "truncated" flag
  });

  let rows: TransactionRow[] = txs.map((t) => {
    const cat = t.lines[0]?.category ?? null;
    const parent = cat?.parent ?? null;
    return {
      id: t.id,
      date: t.occurredAt.toISOString().slice(0, 10),
      merchant: t.merchant,
      amountInr: Number(t.amount),
      category: parent?.name ?? cat?.name ?? "Uncategorized",
      categoryLeaf: parent ? cat?.name ?? null : null,
      paymentMode: t.paymentMode,
      type: t.type === "credit" ? "credit" : "debit",
      note: t.note,
    };
  });

  // Server-side category filter (substring on rollup name).
  if (args.category) {
    const needle = args.category.toLowerCase();
    rows = rows.filter((r) => r.category.toLowerCase().includes(needle));
  }

  const truncated = rows.length > limit;
  if (truncated) rows = rows.slice(0, limit);
  return { rows, truncated };
}

/* -------------------------------------------------------------------------- */
/* 2. aggregateByCategory                                                     */
/* -------------------------------------------------------------------------- */

export const aggregateByCategorySchema = z.object({
  from: ISODate.describe("Range start, YYYY-MM-DD (inclusive)."),
  to: ISODate.describe("Range end, YYYY-MM-DD (inclusive)."),
  type: TxType.optional().describe(
    "Default 'debit' if omitted. Use 'credit' for income breakdown."
  ),
});

export type AggregateByCategoryArgs = z.infer<typeof aggregateByCategorySchema>;

export type CategoryAggregate = {
  category: string;
  totalInr: number;
  txCount: number;
};

export async function aggregateByCategory(
  userId: string,
  rawArgs: unknown
): Promise<{ rows: CategoryAggregate[]; rangeTotalInr: number }> {
  const args = aggregateByCategorySchema.parse(rawArgs);
  const type = args.type ?? "debit";

  const txs = await prisma.transaction.findMany({
    where: {
      userId,
      type,
      occurredAt: {
        gte: dateAtStart(args.from),
        lte: dateAtEnd(args.to),
      },
    },
    include: {
      lines: { include: { category: { include: { parent: true } } } },
    },
  });

  const map = new Map<string, CategoryAggregate>();
  let rangeTotal = 0;
  for (const t of txs) {
    const cat = t.lines[0]?.category ?? null;
    const parent = cat?.parent ?? null;
    const key = parent?.name ?? cat?.name ?? "Uncategorized";
    const amt = Number(t.amount);
    rangeTotal += amt;
    const cur = map.get(key);
    if (cur) {
      cur.totalInr += amt;
      cur.txCount++;
    } else {
      map.set(key, { category: key, totalInr: amt, txCount: 1 });
    }
  }
  const rows = Array.from(map.values()).sort(
    (a, b) => b.totalInr - a.totalInr
  );
  return { rows, rangeTotalInr: Math.round(rangeTotal * 100) / 100 };
}

/* -------------------------------------------------------------------------- */
/* 3. aggregateByMerchant                                                     */
/* -------------------------------------------------------------------------- */

export const aggregateByMerchantSchema = z.object({
  from: ISODate.describe("Range start, YYYY-MM-DD (inclusive)."),
  to: ISODate.describe("Range end, YYYY-MM-DD (inclusive)."),
  type: TxType.optional().describe("Default 'debit'."),
  limit: z
    .number()
    .int()
    .positive()
    .max(HARD_LIMIT)
    .optional()
    .describe("Top N by total. Default 10."),
});

export type AggregateByMerchantArgs = z.infer<typeof aggregateByMerchantSchema>;

export type MerchantAggregate = {
  merchant: string;
  totalInr: number;
  txCount: number;
};

export async function aggregateByMerchant(
  userId: string,
  rawArgs: unknown
): Promise<MerchantAggregate[]> {
  const args = aggregateByMerchantSchema.parse(rawArgs);
  const type = args.type ?? "debit";
  const limit = Math.min(args.limit ?? 10, HARD_LIMIT);

  const grouped = await prisma.transaction.groupBy({
    by: ["merchant"],
    where: {
      userId,
      type,
      occurredAt: {
        gte: dateAtStart(args.from),
        lte: dateAtEnd(args.to),
      },
    },
    _sum: { amount: true },
    _count: { _all: true },
  });

  return grouped
    .map((g) => ({
      merchant: g.merchant,
      totalInr: Math.round(Number(g._sum.amount ?? 0) * 100) / 100,
      txCount: g._count._all,
    }))
    .sort((a, b) => b.totalInr - a.totalInr)
    .slice(0, limit);
}

/* -------------------------------------------------------------------------- */
/* 4. monthlyTotals                                                           */
/* -------------------------------------------------------------------------- */

export const monthlyTotalsSchema = z.object({
  fromMonth: ISOMonth.describe("First month to include (YYYY-MM, inclusive)."),
  toMonth: ISOMonth.describe("Last month to include (YYYY-MM, inclusive)."),
  category: z.string().optional().describe(
    "Optional top-level category filter (substring match on rollup name)."
  ),
  type: TxType.optional().describe("Default 'debit'."),
});

export type MonthlyTotalsArgs = z.infer<typeof monthlyTotalsSchema>;

export type MonthlyTotalsRow = {
  month: string; // YYYY-MM
  totalInr: number;
  txCount: number;
};

export async function monthlyTotals(
  userId: string,
  rawArgs: unknown
): Promise<MonthlyTotalsRow[]> {
  const args = monthlyTotalsSchema.parse(rawArgs);
  const type = args.type ?? "debit";
  const start = monthRange(args.fromMonth).from;
  const end = monthRange(args.toMonth).to;

  const txs = await prisma.transaction.findMany({
    where: {
      userId,
      type,
      occurredAt: { gte: start, lte: end },
    },
    include: {
      lines: { include: { category: { include: { parent: true } } } },
    },
  });

  // Build a seeded map so empty months still appear.
  const months = new Map<string, MonthlyTotalsRow>();
  const cursor = new Date(start);
  while (cursor <= end) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    months.set(key, { month: key, totalInr: 0, txCount: 0 });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  const catNeedle = args.category?.toLowerCase() ?? null;
  for (const t of txs) {
    if (catNeedle) {
      const cat = t.lines[0]?.category ?? null;
      const rollup = cat?.parent?.name ?? cat?.name ?? "Uncategorized";
      if (!rollup.toLowerCase().includes(catNeedle)) continue;
    }
    const d = t.occurredAt;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const row = months.get(key);
    if (row) {
      row.totalInr += Number(t.amount);
      row.txCount++;
    }
  }

  for (const row of months.values()) {
    row.totalInr = Math.round(row.totalInr * 100) / 100;
  }
  return Array.from(months.values());
}

/* -------------------------------------------------------------------------- */
/* 5. getContext                                                              */
/* -------------------------------------------------------------------------- */

export const getContextSchema = z.object({});

export type ContextResult = {
  today: string;
  currencyCode: "INR";
  availableCategories: string[];
  availablePaymentModes: Array<{ value: string; label: string }>;
  earliestTransactionDate: string | null;
};

export async function getContext(userId: string): Promise<ContextResult> {
  const [topCats, modes, oldest] = await Promise.all([
    prisma.category.findMany({
      where: { userId, parentId: null, archived: false },
      orderBy: { name: "asc" },
      select: { name: true },
    }),
    prisma.paymentMode.findMany({
      where: { userId, archived: false },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { value: true, label: true },
    }),
    prisma.transaction.findFirst({
      where: { userId },
      orderBy: { occurredAt: "asc" },
      select: { occurredAt: true },
    }),
  ]);

  const today = new Date();
  return {
    today: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`,
    currencyCode: "INR",
    availableCategories: topCats.map((c) => c.name),
    availablePaymentModes: modes,
    earliestTransactionDate: oldest
      ? oldest.occurredAt.toISOString().slice(0, 10)
      : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Tool registry — keyed by the name the LLM will see                         */
/* -------------------------------------------------------------------------- */

export const AGENT_TOOLS = {
  queryTransactions: {
    description:
      "Look up individual transactions matching filters. Use this when the user asks 'show me' or 'list', or wants to see specific rows. Returns up to `limit` transactions, newest first.",
    schema: queryTransactionsSchema,
    run: queryTransactions,
  },
  aggregateByCategory: {
    description:
      "Sum spending grouped by top-level category over a date range. Use this for 'how much on X', 'category breakdown', 'where did my money go'.",
    schema: aggregateByCategorySchema,
    run: aggregateByCategory,
  },
  aggregateByMerchant: {
    description:
      "Sum spending grouped by merchant over a date range. Use this for 'top merchants', 'who am I paying the most', 'biggest expenses by vendor'.",
    schema: aggregateByMerchantSchema,
    run: aggregateByMerchant,
  },
  monthlyTotals: {
    description:
      "Spending totals per month across a span. Use this for trend questions: 'has X gone up?', 'compare months', 'last 6 months of food spending'.",
    schema: monthlyTotalsSchema,
    run: monthlyTotals,
  },
  getContext: {
    description:
      "Get today's date, the user's available category names, and available payment-mode values. Call this FIRST in a session so you can reference the right names in later tool calls.",
    schema: getContextSchema,
    run: async (userId: string) => getContext(userId),
  },
} as const;

export type ToolName = keyof typeof AGENT_TOOLS;
