import "server-only";
import { prisma } from "@/lib/prisma";
import {
  MONTH_NAMES,
  localMonthKey,
  localParts,
  monthRange,
} from "@/lib/time";

export type TxRow = {
  id: string;
  occurredAt: Date;
  merchant: string;
  amount: number;
  paymentMode: string;
  source: string;
  type: "debit" | "credit";
  note: string | null;
  categoryLeafName: string | null;
  categoryParentName: string | null;
  categoryRollupName: string; // parent name if leaf, else own name
  categoryId: string | null;
};

export type CategorySlice = {
  name: string;
  amount: number;
  txCount: number;
};

export type PaymentSlice = {
  mode: string;
  label: string;
  amount: number;
  txCount: number;
};

export type DayGroup = {
  date: Date;
  label: string;
  /** Net = spent - received. */
  total: number;
  spent: number;
  received: number;
  count: number;
  txs: TxRow[];
};

export type MonthlyBar = {
  monthKey: string; // YYYY-MM
  label: string; // "May"
  total: number;
};

export type RangeSummary = {
  /** Totals/lists below reflect any active filters. */
  spent: number;
  received: number;
  total: number; // net = spent - received
  count: number;
  txs: TxRow[];
  byDay: DayGroup[];
  /** True when the rendered list was capped (see LIST_CAP) — `count` is the
   * real total; `byDay` only holds the most recent `listShown`. */
  listTruncated: boolean;
  listShown: number;

  /** Spent/count for the full range, ignoring filters — for the "X of Y" stat. */
  spentUnfiltered: number;
  countUnfiltered: number;

  /** Always computed from the full range (no filters), DEBITS ONLY, so the
   * charts represent spending and stay stable as filters are applied. */
  byCategory: CategorySlice[];
  byPaymentMode: PaymentSlice[];
  monthlyBars: MonthlyBar[];
};

const PAYMENT_LABELS: Record<string, string> = {
  card: "Card",
  cash: "Cash",
  upi: "UPI",
  bank_transfer: "Bank transfer",
};

export async function getRangeSummary(params: {
  userId: string;
  from: Date;
  to: Date;
  /** Match against categoryRollupName (top-level category). */
  categoryFilter?: string | null;
  /** Match against paymentMode (e.g. "upi", "card"). */
  paymentModeFilter?: string | null;
  /** Free-text search across merchant / note / category names. */
  searchQuery?: string | null;
  /** Minutes ahead of UTC, for bucketing the monthly bars. */
  tzOffset?: number;
}): Promise<RangeSummary> {
  const txs = await prisma.transaction.findMany({
    where: {
      userId: params.userId,
      occurredAt: { gte: params.from, lte: params.to },
    },
    orderBy: { occurredAt: "desc" },
    include: {
      lines: {
        include: {
          category: { include: { parent: true } },
        },
      },
    },
  });

  const allRows: TxRow[] = txs.map((t) => {
    const firstLine = t.lines[0];
    const cat = firstLine?.category ?? null;
    const parent = cat?.parent ?? null;
    return {
      id: t.id,
      occurredAt: t.occurredAt,
      merchant: t.merchant,
      amount: Number(t.amount),
      paymentMode: t.paymentMode,
      source: t.source,
      type: (t.type === "credit" ? "credit" : "debit") as "debit" | "credit",
      note: t.note,
      categoryLeafName: cat ? (parent ? cat.name : null) : null,
      categoryParentName: parent ? parent.name : null,
      categoryRollupName: cat ? parent?.name ?? cat.name : "Uncategorized",
      categoryId: firstLine?.categoryId ?? null,
    };
  });

  // Charts always show DEBITS for the full range — they're the "where did
  // you spend money" view.
  const allDebits = allRows.filter((r) => r.type === "debit");
  const spentUnfiltered = allDebits.reduce((s, r) => s + r.amount, 0);
  const byCategory = summarizeByCategory(allDebits);
  const byPaymentMode = summarizeByPaymentMode(allDebits);

  // List view honours category/payment filters and the search query.
  const searchTerm = (params.searchQuery ?? "").trim().toLowerCase();
  const filteredRows = allRows.filter((r) => {
    if (params.categoryFilter && r.categoryRollupName !== params.categoryFilter) {
      return false;
    }
    if (params.paymentModeFilter && r.paymentMode !== params.paymentModeFilter) {
      return false;
    }
    if (searchTerm) {
      const haystack = [
        r.merchant,
        r.note ?? "",
        r.categoryRollupName,
        r.categoryLeafName ?? "",
        r.categoryParentName ?? "",
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(searchTerm)) return false;
    }
    return true;
  });

  const spent = filteredRows
    .filter((r) => r.type === "debit")
    .reduce((s, r) => s + r.amount, 0);
  const received = filteredRows
    .filter((r) => r.type === "credit")
    .reduce((s, r) => s + r.amount, 0);

  // Totals and charts above cover the whole (filtered) range; the rendered
  // list is capped to the most recent LIST_CAP so wide ranges ("This year")
  // don't ship hundreds of DOM rows. filteredRows is already newest-first.
  const LIST_CAP = 100;
  const listRows = filteredRows.slice(0, LIST_CAP);
  const byDay = groupByDay(listRows);

  const monthlyBars = await getMonthlyBars(params.userId, params.tzOffset ?? 0);

  return {
    spent,
    received,
    total: spent - received,
    count: filteredRows.length,
    txs: filteredRows,
    byDay,
    listTruncated: filteredRows.length > LIST_CAP,
    listShown: listRows.length,
    spentUnfiltered,
    countUnfiltered: allRows.length,
    byCategory,
    byPaymentMode,
    monthlyBars,
  };
}

