import Link from "next/link";
import { getCurrentUser } from "@/lib/user";
import { prisma } from "@/lib/prisma";
import { formatINR } from "@/lib/format";
import { paymentModeLabel } from "@/lib/categories";
import {
  grainOfRange,
  parseRangeFromParams,
  periodContaining,
  toDateInput,
} from "@/lib/range";
import {
  getRangeSummary,
  type TxRow,
  type CategorySlice,
  type MonthlyBar,
} from "@/lib/spending";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { UndoDelete } from "@/components/UndoDelete";
import { Tip } from "@/components/Tip";
import { recategorizeMiscAction } from "@/lib/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { SegmentedRange } from "@/components/SegmentedRange";
import {
  CalendarMonth,
  Highlights,
  PeriodBar,
  WeekStrip,
} from "@/components/PeriodViews";
import { getBudgetProgress, getMonthOverMonthDelta } from "@/lib/budgets";
import {
  clockTime,
  dayRange,
  daysInLocalMonth,
  localParts,
  weekRange,
} from "@/lib/time";
import { getTzOffset } from "@/lib/tz-server";

export const dynamic = "force-dynamic";

/** Month bars visible at once in the hero; the rest are an arrow away. */
const HERO_MONTHS = 6;

type MomDelta = {
  thisMonth: number;
  lastMonth: number;
  deltaPercent: number | null;
};

type SearchParams = Promise<{
  range?: string;
  from?: string;
  to?: string;
  category?: string;
  paymentMode?: string;
  status?: string;
  misc?: string;
  merchants?: string;
  byRule?: string;
  byLlm?: string;
  unchanged?: string;
  rateLimited?: string;
  error?: string;
  ruleApplied?: string;
  /** Set when a correction taught the app something, so it can say so. */
  learnedCategory?: string;
  learnedName?: string;
  renamed?: string;
  merchant?: string;
  q?: string;
  /** Which six-month window the hero's month bars show; 0 = the most recent. */
  mo?: string;
  /** Period size chosen from the tabs. */
  grain?: string;
  /** A date picked from the calendar; the grain decides what it means. */
  on?: string;
  /** A delete waiting out its undo window: hidden here, sent by the toast. */
  deleted?: string;
}>;

// ── Category → icon + color, so transactions read at a glance (Quicken-style) ──
const CATEGORY_STYLES: Array<{
  match: string;
  emoji: string;
  chip: string;
  bar: string;
}> = [
  { match: "food", emoji: "🍽️", chip: "bg-blue-100 dark:bg-blue-950", bar: "#3b82f6" },
  { match: "transport", emoji: "🚗", chip: "bg-amber-100 dark:bg-amber-950", bar: "#f59e0b" },
  { match: "shop", emoji: "🛍️", chip: "bg-rose-100 dark:bg-rose-950", bar: "#f43f5e" },
  { match: "transfer", emoji: "🔁", chip: "bg-emerald-100 dark:bg-emerald-950", bar: "#10b981" },
  { match: "subscription", emoji: "📺", chip: "bg-purple-100 dark:bg-purple-950", bar: "#a855f7" },
  { match: "grocer", emoji: "🛒", chip: "bg-green-100 dark:bg-green-950", bar: "#22c55e" },
  { match: "salon", emoji: "💇", chip: "bg-pink-100 dark:bg-pink-950", bar: "#ec4899" },
  { match: "entertain", emoji: "🎬", chip: "bg-orange-100 dark:bg-orange-950", bar: "#f97316" },
  { match: "health", emoji: "🏥", chip: "bg-cyan-100 dark:bg-cyan-950", bar: "#06b6d4" },
  { match: "income", emoji: "💰", chip: "bg-emerald-100 dark:bg-emerald-950", bar: "#10b981" },
  { match: "rent", emoji: "🏠", chip: "bg-indigo-100 dark:bg-indigo-950", bar: "#6366f1" },
  { match: "bill", emoji: "🧾", chip: "bg-teal-100 dark:bg-teal-950", bar: "#14b8a6" },
];
const DEFAULT_CATEGORY = {
  emoji: "🏷️",
  chip: "bg-zinc-100 dark:bg-zinc-800",
  bar: "#a1a1aa",
};

function catVisual(name: string) {
  const key = (name || "").toLowerCase();
  return CATEGORY_STYLES.find((c) => key.includes(c.match)) ?? DEFAULT_CATEGORY;
}

