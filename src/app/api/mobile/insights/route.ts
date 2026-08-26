import { NextRequest } from "next/server";
import { getMobileUser } from "@/lib/auth/mobile";
import { prisma } from "@/lib/prisma";
import {
  MONTH_NAMES,
  clampTzOffset,
  dayRange,
  localMonthKey,
  localParts,
  monthRange,
  weekRange,
  yearRange,
  type Range,
} from "@/lib/time";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CATEGORY_COLORS = [
  "#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#06b6d4",
  "#ec4899", "#14b8a6", "#84cc16", "#eab308", "#6366f1", "#71717a",
];

const PAYMENT_COLORS: Record<string, string> = {
  card: "#3b82f6",
  upi: "#22c55e",
  cash: "#f59e0b",
  bank_transfer: "#a855f7",
};

const PAYMENT_LABELS: Record<string, string> = {
  card: "Card",
  cash: "Cash",
  upi: "UPI",
  bank_transfer: "Bank transfer",
};

const PERIODS = ["day", "week", "month", "year"] as const;
type Period = (typeof PERIODS)[number];

/** "12 Aug – 3 Sep 2026" in the viewer's timezone. */
function rangeLabel(from: Date, to: Date, tzOffset: number): string {
  const a = localParts(from, tzOffset);
  const b = localParts(to, tzOffset);
  const short = (p: typeof a) => `${p.day} ${MONTH_NAMES[p.month].slice(0, 3)}`;
  return a.year === b.year
    ? `${short(a)} – ${short(b)} ${b.year}`
    : `${short(a)} ${a.year} – ${short(b)} ${b.year}`;
}

/** Transactions in a window, flattened to what the summariser needs. */
async function loadRows(userId: string, from: Date, to: Date): Promise<Row[]> {
  const txs = await prisma.transaction.findMany({
    where: { userId, occurredAt: { gte: from, lte: to } },
    include: { lines: { include: { category: { include: { parent: true } } } } },
  });
  return txs.map((t) => {
    const cat = t.lines[0]?.category ?? null;
    const parent = cat?.parent ?? null;
    return {
      at: t.occurredAt.getTime(),
      amount: Number(t.amount),
      type: t.type === "credit" ? "credit" : "debit",
      category: parent?.name ?? cat?.name ?? "Uncategorized",
      mode: t.paymentMode,
    };
  });
}

/**
 * Colour per category, ranked by spend, so a category keeps one colour across
 * every period rather than changing with each period's local ordering.
 */
function buildColorMap(rows: Row[]): (category: string) => string {
  const totals = new Map<string, number>();
  for (const r of rows) {
    if (r.type !== "debit") continue;
    totals.set(r.category, (totals.get(r.category) ?? 0) + r.amount);
  }
  const rank = new Map<string, number>();
  Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1])
    .forEach(([name], i) => rank.set(name, i));
  return (category: string) =>
    CATEGORY_COLORS[(rank.get(category) ?? 0) % CATEGORY_COLORS.length];
}

function rangeFor(period: Period, now: Date, tzOffset: number): Range {
  if (period === "day") return dayRange(now, tzOffset);
  if (period === "week") return weekRange(now, tzOffset);
  if (period === "year") return yearRange(now, tzOffset);
  return monthRange(now, tzOffset);
}

type Row = {
  at: number;
  amount: number;
  type: "debit" | "credit";
  category: string;
  mode: string;
};

function summarize(
  rows: Row[],
  period: Period,
  from: Date,
  to: Date,
  label: string,
  colorFor: (category: string) => string
) {
  const inRange = rows.filter(
    (r) => r.at >= from.getTime() && r.at <= to.getTime()
  );

  let spent = 0;
  let received = 0;
  const byCategory = new Map<string, { amount: number; txCount: number }>();
  const byMode = new Map<string, { amount: number; txCount: number }>();

  for (const r of inRange) {
    if (r.type === "credit") {
      received += r.amount;
      continue; // the breakdowns describe spending only
    }
    spent += r.amount;
    const c = byCategory.get(r.category);
    if (c) {
      c.amount += r.amount;
      c.txCount++;
    } else {
      byCategory.set(r.category, { amount: r.amount, txCount: 1 });
    }
    const m = byMode.get(r.mode);
    if (m) {
      m.amount += r.amount;
      m.txCount++;
    } else {
      byMode.set(r.mode, { amount: r.amount, txCount: 1 });
    }
  }

  const catTotal = spent || 1;
  const categories = Array.from(byCategory.entries())
    .sort((a, b) => b[1].amount - a[1].amount)
    .map(([name, v]) => ({
      name,
      amount: Math.round(v.amount),
      pct: Math.round((v.amount / catTotal) * 100),
      color: colorFor(name),
      txCount: v.txCount,
    }));

  const paymentModes = Array.from(byMode.entries())
    .sort((a, b) => b[1].amount - a[1].amount)
    .map(([mode, v]) => ({
      mode,
      label: PAYMENT_LABELS[mode] ?? mode,
      amount: Math.round(v.amount),
      pct: Math.round((v.amount / catTotal) * 100),
      color: PAYMENT_COLORS[mode] ?? "#71717a",
      txCount: v.txCount,
    }));

  return {
    period,
    label,
    from: from.toISOString(),
    to: to.toISOString(),
    spent: Math.round(spent),
    received: Math.round(received),
    // Net outflow: what left minus what came in. Negative means the period
    // brought in more than it spent.
    net: Math.round(spent - received),
    txCount: inRange.length,
    categories,
    paymentModes,
  };
}

