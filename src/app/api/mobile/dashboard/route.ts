import { NextRequest } from "next/server";
import { getMobileUser } from "@/lib/auth/mobile";
import { prisma } from "@/lib/prisma";
import { getBudgetProgress, getMonthOverMonthDelta } from "@/lib/budgets";
import { getRangeSummary } from "@/lib/spending";
import { clampTzOffset, hasKnownTime, monthRange } from "@/lib/time";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CATEGORY_COLORS = [
  "#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#06b6d4",
  "#ec4899", "#14b8a6",
];

/** Dashboard payload for the native app. Bearer-token authenticated. */
export async function GET(req: NextRequest) {
  const user = await getMobileUser(req.headers.get("authorization"));
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  // Same offset the insights endpoint uses, so the hero card and the Insights
  // card never disagree about where a month starts.
  const tzOffset = clampTzOffset(req.nextUrl.searchParams.get("tzOffset"));
  const now = new Date();
  const month = monthRange(now, tzOffset);

  const [mom, budget, summary, recent] = await Promise.all([
    getMonthOverMonthDelta(user.id, now, tzOffset),
    getBudgetProgress(user.id, now, tzOffset),
    getRangeSummary({
      userId: user.id,
      from: month.from,
      to: month.to,
      tzOffset,
    }),
    prisma.transaction.findMany({
      where: { userId: user.id },
      orderBy: { occurredAt: "desc" },
      take: 12,
      include: { lines: { include: { category: { include: { parent: true } } } } },
    }),
  ]);

  const topCats = summary.byCategory.slice(0, 6);
  const maxCat = topCats[0]?.amount || 1;
  const categories = topCats.map((c, i) => ({
    name: c.name,
    amount: Math.round(c.amount),
    pct: Math.max(3, Math.round((c.amount / maxCat) * 100)),
    color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
  }));

  const recentTxns = recent.map((t) => {
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
    };
  });

  // Lets the app tell "still looking through your inbox" apart from "you never
  // connected an inbox" — the same empty screen otherwise.
  const emailAccounts = await prisma.emailAccount.findMany({
    where: { userId: user.id },
    select: { accountEmail: true },
  });

  // Whether Sign in with Apple already opens this account. Settings needs it to
  // say "linked" rather than offering the link again to someone who has it.
  const account = await prisma.user.findUnique({
    where: { id: user.id },
    select: { appleSub: true, plusUntil: true },
  });

  return Response.json({
    user: {
      name: user.name,
      email: user.email,
      appleLinked: Boolean(account?.appleSub),
      // So Settings and the paywall sheet can show the right state without a
      // second request. Derived here rather than sent as a date, because the
      // app has no business interpreting an expiry.
      plus: Boolean(
        account?.plusUntil && account.plusUntil.getTime() > Date.now()
      ),
    },
    emailConnected: emailAccounts.length > 0,
    connectedEmails: emailAccounts.map((a) => a.accountEmail),
    monthLabel: budget.monthLabel,
    spent: Math.round(mom.thisMonth),
    // fraction, e.g. -0.12 = down 12%
    deltaPercent: mom.deltaPercent,
    budget:
      budget.totalCap > 0
        ? {
            left: Math.max(Math.round(budget.totalCap - budget.totalSpent), 0),
            cap: Math.round(budget.totalCap),
            daysElapsed: budget.daysElapsed,
            daysInMonth: budget.daysInMonth,
            pct: Math.min(Math.round((budget.totalSpent / budget.totalCap) * 100), 100),
          }
        : null,
    categories,
    recent: recentTxns,
  });
}