export default async function Home({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();
  const tzOffset = await getTzOffset();
  // A grain plus an optional date beats an explicit from/to: picking 3 March
  // with "Week" selected should show that whole week, not just that day.
  const pickedGrain = (["day", "week", "month", "year"] as const).find(
    (g) => g === params.grain
  );
  const pickedDate = params.on ? parseDateParam(params.on, tzOffset) : null;
  const derived =
    pickedGrain || pickedDate
      ? periodContaining(pickedGrain ?? "month", pickedDate ?? new Date(), tzOffset)
      : null;

  const { range, warning } = derived
    ? {
        range: {
          preset: "custom" as const,
          from: derived.from,
          to: derived.to,
          label: derived.label,
        },
        warning: null,
      }
    : parseRangeFromParams(params, new Date(), tzOffset);
  const categoryFilter = params.category ?? null;
  const paymentModeFilter = params.paymentMode ?? null;
  const searchQuery = (params.q ?? "").trim() || null;
  const filtersActive = Boolean(categoryFilter || paymentModeFilter || searchQuery);

  const now = new Date();
  const today = dayRange(now, tzOffset);
  const startOfToday = today.from;
  const endOfToday = today.to;
  const startOfWeek = weekRange(now, tzOffset).from;

  // One concurrent batch instead of three sequential awaits — cuts the
  // per-navigation latency that made tapping the time buttons feel slow.
  const [summary, budgetSummary, momDelta, miscTotalCount, todayAgg, weekAgg] =
    await Promise.all([
      getRangeSummary({
        userId: user.id,
        from: range.from,
        to: range.to,
        categoryFilter,
        paymentModeFilter,
        searchQuery,
        tzOffset,
      }),
      getBudgetProgress(user.id, now, tzOffset),
      getMonthOverMonthDelta(user.id, now, tzOffset),
      prisma.expenseLine.count({
        where: {
          transaction: { userId: user.id },
          category: { userId: user.id, name: "Misc", parentId: null },
        },
      }),
      prisma.transaction.aggregate({
        where: { userId: user.id, type: "debit", occurredAt: { gte: startOfToday, lte: endOfToday } },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: { userId: user.id, type: "debit", occurredAt: { gte: startOfWeek, lte: endOfToday } },
        _sum: { amount: true },
      }),
    ]);
  const todaySpent = Number(todayAgg._sum.amount ?? 0);
  const weekSpent = Number(weekAgg._sum.amount ?? 0);
  const topCategory = summary.byCategory[0] ?? null;

  // Cap the rendered list so wide ranges ("This year") don't paint hundreds of
  // rows. Totals, budget, and the category breakdown above still reflect the
  // full range — only the scrolling list is trimmed to the most recent items.
  // Was 40, which cut a wide range off long before the 500 the query returns —
  // "This year" showed a fortnight of rows and looked like data was missing.
  const LIST_CAP = 500;
  let shownCount = 0;
  const cappedDays: typeof summary.byDay = [];
  // A transaction in its undo window is already gone as far as the list is
  // concerned; the toast below sends the delete.
  // Looked up on its own rather than found in the list, since it may be from
  // a month this view isn't showing; without a toast it would never be sent.
  const pendingDelete = params.deleted
    ? await prisma.transaction.findFirst({
        where: { id: params.deleted, userId: user.id },
        select: { id: true, merchant: true },
      })
    : null;
  for (const day of summary.byDay) {
    if (shownCount >= LIST_CAP) break;
    const txs = day.txs
      .filter((t) => t.id !== pendingDelete?.id)
      .slice(0, LIST_CAP - shownCount);
    if (txs.length === 0) continue;
    cappedDays.push({ ...day, txs });
    shownCount += txs.length;
  }
  const listTruncated = summary.count > shownCount;

  // Which month bar (if any) the current range corresponds to. A range counts
  // as "one month" only when it starts on the 1st and ends on the last day, so
  // an arbitrary custom range doesn't light up a bar it doesn't really match.
  const fromParts = localParts(range.from, tzOffset);
  const toParts = localParts(range.to, tzOffset);
  const nowPartsForRange = localParts(now, tzOffset);
  const sameMonth =
    fromParts.year === toParts.year && fromParts.month === toParts.month;
  const isThisMonth =
    fromParts.year === nowPartsForRange.year &&
    fromParts.month === nowPartsForRange.month;
  // Starts on the 1st and runs either to the month's last day, or — for the
  // month in progress — to today. "This month" means the 1st to today, not the
  // 1st to the 31st, so requiring the last day left the current month's bar
  // unhighlighted on the default view.
  const rangeIsOneMonth =
    sameMonth &&
    fromParts.day === 1 &&
    (toParts.day === daysInLocalMonth(range.from, tzOffset) ||
      (isThisMonth && toParts.day >= nowPartsForRange.day));
  const selectedMonthKey = rangeIsOneMonth
    ? `${fromParts.year}-${String(fromParts.month + 1).padStart(2, "0")}`
    : null;
  const monthBars = summary.monthlyBars.map((b) => ({
    ...b,
    href: monthHref(params, b.monthKey),
  }));
  // The bars are the only month picker on this page, so showing just the last
  // six also decided how far back anyone could look — January and February
  // were unreachable. The window now pages, and lives in the URL so it
  // survives a reload or a share (monthHref copies it through).
  const maxMonthOffset = Math.max(0, monthBars.length - HERO_MONTHS);
  const monthOffset = Math.min(
    Math.max(0, Math.trunc(Number(params.mo)) || 0),
    maxMonthOffset
  );
  const olderMonthsHref =
    monthOffset < maxMonthOffset
      ? buildHref(params, "mo", String(monthOffset + 1))
      : null;
  const newerMonthsHref =
    monthOffset > 0
      ? buildHref(params, "mo", monthOffset > 1 ? String(monthOffset - 1) : null)
      : null;
  const nowParts = localParts(now, tzOffset);
  const isCurrentMonth =
    rangeIsOneMonth &&
    fromParts.year === nowParts.year &&
    fromParts.month === nowParts.month;

  // Which period is being viewed, so it can be stepped through rather than
  // only picked. An arbitrary custom range has no grain; the bar is hidden.
  const grain = grainOfRange(range, tzOffset);
  const period = grain ? periodContaining(grain, range.from, tzOffset) : null;
  const periodHref = (p: { from: Date; to: Date }) =>
    buildRangeHref(params, toDateInput(p.from, tzOffset), toDateInput(p.to, tzOffset));

  // Per-day totals for the calendar and week strip, from the uncapped filtered
  // rows so a heavy month is shaded by everything in it, not the first 500.
  const dayTotals = new Map<number, { spent: number; received: number; count: number }>();
  if (grain === "month" || grain === "week") {
    for (const t of summary.txs) {
      const { day } = localParts(t.occurredAt, tzOffset);
      const cur = dayTotals.get(day) ?? { spent: 0, received: 0, count: 0 };
      if (t.type === "credit") cur.received += t.amount;
      else cur.spent += t.amount;
      cur.count++;
      dayTotals.set(day, cur);
    }
  }
  const dayHref = (d: Date) => {
    const iso = toDateInput(d, tzOffset);
    return buildRangeHref(params, iso, iso);
  };

  // The one or two transactions that explain the total, plus the heaviest day.
  // Never one that's waiting out its undo window.
  const listed = summary.txs.filter((t) => t.id !== pendingDelete?.id);
  const debits = listed.filter((t) => t.type === "debit");
  const credits = listed.filter((t) => t.type === "credit");
  const biggestOut = debits.reduce<TxRow | null>(
    (a, b) => (!a || b.amount > a.amount ? b : a),
    null
  );
  const biggestIn = credits.reduce<TxRow | null>(
    (a, b) => (!a || b.amount > a.amount ? b : a),
    null
  );
  const highlights = [];
  if (biggestOut) {
    highlights.push({
      label: "Biggest spend",
      merchant: biggestOut.merchant,
      amount: biggestOut.amount,
      sub: `${biggestOut.categoryRollupName} · ${dayLabel(biggestOut.occurredAt, tzOffset)}`,
      href: `/transactions/${biggestOut.id}/edit`,
      tone: "out" as const,
    });
  }
  if (biggestIn) {
    highlights.push({
      label: "Biggest received",
      merchant: biggestIn.merchant,
      amount: biggestIn.amount,
      sub: `${biggestIn.categoryRollupName} · ${dayLabel(biggestIn.occurredAt, tzOffset)}`,
      href: `/transactions/${biggestIn.id}/edit`,
      tone: "in" as const,
    });
  }

  return (
    <main className="mx-auto w-full max-w-md px-4 pb-6 pt-[max(1rem,env(safe-area-inset-top))] sm:max-w-lg sm:pt-6">
      <Header name={user.name} image={user.image} />

      <Hero
        monthLabel={isCurrentMonth ? budgetSummary.monthLabel : range.label}
        amount={isCurrentMonth ? momDelta.thisMonth : summary.spentUnfiltered}
        momDelta={momDelta}
        showDelta={isCurrentMonth}
        bars={monthBars}
        selectedMonthKey={selectedMonthKey}
        monthOffset={monthOffset}
        olderMonthsHref={olderMonthsHref}
        newerMonthsHref={newerMonthsHref}
        safe={
          isCurrentMonth && budgetSummary.totalCap > 0
            ? {
                spent: budgetSummary.totalSpent,
                cap: budgetSummary.totalCap,
                daysElapsed: budgetSummary.daysElapsed,
                daysInMonth: budgetSummary.daysInMonth,
              }
            : null
        }
        offerBudget={isCurrentMonth && budgetSummary.totalCap === 0}
      />

      {period ? (
        <PeriodBar
          period={period}
          // Switching size lands on the current one of that size: tapping
          // "Week" means this week, not the week inside whatever month was
          // open. A specific date still comes from the picker or a tapped day.
          grainHref={(g) => `/?grain=${g}`}
        />
      ) : null}

      <SegmentedRange
        activePreset={range.preset}
        fromInput={toDateInput(range.from, tzOffset)}
        toInput={toDateInput(range.to, tzOffset)}
        showPresets={!period}
      />
      <Tip id="custom-range" afterVisits={5} className="mt-2">
        Need a different stretch, like a trip? Pick any From and To dates above.
      </Tip>

      <FlowRow
        label={range.label}
        spent={summary.spent}
        received={summary.received}
        net={summary.total}
      />

      <Highlights items={highlights} />

      {grain === "month" && period ? (
        <CalendarMonth
          monthStart={period.from}
          tzOffset={tzOffset}
          days={[...dayTotals.entries()].map(([day, v]) => ({
            day,
            ...v,
            href: dayHref(
              new Date(period.from.getTime() + (day - 1) * 86400000)
            ),
          }))}
        />
      ) : null}

      {grain === "week" && period ? (
        <WeekStrip
          weekStart={period.from}
          tzOffset={tzOffset}
          days={Array.from({ length: 7 }, (_, i) => {
            const d = new Date(period.from.getTime() + i * 86400000);
            const day = localParts(d, tzOffset).day;
            const v = dayTotals.get(day) ?? { spent: 0, received: 0, count: 0 };
            return { day, ...v, href: dayHref(d) };
          })}
        />
      ) : null}

      <section className="mt-3 grid grid-cols-2 gap-3">
        <MiniTile
          label="Spent this week"
          value={weekSpent > 0 ? formatINR(weekSpent) : "—"}
          href="/?range=week"
        />
        <MiniTile
          label={topCategory ? `Top · ${topCategory.name}` : "Top category"}
          value={topCategory ? formatINR(topCategory.amount) : "—"}
          href={topCategory ? `/?category=${encodeURIComponent(topCategory.name)}` : "/"}
        />
      </section>


      {params.status === "recategorized" ? (
        <Banner tone="ok">
          Re-categorized {params.misc} · {params.byRule} by rule, {params.byLlm} by
          AI, {params.unchanged} left.
          {params.rateLimited === "1" ? " Hit the rate limit — tap again in a minute." : ""}
        </Banner>
      ) : null}
      {/* What the app just learned from a correction. Worth saying out loud:
          a correction that produces silence reads as one that didn't take, and
          the whole point of the rules is that they compound. */}
      {params.learnedCategory || params.learnedName ? (
        <Banner tone="ok">
          <span className="font-medium">Got it.</span>{" "}
          {params.learnedCategory ? (
            <>
              I&rsquo;ll file {params.merchant ?? "this merchant"} under{" "}
              <strong>{params.learnedCategory}</strong> from now on
              {Number(params.ruleApplied ?? "0") > 0 ? (
                <>
                  {" "}
                  — and I updated {params.ruleApplied} earlier one
                  {params.ruleApplied === "1" ? "" : "s"}
                </>
              ) : null}
              .{" "}
            </>
          ) : null}
          {params.learnedName ? (
            <>
              I&rsquo;ll show &ldquo;{params.learnedName}&rdquo; as{" "}
              <strong>{params.merchant}</strong> from now on
              {Number(params.renamed ?? "0") > 0 ? (
                <>
                  {" "}
                  — and renamed {params.renamed} earlier one
                  {params.renamed === "1" ? "" : "s"}
                </>
              ) : null}
              .
            </>
          ) : null}
        </Banner>
      ) : params.ruleApplied && Number(params.ruleApplied) > 0 ? (
        <Banner tone="ok">
          Rule applied to {params.ruleApplied} existing transaction
          {params.ruleApplied === "1" ? "" : "s"}.
        </Banner>
      ) : null}
      {params.status === "err" ? (
        <Banner tone="err">{params.error ?? "Something went wrong."}</Banner>
      ) : null}
      {warning ? <Banner tone="warn">{warning}</Banner> : null}

      {miscTotalCount > 0 ? (
        <form action={recategorizeMiscAction} className="mt-3">
          <SubmitButton
            pendingText="Re-categorizing…"
            className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:cursor-wait disabled:opacity-70 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
          >
            <span aria-hidden>✨</span> Re-categorize {miscTotalCount} Misc
          </SubmitButton>
        </form>
      ) : null}

      {filtersActive ? (
        <FilterChips
          category={categoryFilter}
          paymentMode={paymentModeFilter}
          search={searchQuery}
          params={params}
        />
      ) : null}

      {summary.byCategory.length > 0 ? (
        <CategoryBreakdown
          data={summary.byCategory}
          total={summary.spentUnfiltered}
          activeCategory={categoryFilter}
          params={params}
        />
      ) : null}

      <SearchPill defaultValue={searchQuery ?? ""} params={params} />

      <section className="mt-5">
        <h2 className="mb-2 px-1 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Transactions
        </h2>
        <Tip id="ask" afterVisits={3} className="mb-3">
          Questions like &ldquo;How much did I spend on food this month?&rdquo;
          get a straight answer in{" "}
          <Link href="/ask" className="font-semibold underline underline-offset-2">
            Ask
          </Link>
          .
        </Tip>
        {cappedDays.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-4">
            {cappedDays.map((day) => (
              <div key={day.date.toISOString()}>
                <div className="mb-1 flex items-baseline justify-between px-1">
                  <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    {day.label}
                  </span>
                  <span className="text-xs text-zinc-400">
                    {formatINR(day.spent)}
                    {day.received > 0 ? (
                      <span className="text-emerald-600 dark:text-emerald-400">
                        {" "}
                        · +{formatINR(day.received)}
                      </span>
                    ) : null}
                  </span>
                </div>
                <div className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white dark:border-zinc-800 dark:bg-zinc-900/40">
                  {day.txs.map((t, i) => (
                    <TxItem
                      key={t.id}
                      t={t}
                      last={i === day.txs.length - 1}
                      tzOffset={tzOffset}
                    />
                  ))}
                </div>
              </div>
            ))}
            {listTruncated ? (
              <p className="px-1 pt-1 text-center text-xs text-zinc-400">
                Showing the most recent {shownCount} of {summary.count} — narrow
                the range to see all.
              </p>
            ) : null}
          </div>
        )}
      </section>

      {pendingDelete ? (
        <UndoDelete
          key={pendingDelete.id}
          id={pendingDelete.id}
          merchant={pendingDelete.merchant}
        />
      ) : null}
    </main>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function Header({ name, image }: { name: string | null; image: string | null }) {
  const first = name?.split(" ")[0] ?? null;
  const initials = (name ?? "?")
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <header className="mb-4 flex items-center justify-between">
      <div>
        <div className="text-sm text-zinc-500 dark:text-zinc-400">{greeting()}</div>
        <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          {first ?? "there"}
        </div>
      </div>
      <Link
        href="/settings"
        aria-label="Settings"
        className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-zinc-100 text-sm font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
      >
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="" className="h-full w-full object-cover" />
        ) : (
          initials
        )}
      </Link>
    </header>
  );
}

