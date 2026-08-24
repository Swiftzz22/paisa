import { NextRequest } from "next/server";
import { getMobileUser } from "@/lib/auth/mobile";
import { prisma } from "@/lib/prisma";

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

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Period boundaries in the caller's timezone, expressed as UTC instants.
 *
 * `tzOffset` is minutes ahead of UTC (+330 for IST). This function used to
 * build dates from the server's own clock, and Vercel runs in UTC — so for a
 * user in IST "today" began at 05:30 their time, and a 1am purchase counted
 * against the previous day.
 *
 * Shifting the clock by the offset lets the UTC getters read the caller's local
 * wall time; subtracting it again turns a local midnight back into an instant.
 * No DST handling, which is correct for India and wrong by an hour twice a year
 * in zones that observe it.
 */
function rangeFor(
  period: Period,
  now: Date,
  tzOffset: number
): { from: Date; to: Date; label: string } {
  const shift = tzOffset * 60_000;
  const local = new Date(now.getTime() + shift);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d = local.getUTCDate();

  /** A local wall-clock time, back as the UTC instant it actually happened. */
  const at = (
    yy: number, mm: number, dd: number,
    hh = 0, mi = 0, ss = 0, ms = 0
  ) => new Date(Date.UTC(yy, mm, dd, hh, mi, ss, ms) - shift);

  if (period === "day") {
    return {
      from: at(y, m, d),
      to: at(y, m, d, 23, 59, 59, 999),
      label: "Today",
    };
  }
  if (period === "week") {
    const daysSinceMon = (local.getUTCDay() + 6) % 7; // week starts Monday
    return {
      from: at(y, m, d - daysSinceMon),
      to: at(y, m, d, 23, 59, 59, 999),
      label: "This week",
    };
  }
  if (period === "year") {
    return {
      from: at(y, 0, 1),
      to: at(y, 11, 31, 23, 59, 59, 999),
      label: `${y}`,
    };
  }
  return {
    // Day 0 of the next month is the last day of this one.
    from: at(y, m, 1),
    to: at(y, m + 1, 0, 23, 59, 59, 999),
    label: `${MONTH_NAMES[m]} ${y}`,
  };
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

  // Minutes ahead of UTC, as the client sees it (+330 for IST). Clamped to the
  // real-world range; absent or unparseable means UTC, matching the old
  // behaviour rather than guessing.
  const rawOffset = Number(req.nextUrl.searchParams.get("tzOffset"));
  const tzOffset = Number.isFinite(rawOffset)
    ? Math.max(-840, Math.min(840, Math.trunc(rawOffset)))
    : 0;

  const now = new Date();
  const year = rangeFor("year", now, tzOffset);

  const txs = await prisma.transaction.findMany({
    where: {
      userId: user.id,
      occurredAt: { gte: year.from, lte: year.to },
    },
    include: { lines: { include: { category: { include: { parent: true } } } } },
  });

  const rows: Row[] = txs.map((t) => {
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

  // Colours are assigned from the year's ranking so a category keeps the same
  // colour in every period — otherwise Food could be blue on Year and green on
  // Week, which makes switching tabs read as unrelated charts.
  const yearRanking = new Map<string, number>();
  const totals = new Map<string, number>();
  for (const r of rows) {
    if (r.type !== "debit") continue;
    totals.set(r.category, (totals.get(r.category) ?? 0) + r.amount);
  }
  Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1])
    .forEach(([name], i) => yearRanking.set(name, i));
  const colorFor = (category: string) =>
    CATEGORY_COLORS[(yearRanking.get(category) ?? 0) % CATEGORY_COLORS.length];

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

  return Response.json({ periods, ...legacy });
}