/**
 * Spend breakdowns for day, week, month and year in one response.
 *
 * The year range contains the other three, so a single query answers all of
 * them and the app can switch tabs without touching the network — previously
 * every tap cost a round-trip (plus a possible cold start) and the switcher
 * felt frozen while it waited.
 */
export async function GET(req: NextRequest) {
  const user = await getMobileUser(req.headers.get("authorization"));
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const tzOffset = clampTzOffset(req.nextUrl.searchParams.get("tzOffset"));
  const now = new Date();

  // An explicit window (a custom range, or one month picked off the trend
  // chart). The app summarises this locally for an instant result, but its
  // history is capped, so this is the authoritative answer it corrects to.
  const fromParam = req.nextUrl.searchParams.get("from");
  const toParam = req.nextUrl.searchParams.get("to");
  if (fromParam && toParam) {
    const from = new Date(fromParam);
    const to = new Date(toParam);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return Response.json({ error: "Bad range." }, { status: 400 });
    }
    const [lo, hi] = from <= to ? [from, to] : [to, from];
    const rangeRows = await loadRows(user.id, lo, hi);
    const colorFor = buildColorMap(rangeRows);
    return Response.json({
      range: summarize(rangeRows, "month", lo, hi, rangeLabel(lo, hi, tzOffset), colorFor),
    });
  }
  const year = rangeFor("year", now, tzOffset);

  const rows = await loadRows(user.id, year.from, year.to);
  // Ranked over the year, so a category keeps one colour in every period.
  const colorFor = buildColorMap(rows);

  // Twelve months of spending for the trend chart. The year query only covers
  // this calendar year, so months from late last year need their own pass —
  // still one extra query, not one per month.
  const trendFrom = monthRange(now, tzOffset, -11).from;
  const trendTxs =
    trendFrom < year.from
      ? await prisma.transaction.findMany({
          where: {
            userId: user.id,
            type: "debit",
            occurredAt: { gte: trendFrom, lt: year.from },
          },
          select: { amount: true, occurredAt: true },
        })
      : [];

  const monthly: { key: string; label: string; total: number }[] = [];
  for (let i = -11; i <= 0; i++) {
    const r = monthRange(now, tzOffset, i);
    const { year: yy, month: mm } = localParts(r.from, tzOffset);
    monthly.push({
      key: `${yy}-${String(mm + 1).padStart(2, "0")}`,
      label: MONTH_NAMES[mm].slice(0, 3),
      total: 0,
    });
  }
  const monthlyByKey = new Map(monthly.map((m) => [m.key, m]));
  const addToMonth = (at: Date, amount: number) => {
    const bucket = monthlyByKey.get(localMonthKey(at, tzOffset));
    if (bucket) bucket.total += amount;
  };
  for (const t of trendTxs) addToMonth(t.occurredAt, Number(t.amount));
  for (const r of rows) if (r.type === "debit") addToMonth(new Date(r.at), r.amount);
  for (const m of monthly) m.total = Math.round(m.total);

  const periods = Object.fromEntries(
    PERIODS.map((p) => {
      const r = p === "year" ? year : rangeFor(p, now, tzOffset);
      return [p, summarize(rows, p, r.from, r.to, r.label, colorFor)];
    })
  ) as Record<Period, ReturnType<typeof summarize>>;

  // The single-period fields are kept alongside so an app build from before
  // this change keeps working if it updates after the server does.
  const asked = req.nextUrl.searchParams.get("period");
  const legacy = periods[
    (PERIODS as readonly string[]).includes(asked ?? "")
      ? (asked as Period)
      : "month"
  ];

  return Response.json({ periods, monthly, ...legacy });
}