function Hero({
  monthLabel,
  amount,
  momDelta,
  showDelta,
  bars,
  selectedMonthKey,
  monthOffset,
  olderMonthsHref,
  newerMonthsHref,
  safe,
  offerBudget,
}: {
  monthLabel: string;
  /** Total for whatever range is showing — not necessarily this month. */
  amount: number;
  momDelta: MomDelta;
  /** "vs last month" only means something while viewing the current month. */
  showDelta: boolean;
  /** Each month plus the link that selects it, resolved by the caller. */
  bars: Array<MonthlyBar & { href: string }>;
  /** Which bar reads as chosen, or null when the range isn't one month. */
  selectedMonthKey: string | null;
  /** How many months back the visible window is paged; 0 = the newest six. */
  monthOffset: number;
  /** Steps the window one month further back, or null at the oldest bar. */
  olderMonthsHref: string | null;
  /** Steps it back toward the present, or null when already there. */
  newerMonthsHref: string | null;
  /** This month against its budgets, when the current month has any. */
  safe: SafeInput | null;
  /** No budgets yet: say what one would unlock, quietly. */
  offerBudget: boolean;
}) {
  const hasDelta =
    showDelta && momDelta.deltaPercent !== null && momDelta.lastMonth > 0;
  const up = (momDelta.deltaPercent ?? 0) > 0;
  const pct = hasDelta ? Math.abs(Math.round((momDelta.deltaPercent ?? 0) * 100)) : 0;
  // Scaled across all twelve months, not just the visible six, so a bar's
  // height means the same thing whichever window you are looking at.
  const max = Math.max(1, ...bars.map((b) => b.total));
  // Six at a time rather than twelve: on a phone, twelve bars leaves each one
  // narrower than a fingertip, and a bar you cannot reliably hit is worse than
  // one that isn't there. The arrows reach the rest.
  const windowEnd = bars.length - monthOffset;
  const recent = bars.slice(Math.max(0, windowEnd - HERO_MONTHS), windowEnd);

  return (
    <section className="relative isolate overflow-hidden rounded-3xl border border-zinc-200/60 bg-gradient-to-br from-white to-zinc-50 p-5 shadow-sm dark:border-zinc-800/70 dark:from-zinc-900 dark:to-zinc-950">
      <div className="hero-aurora" aria-hidden />
      <div className="relative">
        {safe ? <SafeToSpend {...safe} /> : null}
        <div
          className={
            "text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400" +
            (safe ? " mt-4" : "")
          }
        >
          Spent in {monthLabel}
        </div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
          <span
            className={
              "font-bold tabular-nums tracking-tight text-zinc-900 dark:text-zinc-50 " +
              (safe ? "text-2xl" : "text-4xl")
            }
          >
            ₹<AnimatedNumber value={Math.round(amount)} />
          </span>
          {hasDelta ? (
            <span
              className={
                "whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums " +
                (up
                  ? "bg-red-500/15 text-red-700 dark:text-red-300"
                  : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300")
              }
              title={`Last month: ${formatINR(momDelta.lastMonth)}`}
            >
              {up ? "↑" : "↓"} {pct}% vs last month
            </span>
          ) : null}
        </div>
        {offerBudget ? (
          <Link
            href="/settings/budgets"
            className="mt-1 inline-block text-xs text-zinc-500 underline decoration-zinc-300 underline-offset-4 dark:text-zinc-400 dark:decoration-zinc-600"
          >
            Set a budget to see what&rsquo;s safe to spend each day
          </Link>
        ) : null}

        {/* Tapping a month narrows the whole page to it — the totals, the pie,
            "Where it went" and the list all follow. Links rather than buttons
            so the choice is in the URL and survives a reload or a share.

            Deliberately plain utility classes: a fancier set (group-hover,
            slash-opacity backgrounds) coincided with the dashboard hanging on
            its loading state during testing, and month selection is not worth
            risking the page for a hover tint. */}
        <nav className="mt-4 flex items-end gap-1.5" aria-label="Spending by month">
          <MonthPager href={olderMonthsHref} direction="older" />
          {recent.map((b) => {
            const on = b.monthKey === selectedMonthKey;
            return (
              <Link
                key={b.monthKey}
                href={b.href}
                aria-current={on ? "true" : undefined}
                title={`${b.label}: ${formatINR(b.total)}`}
                className="flex min-h-[44px] flex-1 flex-col justify-end gap-1 rounded-lg p-1"
              >
                <span
                  className={
                    on
                      ? "block w-full rounded-t-md bg-zinc-900 dark:bg-zinc-100"
                      : "block w-full rounded-t-md bg-zinc-200 dark:bg-zinc-700"
                  }
                  style={{ height: `${Math.max(6, (b.total / max) * 40)}px` }}
                />
                <span
                  className={
                    on
                      ? "block text-center text-[10px] font-semibold leading-none text-zinc-900 dark:text-zinc-100"
                      : "block text-center text-[10px] leading-none text-zinc-400 dark:text-zinc-500"
                  }
                >
                  {b.label}
                </span>
              </Link>
            );
          })}
          <MonthPager href={newerMonthsHref} direction="newer" />
        </nav>
        <Tip id="month-bars" afterVisits={2} className="mt-3">
          Tap a month to see just that month. Totals, categories and the list
          all follow.
        </Tip>
      </div>
    </section>
  );
}

type SafeInput = {
  spent: number;
  cap: number;
  daysElapsed: number;
  daysInMonth: number;
};

/**
 * What can still go out today without breaking the month's budget: what's
 * left, shared evenly over the days left (today included). It answers the
 * question people open a tracker with, "am I okay?", where the spent total
 * only answers "how much?".
 *
 * Amber once the daily share falls under a fifth of a normal day's, red once
 * the budget is gone. The same rule as the iOS app, so the two never disagree.
 * The tick on the ring is where spending would be at an even pace.
 */
function SafeToSpend({ spent, cap, daysElapsed, daysInMonth }: SafeInput) {
  const left = cap - spent;
  const daysLeft = Math.max(1, daysInMonth - daysElapsed + 1);
  const perDay = left / daysLeft;
  const over = left <= 0;
  const tight = !over && perDay < (0.2 * cap) / daysInMonth;
  const used = Math.min(1, spent / cap);
  const pace = Math.min(1, daysElapsed / daysInMonth);
  const tone = over
    ? "text-red-600 dark:text-red-400"
    : tight
      ? "text-amber-600 dark:text-amber-400"
      : "text-zinc-900 dark:text-zinc-50";
  // Ring geometry: r=26 gives a 163.4px circumference.
  const C = 2 * Math.PI * 26;
  const tickAngle = pace * 360 - 90;

  return (
    <Link
      href="/settings/budgets"
      className="flex items-center justify-between gap-4"
      aria-label={
        over
          ? `${formatINR(-left)} over this month's ${formatINR(cap)} budget`
          : `Safe to spend today: ${formatINR(perDay)}. ${formatINR(left)} left of ${formatINR(cap)} for ${daysLeft} days.`
      }
    >
      <div className="min-w-0">
        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
          {over ? "Over budget" : "Safe to spend today"}
        </div>
        <div className={"mt-1 text-4xl font-bold tabular-nums tracking-tight " + tone}>
          ₹<AnimatedNumber value={Math.round(over ? -left : perDay)} />
          {over ? <span className="ml-1.5 text-base font-semibold">over</span> : null}
        </div>
        <div className="mt-1 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
          {over
            ? `Budget ${formatINR(cap)} · resets on the 1st`
            : `${formatINR(left)} left of ${formatINR(cap)} · ${daysLeft} ${daysLeft === 1 ? "day" : "days"} to go`}
        </div>
      </div>
      <svg width="64" height="64" viewBox="0 0 64 64" className="shrink-0" aria-hidden>
        <circle cx="32" cy="32" r="26" fill="none" strokeWidth="6" className="stroke-zinc-200 dark:stroke-zinc-800" />
        <circle
          cx="32"
          cy="32"
          r="26"
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${used * C} ${C}`}
          transform="rotate(-90 32 32)"
          className={"transition-[stroke-dasharray] duration-700 " + (over ? "stroke-red-500" : tight ? "stroke-amber-500" : "stroke-blue-500")}
        />
        <line
          x1="32"
          y1="3"
          x2="32"
          y2="11"
          strokeWidth="2"
          transform={`rotate(${tickAngle + 90} 32 32)`}
          className="stroke-zinc-400 dark:stroke-zinc-500"
        />
        <text x="32" y="36" textAnchor="middle" className="fill-zinc-500 text-[11px] tabular-nums dark:fill-zinc-400">
          {Math.round(used * 100)}%
        </text>
      </svg>
    </Link>
  );
}

/**
 * One step of the hero's month window. Rendered as an inert span at either end
 * rather than hidden, so the bars don't shift sideways when you reach the edge.
 */
function MonthPager({
  href,
  direction,
}: {
  href: string | null;
  direction: "older" | "newer";
}) {
  const older = direction === "older";
  const label = older ? "Earlier months" : "Later months";
  // h-11 is 44px — the same tap target the bars themselves get.
  const base =
    "flex h-11 w-7 shrink-0 items-center justify-center rounded-lg text-lg leading-none";
  if (!href) {
    return (
      <span aria-hidden className={`${base} text-zinc-300 dark:text-zinc-700`}>
        {older ? "\u2039" : "\u203a"}
      </span>
    );
  }
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className={`${base} text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800`}
    >
      {older ? "\u2039" : "\u203a"}
    </Link>
  );
}

/**
 * What went out, what came in, and the difference, for whichever range is
 * selected. The hero only ever showed spending, so money arriving — a refund,
 * a reversal, someone settling up — was invisible unless you scrolled the list
 * and noticed a green row.
 *
 * These three follow the active filters, so they always describe the same set
 * of transactions as the list below them.
 */
function FlowRow({
  label,
  spent,
  received,
  net,
}: {
  label: string;
  spent: number;
  received: number;
  /** spent − received. Negative means more came in than went out. */
  net: number;
}) {
  // Reading "net −₹2,000" as a loss and "net +₹2,000" as a gain is the way
  // round people expect, so the sign is flipped from the stored value.
  const inProfit = net < 0;
  const netText = `${inProfit ? "+" : "−"} ${formatINR(Math.abs(net))}`;
  return (
    <section
      className="mt-3 flex items-stretch rounded-2xl border border-zinc-200/80 bg-white py-3 dark:border-zinc-800 dark:bg-zinc-900/40"
      aria-label={`Spent, received and net for ${label}`}
    >
      <FlowCell label="Spent" value={`− ${formatINR(spent)}`} />
      <span className="w-px self-stretch bg-zinc-200 dark:bg-zinc-800" aria-hidden />
      <FlowCell
        label="Received"
        value={`+ ${formatINR(received)}`}
        tone={received > 0 ? "in" : undefined}
      />
      <span className="w-px self-stretch bg-zinc-200 dark:bg-zinc-800" aria-hidden />
      <FlowCell label="Net" value={netText} tone={inProfit ? "in" : undefined} />
    </section>
  );
}

function FlowCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "in";
}) {
  return (
    <div className="min-w-0 flex-1 px-1.5 text-center sm:px-2">
      <div className="text-[11px] text-zinc-500 dark:text-zinc-400">{label}</div>
      {/* A lakh-plus figure with a sign in front is wider than a third of a
          375pt screen, and wrapping split "− ₹1,54,938.18" across two lines.
          Kept on one line and allowed to step down a size instead. */}
      <div
        className={
          "mt-0.5 whitespace-nowrap text-[13px] font-semibold tabular-nums sm:text-sm " +
          (tone === "in"
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-zinc-900 dark:text-zinc-50")
        }
      >
        {value}
      </div>
    </div>
  );
}

function MiniTile({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-2xl border border-zinc-200/80 bg-white p-3.5 transition-colors hover:border-zinc-300 active:scale-[0.98] dark:border-zinc-800 dark:bg-zinc-900/40"
    >
      <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
        {value}
      </div>
    </Link>
  );
}

function CategoryBreakdown({
  data,
  total,
  activeCategory,
  params,
}: {
  data: CategorySlice[];
  total: number;
  activeCategory: string | null;
  params: Record<string, string | undefined>;
}) {
  const top = data.slice(0, 5);
  return (
    <section className="mt-5 rounded-2xl border border-zinc-200/80 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
      <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        Where it went
      </h2>
      <div className="space-y-3">
        {top.map((c) => {
          const v = catVisual(c.name);
          const w = total > 0 ? Math.max(3, (c.amount / total) * 100) : 0;
          const active = activeCategory === c.name;
          const href = buildHref(params, "category", active ? null : c.name);
          return (
            <Link key={c.name} href={href} className="block">
              <div className="mb-1 flex items-center justify-between text-[13px]">
                <span
                  className={
                    "flex items-center gap-1.5 " +
                    (active
                      ? "font-medium text-zinc-900 dark:text-zinc-50"
                      : "text-zinc-600 dark:text-zinc-300")
                  }
                >
                  <span aria-hidden>{v.emoji}</span>
                  {c.name}
                </span>
                <span className="font-medium tabular-nums text-zinc-900 dark:text-zinc-50">
                  {formatINR(c.amount)}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${w}%`, backgroundColor: v.bar }}
                />
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function SearchPill({
  defaultValue,
  params,
}: {
  defaultValue: string;
  params: Record<string, string | undefined>;
}) {
  const preserved = Object.entries(params).filter(
    ([k, val]) => k !== "q" && typeof val === "string" && val.length > 0
  );
  return (
    <form method="GET" action="/" className="mt-5">
      <div className="flex items-center gap-2 rounded-full border border-zinc-200/80 bg-white px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-900/40">
        <span aria-hidden className="text-zinc-400">
          🔍
        </span>
        <input
          type="search"
          name="q"
          defaultValue={defaultValue}
          placeholder="Search merchant, note, category…"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-400 dark:text-zinc-50"
          autoComplete="off"
        />
        {preserved.map(([name, val]) => (
          <input key={name} type="hidden" name={name} value={val as string} />
        ))}
      </div>
    </form>
  );
}

function TxItem({
  t,
  last,
  tzOffset,
}: {
  t: TxRow;
  last: boolean;
  tzOffset: number;
}) {
  const isCredit = t.type === "credit";
  const v = catVisual(t.categoryRollupName);
  return (
    <Link
      href={`/transactions/${t.id}/edit`}
      className={
        "flex items-center gap-3 px-3.5 py-3 transition-colors hover:bg-zinc-50 active:bg-zinc-100 dark:hover:bg-zinc-800/50 dark:active:bg-zinc-800 " +
        (last ? "" : "border-b border-zinc-100 dark:border-zinc-800/70")
      }
    >
      <span
        className={
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg " +
          (isCredit ? "bg-emerald-100 dark:bg-emerald-950" : v.chip)
        }
        aria-hidden
      >
        {isCredit ? "💸" : v.emoji}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
          {t.merchant}
        </div>
        <div className="truncate text-xs text-zinc-400">
          {t.categoryRollupName} · {paymentModeLabel(t.paymentMode)}
          {t.timeKnown ? ` · ${clockTime(t.occurredAt, tzOffset)}` : null}
        </div>
      </div>
      <div
        className={
          "shrink-0 text-sm font-semibold tabular-nums " +
          (isCredit
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-zinc-900 dark:text-zinc-50")
        }
      >
        {isCredit ? "+ " : "− "}
        {formatINR(t.amount)}
      </div>
    </Link>
  );
}

function FilterChips({
  category,
  paymentMode,
  search,
  params,
}: {
  category: string | null;
  paymentMode: string | null;
  search: string | null;
  params: Record<string, string | undefined>;
}) {
  const chips: Array<{ label: string; remove: string }> = [];
  if (search) chips.push({ label: `“${search}”`, remove: "q" });
  if (category) chips.push({ label: category, remove: "category" });
  if (paymentMode) chips.push({ label: paymentModeLabel(paymentMode), remove: "paymentMode" });
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {chips.map((c) => (
        <Link
          key={c.remove}
          href={buildHref(params, c.remove, null)}
          className="inline-flex items-center gap-1.5 rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white dark:bg-zinc-50 dark:text-zinc-900"
        >
          {c.label}
          <span aria-hidden>×</span>
        </Link>
      ))}
    </div>
  );
}

/**
 * Link to a whole calendar month, keeping any active filters.
 *
 * Expressed as from/to rather than a preset because the presets only cover
 * today/week/month/year — there is no "March" preset — and parseRangeFromParams
 * already treats an explicit from/to as a custom range.
 */
function monthHref(
  params: Record<string, string | undefined>,
  monthKey: string
): string {
  const [year, month] = monthKey.split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    // `range` would otherwise win over from/to on the next render.
    if (v && k !== "range" && k !== "from" && k !== "to") next.set(k, v);
  }
  next.set("from", `${monthKey}-01`);
  next.set("to", `${monthKey}-${String(last).padStart(2, "0")}`);
  return `/?${next.toString()}`;
}

