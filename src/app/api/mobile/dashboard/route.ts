import { NextRequest } from "next/server";
import { getMobileUser } from "@/lib/auth/mobile";
import { prisma } from "@/lib/prisma";
import { getBudgetProgress, getMonthOverMonthDelta } from "@/lib/budgets";
import { getRangeSummary } from "@/lib/spending";
import { clampTzOffset, monthRange } from "@/lib/time";
import { paywallEnabled } from "@/lib/billing";
import { MOBILE_TXN_INCLUDE, toMobileTxn } from "@/lib/mobile-txn";

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
      include: MOBILE_TXN_INCLUDE,
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

  const recentTxns = recent.map(toMobileTxn);

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
  const hasPlus = Boolean(account?.plusUntil && account.plusUntil.getTime() > Date.now());

  return Response.json({
    user: {
      // The app identifies itself to RevenueCat with this, so a purchase
      // webhook can find the row. It is the person's own id and their token
      // already implies it, so nothing is revealed by returning it.
      id: user.id,
      name: user.name,
      email: user.email,
      appleLinked: Boolean(account?.appleSub),
      // So Settings and the paywall sheet can show the right state without a
      // second request. Derived here rather than sent as a date, because the
      // app has no business interpreting an expiry.
      plus: hasPlus,
      // Whether Plus features are open to this person right now — true for
      // everyone while the paywall is switched off. `plus` above answers "are
      // they paying"; this answers "may they use it", which is what features
      // that run entirely on the phone (receipt scanning) have to ask.
      plusAccess: paywallEnabled() ? hasPlus : true,
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
            // Spent in the capped categories only, and not clamped like `left`,
            // so the app can say how far over the cap someone has gone.
            spent: Math.round(budget.totalSpent),
          }
        : null,
    categories,
    recent: recentTxns,
  });
}