function summarizeByCategory(rows: TxRow[]): CategorySlice[] {
  const map = new Map<string, CategorySlice>();
  for (const r of rows) {
    const cur = map.get(r.categoryRollupName);
    if (cur) {
      cur.amount += r.amount;
      cur.txCount++;
    } else {
      map.set(r.categoryRollupName, {
        name: r.categoryRollupName,
        amount: r.amount,
        txCount: 1,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
}

function summarizeByPaymentMode(rows: TxRow[]): PaymentSlice[] {
  const map = new Map<string, PaymentSlice>();
  for (const r of rows) {
    const cur = map.get(r.paymentMode);
    if (cur) {
      cur.amount += r.amount;
      cur.txCount++;
    } else {
      map.set(r.paymentMode, {
        mode: r.paymentMode,
        label: PAYMENT_LABELS[r.paymentMode] ?? r.paymentMode,
        amount: r.amount,
        txCount: 1,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
}

function groupByDay(rows: TxRow[]): DayGroup[] {
  const map = new Map<string, DayGroup>();
  for (const r of rows) {
    const d = r.occurredAt;
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const sign = r.type === "credit" ? -1 : 1;
    const cur = map.get(key);
    if (cur) {
      cur.total += sign * r.amount;
      if (r.type === "credit") cur.received += r.amount;
      else cur.spent += r.amount;
      cur.count++;
      cur.txs.push(r);
    } else {
      map.set(key, {
        date: new Date(d.getFullYear(), d.getMonth(), d.getDate()),
        label: d.toLocaleDateString("en-IN", {
          weekday: "short",
          day: "2-digit",
          month: "short",
        }),
        total: sign * r.amount,
        spent: r.type === "debit" ? r.amount : 0,
        received: r.type === "credit" ? r.amount : 0,
        count: 1,
        txs: [r],
      });
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => b.date.getTime() - a.date.getTime()
  );
}

async function getMonthlyBars(
  userId: string,
  tzOffset = 0
): Promise<MonthlyBar[]> {
  const now = new Date();
  // Eleven months back plus the current one; bucketing uses the viewer's
  // months, so a transaction just after local midnight on the 1st lands in the
  // right bar rather than the previous one.
  const start = monthRange(now, tzOffset, -11).from;
  const txs = await prisma.transaction.findMany({
    where: { userId, occurredAt: { gte: start }, type: "debit" },
    select: { amount: true, occurredAt: true },
  });

  // Seed all 12 months (so empty months still show as zero bars).
  const months: MonthlyBar[] = [];
  for (let i = -11; i <= 0; i++) {
    const r = monthRange(now, tzOffset, i);
    const { year, month } = localParts(r.from, tzOffset);
    months.push({
      monthKey: `${year}-${String(month + 1).padStart(2, "0")}`,
      label: MONTH_NAMES[month].slice(0, 3),
      total: 0,
    });
  }

  const byKey = new Map(months.map((m) => [m.monthKey, m]));
  for (const t of txs) {
    const bar = byKey.get(localMonthKey(t.occurredAt, tzOffset));
    if (bar) bar.total += Number(t.amount);
  }

  return months;
}