/** YYYY-MM-DD from the picker, read in the viewer's timezone. */
function parseDateParam(raw: string, tz: number): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return null;
  const d = periodContaining(
    "day",
    new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)),
    tz
  ).from;
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A link to an explicit from/to range, keeping filters but dropping preset. */
function buildRangeHref(
  params: Record<string, string | undefined>,
  from: string,
  to: string
): string {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v && k !== "range" && k !== "from" && k !== "to") next.set(k, v);
  }
  next.set("from", from);
  next.set("to", to);
  return `/?${next.toString()}`;
}

/** "12 Aug" — enough to place a transaction without repeating the year. */
function dayLabel(d: Date, tz: number): string {
  const { month, day } = localParts(d, tz);
  return `${day} ${MONTHS_SHORT[month]}`;
}

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function buildHref(
  params: Record<string, string | undefined>,
  key: string,
  value: string | null
): string {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v && k !== key) next.set(k, v);
  }
  if (value) next.set(key, value);
  const qs = next.toString();
  return qs ? `/?${qs}` : "/";
}

function Banner({
  tone,
  children,
}: {
  tone: "ok" | "err" | "warn";
  children: React.ReactNode;
}) {
  const cls =
    tone === "ok"
      ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
      : tone === "err"
        ? "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200";
  return (
    <div className={`mt-3 rounded-xl border px-3 py-2 text-sm ${cls}`}>{children}</div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-8 text-center dark:border-zinc-700 dark:bg-zinc-900/40">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        No transactions in this range.
      </p>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-500">
        Get started in whichever way suits you:
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Link href="/settings/email" className="btn-primary">
          Connect an inbox
        </Link>
        <Link href="/settings/import" className="btn-secondary">
          Upload a statement
        </Link>
      </div>
      <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-500">
        Or add a transaction by hand with the + button.
      </p>
    </div>
  );
}
