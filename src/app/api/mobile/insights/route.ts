import { NextRequest } from "next/server";
import { getMobileUser } from "@/lib/auth/mobile";
import { getRangeSummary } from "@/lib/spending";

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

type Period = "day" | "week" | "month" | "year";

function rangeFor(period: Period, now: Date): { from: Date; to: Date; label: string } {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  if (period === "day") {
    return {
      from: new Date(y, m, d, 0, 0, 0, 0),
      to: new Date(y, m, d, 23, 59, 59, 999),
      label: "Today",
    };
  }
  if (period === "week") {
    // Week starts Monday.
    const dow = now.getDay(); // 0 = Sun
    const daysSinceMon = (dow + 6) % 7;
    const start = new Date(y, m, d - daysSinceMon, 0, 0, 0, 0);
    const end = new Date(y, m, d, 23, 59, 59, 999);
    return { from: start, to: end, label: "This week" };
  }
  if (period === "year") {
    return {
      from: new Date(y, 0, 1, 0, 0, 0, 0),
      to: new Date(y, 11, 31, 23, 59, 59, 999),
      label: `${y}`,
    };
  }
  // month
  return {
    from: new Date(y, m, 1, 0, 0, 0, 0),
    to: new Date(y, m + 1, 0, 23, 59, 59, 999),
    label: now.toLocaleDateString("en-IN", { month: "long", year: "numeric" }),
  };
}

/**
 * Spend breakdown for a user-picked period. Returns total, category slices, and
 * payment-mode slices — all in shape the native app can render as pies + rows.
 */
export async function GET(req: NextRequest) {
  const user = await getMobileUser(req.headers.get("authorization"));
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const rawPeriod = new URL(req.url).searchParams.get("period") ?? "month";
  const period: Period = (["day", "week", "month", "year"] as const).includes(
    rawPeriod as Period
  )
    ? (rawPeriod as Period)
    : "month";

  const { from, to, label } = rangeFor(period, new Date());
  const summary = await getRangeSummary({ userId: user.id, from, to });

  const totalCategory = summary.byCategory.reduce((s, c) => s + c.amount, 0) || 1;
  const categories = summary.byCategory.map((c, i) => ({
    name: c.name,
    amount: Math.round(c.amount),
    pct: Math.round((c.amount / totalCategory) * 100),
    color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
    txCount: c.txCount,
  }));

  const totalMode = summary.byPaymentMode.reduce((s, p) => s + p.amount, 0) || 1;
  const paymentModes = summary.byPaymentMode.map((p) => ({
    mode: p.mode,
    label: p.label,
    amount: Math.round(p.amount),
    pct: Math.round((p.amount / totalMode) * 100),
    color: PAYMENT_COLORS[p.mode] ?? "#71717a",
    txCount: p.txCount,
  }));

  return Response.json({
    period,
    label,
    from: from.toISOString(),
    to: to.toISOString(),
    spent: Math.round(summary.spentUnfiltered),
    received: Math.round(summary.received),
    // Net outflow: what left minus what came in. Negative means the period
    // brought in more than it spent.
    net: Math.round(summary.spentUnfiltered - summary.received),
    txCount: summary.countUnfiltered,
    categories,
    paymentModes,
  });
}
