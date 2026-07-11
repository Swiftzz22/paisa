import Link from "next/link";
import { getCurrentUser } from "@/lib/user";
import { prisma } from "@/lib/prisma";
import { formatINR } from "@/lib/format";
import { paymentModeLabel } from "@/lib/categories";
import { parseRangeFromParams, toDateInput, type RangePresetId } from "@/lib/range";
import { getRangeSummary, type TxRow } from "@/lib/spending";
import {
  CategoryPie,
  PaymentPie,
  MonthlyTrendBar,
} from "@/components/charts/SpendingCharts";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { recategorizeMiscAction } from "@/lib/actions";
import { SubmitButton } from "@/components/SubmitButton";
import {
  getBudgetProgress,
  getMonthOverMonthDelta,
  type BudgetProgress,
} from "@/lib/budgets";

export const dynamic = "force-dynamic";
// Recategorize (Gemini, batched) can run past the default ~10s function cap;
// give server actions invoked from this page more headroom.
export const maxDuration = 60;

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
  merchant?: string;
  q?: string;
}>;

export default async function Home({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();
  const { range, warning } = parseRangeFromParams(params);
  const categoryFilter = params.category ?? null;
  const paymentModeFilter = params.paymentMode ?? null;
  const searchQuery = (params.q ?? "").trim() || null;
  const [summary, budgetSummary, momDelta] = await Promise.all([
    getRangeSummary({
      userId: user.id,
      from: range.from,
      to: range.to,
      categoryFilter,
      paymentModeFilter,
      searchQuery,
    }),
    getBudgetProgress(user.id),
    getMonthOverMonthDelta(user.id),
  ]);

  const filtersActive = Boolean(categoryFilter || paymentModeFilter || searchQuery);
  const paymentModeLabelForChip = paymentModeFilter
    ? paymentModeLabel(paymentModeFilter)
    : "";

  // Count Misc transactions across ALL time (independent of range) to decide
  // whether to surface the "Re-categorize Misc" button.
  const miscTotalCount = await prisma.expenseLine.count({
    where: {
      transaction: { userId: user.id },
      category: { userId: user.id, name: "Misc", parentId: null },
    },
  });

  // Quick-glance totals for the hero tiles (always reflect "today" / "this
  // week", independent of the user's chosen range filter — they're a snapshot,
  // not a drill-down).
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const dayOfWeek = now.getDay(); // Sun=0
  const weekOffset = (dayOfWeek + 6) % 7; // Mon=0..Sun=6
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - weekOffset);
  const [todayAgg, weekAgg] = await Promise.all([
    prisma.transaction.aggregate({
      where: {
        userId: user.id,
        type: "debit",
        occurredAt: { gte: startOfToday, lte: endOfToday },
      },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: {
        userId: user.id,
        type: "debit",
        occurredAt: { gte: startOfWeek, lte: endOfToday },
      },
      _sum: { amount: true },
    }),
  ]);
  const todaySpent = Number(todayAgg._sum.amount ?? 0);
  const weekSpent = Number(weekAgg._sum.amount ?? 0);
  const topCategory = summary.byCategory[0] ?? null;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
      <nav className="mb-5 flex items-center justify-between gap-3 text-sm">
        <Link
          href="/"
          className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
        >
          paisa<span className="text-zinc-400 dark:text-zinc-500">.</span>
        </Link>
        {/* Desktop-only top links; mobile uses the fixed bottom nav. */}
        <div className="hidden items-center gap-3 sm:flex">
          <Link
            href="/inbox"
            className="text-zinc-600 hover:underline dark:text-zinc-400"
          >
            Inbox
          </Link>
          <Link
            href="/rules"
            className="text-zinc-600 hover:underline dark:text-zinc-400"
          >
            Rules
          </Link>
          <Link
            href="/settings"
            className="text-zinc-600 hover:underline dark:text-zinc-400"
          >
            Settings
          </Link>
          <Link href="/transactions/new" className="btn-primary">
            + Add
          </Link>
        </div>
      </nav>

      <Hero
        monthLabel={budgetSummary.monthLabel}
        thisMonth={momDelta.thisMonth}
        lastMonth={momDelta.lastMonth}
        deltaPercent={momDelta.deltaPercent}
        todaySpent={todaySpent}
        weekSpent={weekSpent}
        topCategoryName={topCategory?.name ?? null}
        topCategoryAmount={topCategory?.amount ?? 0}
        budget={
          budgetSummary.totalCap > 0
            ? {
                spent: budgetSummary.totalSpent,
                cap: budgetSummary.totalCap,
                daysElapsed: budgetSummary.daysElapsed,
                daysInMonth: budgetSummary.daysInMonth,
              }
            : null
        }
      />

      {budgetSummary.progress.length > 0 ? (
        <section className="mb-6 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Budget progress · {budgetSummary.monthLabel}
            </h2>
            <Link
              href="/settings/budgets"
              className="text-xs text-zinc-500 hover:underline dark:text-zinc-400"
            >
              Manage
            </Link>
          </div>
          <ul className="space-y-2.5">
            {budgetSummary.progress.map((p) => (
              <BudgetMiniRow key={p.budgetId} p={p} />
            ))}
          </ul>
        </section>
      ) : null}

      <SearchBar
        defaultValue={searchQuery ?? ""}
        preservedParams={preservedSearchParams(params)}
      />

      <RangePicker activePreset={range.preset} from={range.from} to={range.to} />

      {params.ruleApplied && Number(params.ruleApplied) > 0 ? (
        <div className="mb-4 rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-200">
          Rule saved and applied retroactively to {params.ruleApplied} existing
          transaction{params.ruleApplied === "1" ? "" : "s"}
          {params.merchant
            ? ` matching "${decodeURIComponent(params.merchant)}"`
            : ""}
          .
        </div>
      ) : null}
      {params.status === "recategorized" ? (
        <div className="mb-4 rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-200">
          Re-categorized {params.misc} Misc transaction
          {params.misc === "1" ? "" : "s"} (
          {params.merchants} unique merchant
          {params.merchants === "1" ? "" : "s"}): {params.byRule} by rule,{" "}
          {params.byLlm} by AI, {params.unchanged} still need attention.
          {params.rateLimited === "1" ? (
            <> Hit rate limit mid-run — click again in a minute to continue.</>
          ) : null}
        </div>
      ) : null}
      {params.status === "err" ? (
        <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {params.error ?? "Something went wrong."}
        </div>
      ) : null}

      {miscTotalCount > 0 ? (
        <form action={recategorizeMiscAction} className="mb-4">
          <SubmitButton
            pendingText="Re-categorizing…"
            className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:cursor-wait disabled:opacity-70 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200 dark:hover:bg-amber-900/40"
            title="Send each unique Misc merchant through your rules + Gemini for a better category."
          >
            <span aria-hidden>✨</span>
            Re-categorize {miscTotalCount} Misc transaction
            {miscTotalCount === 1 ? "" : "s"}
          </SubmitButton>
        </form>
      ) : null}

      {warning ? (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {warning}
        </div>
      ) : null}

      {filtersActive ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-zinc-500">
            Filters:
          </span>
          {searchQuery ? (
            <FilterChip
              label={`Search: "${searchQuery}"`}
              params={params}
              removeKey="q"
            />
          ) : null}
          {categoryFilter ? (
            <FilterChip
              label={`Category: ${categoryFilter}`}
              params={params}
              removeKey="category"
            />
          ) : null}
          {paymentModeFilter ? (
            <FilterChip
              label={`Paid via: ${paymentModeLabelForChip}`}
              params={params}
              removeKey="paymentMode"
            />
          ) : null}
        </div>
      ) : null}

      <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label={filtersActive ? "Filtered spent" : "Spent"}
          value={
            filtersActive
              ? `${formatINR(summary.spent)} / ${formatINR(summary.spentUnfiltered)}`
              : formatINR(summary.spent)
          }
        />
        <Stat
          label="Received"
          value={formatINR(summary.received)}
          tone={summary.received > 0 ? "good" : "neutral"}
        />
        <Stat
          label="Net"
          value={formatINR(summary.total)}
          tone={summary.total < 0 ? "good" : "neutral"}
        />
        <Stat
          label="Transactions"
          value={
            filtersActive
              ? `${summary.count} / ${summary.countUnfiltered}`
              : String(summary.count)
          }
        />
      </section>

      {summary.countUnfiltered > 0 ? (
        <section className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          <ChartCard title="By category">
            <p className="-mt-1 mb-2 text-[11px] text-zinc-500">
              Tap a label below to filter the list.
            </p>
            <CategoryPie
              data={summary.byCategory}
              activeCategory={categoryFilter}
            />
          </ChartCard>
          <ChartCard title="By payment mode">
            <p className="-mt-1 mb-2 text-[11px] text-zinc-500">
              Tap a label below to filter the list.
            </p>
            <PaymentPie
              data={summary.byPaymentMode}
              activeMode={paymentModeFilter}
            />
          </ChartCard>
        </section>
      ) : null}

      <section className="mb-6">
        <ChartCard title="Last 12 months">
          <MonthlyTrendBar data={summary.monthlyBars} />
        </ChartCard>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Transactions
        </h2>
        {summary.listTruncated ? (
          <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
            Showing the {summary.listShown} most recent of {summary.count}.
            Narrow the date range or search to see the rest — totals and charts
            above still cover the full range.
          </p>
        ) : null}
        {summary.byDay.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-4">
            {summary.byDay.map((day) => (
              <div
                key={day.date.toISOString()}
                className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
              >
                <header className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-900">
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">
                    {day.label}
                  </span>
                  <span className="text-zinc-600 dark:text-zinc-400">
                    {day.count} tx ·{" "}
                    {day.received > 0 ? (
                      <>
                        <span className="text-zinc-900 dark:text-zinc-50">
                          {formatINR(day.spent)}
                        </span>{" "}
                        <span className="text-green-700 dark:text-green-400">
                          −{formatINR(day.received)}
                        </span>{" "}
                        <strong className="text-zinc-900 dark:text-zinc-50">
                          = {formatINR(day.total)}
                        </strong>
                      </>
                    ) : (
                      <strong className="text-zinc-900 dark:text-zinc-50">
                        {formatINR(day.spent)}
                      </strong>
                    )}
                  </span>
                </header>
                <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {day.txs.map((t) => {
                    const isCredit = t.type === "credit";
                    return (
                      <li key={t.id}>
                        <Link
                          href={`/transactions/${t.id}/edit`}
                          className="flex min-h-[56px] items-center justify-between gap-3 px-4 py-3 hover:bg-zinc-50 active:bg-zinc-100 dark:hover:bg-zinc-900 dark:active:bg-zinc-800"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                              {t.merchant}
                            </div>
                            <div className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
                              {categoryDisplay(t)} · {paymentModeLabel(t.paymentMode)}
                              {isCredit ? " · credit" : null}
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div
                              className={
                                "font-semibold tabular-nums " +
                                (isCredit
                                  ? "text-green-700 dark:text-green-400"
                                  : "text-zinc-900 dark:text-zinc-50")
                              }
                            >
                              {isCredit ? "+ " : ""}
                              {formatINR(t.amount)}
                            </div>
                            {t.source !== "manual" ? (
                              <div className="mt-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
                                from {t.source}
                              </div>
                            ) : null}
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function categoryDisplay(t: TxRow): string {
  if (t.categoryParentName && t.categoryLeafName) {
    return `${t.categoryParentName} › ${t.categoryLeafName}`;
  }
  return t.categoryRollupName;
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good";
}) {
  const valCls =
    tone === "good"
      ? "text-green-700 dark:text-green-400"
      : "text-zinc-900 dark:text-zinc-50";
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold tabular-nums ${valCls}`}>
        {value}
      </div>
    </div>
  );
}

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h3 className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {title}
      </h3>
      {children}
    </div>
  );
}

function RangePicker({
  activePreset,
  from,
  to,
}: {
  activePreset: RangePresetId;
  from: Date;
  to: Date;
}) {
  const presets: { id: RangePresetId; label: string }[] = [
    { id: "today", label: "Today" },
    { id: "week", label: "This week" },
    { id: "month", label: "This month" },
    { id: "year", label: "This year" },
  ];

  return (
    <div className="mb-5 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-wrap items-center gap-1.5">
        {presets.map((p) => {
          const active = activePreset === p.id;
          return (
            <Link
              key={p.id}
              href={`/?range=${p.id}`}
              className={
                "inline-flex min-h-[32px] items-center rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors " +
                (active
                  ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                  : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 active:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700")
              }
            >
              {p.label}
            </Link>
          );
        })}
      </div>
      <form
        method="GET"
        action="/"
        className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_auto]"
      >
        <label className="flex flex-col">
          <span className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">
            From
          </span>
          <input
            key={`from-${activePreset}-${toDateInput(from)}`}
            type="date"
            name="from"
            defaultValue={toDateInput(from)}
            className="input"
          />
        </label>
        <label className="flex flex-col">
          <span className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">
            To
          </span>
          <input
            key={`to-${activePreset}-${toDateInput(to)}`}
            type="date"
            name="to"
            defaultValue={toDateInput(to)}
            className="input"
          />
        </label>
        <button type="submit" className="btn-secondary self-end">
          Apply
        </button>
      </form>
    </div>
  );
}

function Hero({
  monthLabel,
  thisMonth,
  lastMonth,
  deltaPercent,
  todaySpent,
  weekSpent,
  topCategoryName,
  topCategoryAmount,
  budget,
}: {
  monthLabel: string;
  thisMonth: number;
  lastMonth: number;
  deltaPercent: number | null;
  todaySpent: number;
  weekSpent: number;
  topCategoryName: string | null;
  topCategoryAmount: number;
  budget: {
    spent: number;
    cap: number;
    daysElapsed: number;
    daysInMonth: number;
  } | null;
}) {
  const hasDelta = deltaPercent !== null && lastMonth > 0;
  const deltaUp = (deltaPercent ?? 0) > 0;
  const deltaPct = hasDelta ? Math.abs(Math.round((deltaPercent ?? 0) * 100)) : 0;

  // Budget pacing: by today we expect (daysElapsed / daysInMonth)% spent.
  const expectedPct = budget
    ? budget.daysElapsed / budget.daysInMonth
    : 0;
  const actualPct = budget && budget.cap > 0 ? budget.spent / budget.cap : 0;
  const onPace = budget ? actualPct <= expectedPct + 0.05 : true;
  const budgetRemaining = budget ? Math.max(budget.cap - budget.spent, 0) : 0;

  return (
    <section
      aria-label={`Spent in ${monthLabel}`}
      className="relative isolate mb-6 overflow-hidden rounded-2xl border border-zinc-200/60 bg-gradient-to-br from-white to-zinc-50 p-5 shadow-sm dark:border-zinc-800/60 dark:from-zinc-950 dark:to-zinc-900 sm:p-7"
    >
      <div className="hero-aurora" aria-hidden />

      <div className="relative">
        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
          Spent in {monthLabel}
        </div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
          <span className="text-4xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50 sm:text-5xl">
            ₹<AnimatedNumber value={Math.round(thisMonth)} />
          </span>
          {hasDelta ? (
            <span
              className={
                "whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums " +
                (deltaUp
                  ? "bg-red-500/15 text-red-700 dark:text-red-300"
                  : "bg-green-500/15 text-green-700 dark:text-green-300")
              }
              title={`Last month: ${formatINR(lastMonth)}`}
            >
              {deltaUp ? "↑" : "↓"} {deltaPct}% vs last month
            </span>
          ) : null}
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2 sm:gap-3">
          <HeroTile
            label="Today"
            value={todaySpent > 0 ? formatINR(todaySpent) : "—"}
            href="/?range=today"
            tone="neutral"
          />
          <HeroTile
            label="This week"
            value={weekSpent > 0 ? formatINR(weekSpent) : "—"}
            href="/?range=week"
            tone="neutral"
          />
          <HeroTile
            label={topCategoryName ? `Top: ${topCategoryName}` : "Top category"}
            value={
              topCategoryName ? formatINR(topCategoryAmount) : "—"
            }
            href={
              topCategoryName
                ? `/?category=${encodeURIComponent(topCategoryName)}`
                : "/"
            }
            tone="warn"
          />
        </div>

        {budget ? (
          <div className="mt-5 space-y-2">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-zinc-700 dark:text-zinc-300">
                {formatINR(budgetRemaining)} left of {formatINR(budget.cap)} budget
              </span>
              <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                Day {budget.daysElapsed} / {budget.daysInMonth}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-zinc-200/70 dark:bg-zinc-800/70">
              <div
                className={
                  "h-full rounded-full transition-all duration-700 ease-out " +
                  (actualPct >= 1
                    ? "bg-red-500"
                    : actualPct >= 0.8
                      ? "bg-amber-500"
                      : "bg-emerald-500")
                }
                style={{ width: `${Math.min(actualPct, 1) * 100}%` }}
              />
            </div>
            <div className="text-xs text-zinc-600 dark:text-zinc-400">
              {onPace
                ? `On pace — using ${Math.round(actualPct * 100)}% of budget through ${Math.round(expectedPct * 100)}% of the month.`
                : `Over pace — ${Math.round(actualPct * 100)}% of budget used through ${Math.round(expectedPct * 100)}% of the month.`}
            </div>
          </div>
        ) : (
          <div className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
            <Link
              href="/settings/budgets"
              className="underline decoration-dotted underline-offset-2 hover:decoration-solid"
            >
              Set a monthly budget
            </Link>{" "}
            to track pace.
          </div>
        )}
      </div>
    </section>
  );
}

function HeroTile({
  label,
  value,
  href,
  tone,
}: {
  label: string;
  value: string;
  href: string;
  tone: "neutral" | "good" | "warn";
}) {
  const dotCls =
    tone === "good"
      ? "bg-green-500"
      : tone === "warn"
      ? "bg-amber-500"
      : "bg-zinc-400";
  return (
    <Link
      href={href}
      className="group relative flex min-h-[64px] flex-col justify-between rounded-xl border border-zinc-200/70 bg-white/70 px-3 py-2.5 backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-zinc-300 hover:bg-white active:scale-[0.98] dark:border-zinc-800/70 dark:bg-zinc-950/70 dark:hover:border-zinc-700 dark:hover:bg-zinc-950"
    >
      <div className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${dotCls}`} aria-hidden />
        <span className="truncate text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {label}
        </span>
      </div>
      <div className="truncate text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-50 sm:text-base">
        {value}
      </div>
    </Link>
  );
}

function BudgetMiniRow({ p }: { p: BudgetProgress }) {
  const pct = Math.min(p.percent, 1.2);
  const barColor =
    p.percent >= 1
      ? "bg-red-500"
      : p.percent >= 0.8
        ? "bg-amber-500"
        : "bg-emerald-500";
  return (
    <li>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="text-zinc-800 dark:text-zinc-200">
          {p.icon ? <span className="mr-1">{p.icon}</span> : null}
          {p.label}
        </span>
        <span className="tabular-nums text-xs text-zinc-600 dark:text-zinc-400">
          <strong className="text-zinc-900 dark:text-zinc-50">
            {formatINR(p.spent)}
          </strong>{" "}
          / {formatINR(p.cap)}
          <span className="ml-1 opacity-60">({Math.round(p.percent * 100)}%)</span>
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        <div
          className={`h-full rounded-full ${barColor}`}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
    </li>
  );
}

function preservedSearchParams(
  params: Record<string, string | undefined>
): Array<{ name: string; value: string }> {
  // Everything except `q` so a fresh search overwrites the previous query
  // but range/category/paymentMode stay in place.
  return Object.entries(params)
    .filter(([k, v]) => k !== "q" && typeof v === "string" && v.length > 0)
    .map(([name, value]) => ({ name, value: value as string }));
}

function SearchBar({
  defaultValue,
  preservedParams,
}: {
  defaultValue: string;
  preservedParams: Array<{ name: string; value: string }>;
}) {
  return (
    <form method="GET" action="/" className="mb-3">
      <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
        <span aria-hidden className="text-zinc-400">
          🔍
        </span>
        <input
          type="search"
          name="q"
          defaultValue={defaultValue}
          placeholder="Search merchant, note, or category (e.g. swiggy, goa, food)…"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-400 dark:text-zinc-50"
          autoComplete="off"
        />
        {preservedParams.map((p) => (
          <input key={p.name} type="hidden" name={p.name} value={p.value} />
        ))}
        {defaultValue ? (
          <Link
            href={`/?${new URLSearchParams(
              Object.fromEntries(preservedParams.map((p) => [p.name, p.value]))
            ).toString()}`}
            className="rounded-full px-2 py-0.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            title="Clear search"
          >
            ×
          </Link>
        ) : null}
        <button
          type="submit"
          className="rounded-md bg-zinc-900 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Search
        </button>
      </div>
    </form>
  );
}

function FilterChip({
  label,
  params,
  removeKey,
}: {
  label: string;
  params: Record<string, string | undefined>;
  removeKey: string;
}) {
  // Build a URL that drops `removeKey` while preserving the other params.
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v && k !== removeKey) next.set(k, v);
  }
  const qs = next.toString();
  return (
    <Link
      href={qs ? `/?${qs}` : "/"}
      className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 active:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
      title="Click to clear this filter"
    >
      <span>{label}</span>
      <span aria-hidden className="text-base leading-none">
        ×
      </span>
    </Link>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center dark:border-zinc-700 dark:bg-zinc-950">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        No expenses in this range. Try a wider window — or fetch more emails on
        Settings → Email.
      </p>
    </div>
  );
}
