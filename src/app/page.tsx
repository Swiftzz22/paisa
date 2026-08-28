import Link from "next/link";
import { getCurrentUser } from "@/lib/user";
import { prisma } from "@/lib/prisma";
import { formatINR } from "@/lib/format";
import { paymentModeLabel } from "@/lib/categories";
import { parseRangeFromParams, toDateInput } from "@/lib/range";
import { getRangeSummary, type TxRow, type CategorySlice } from "@/lib/spending";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { recategorizeMiscAction } from "@/lib/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { SegmentedRange } from "@/components/SegmentedRange";
import { getBudgetProgress, getMonthOverMonthDelta } from "@/lib/budgets";
import { clockTime, dayRange, weekRange } from "@/lib/time";
import { getTzOffset } from "@/lib/tz-server";

export const dynamic = "force-dynamic";

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
  merchant?: string;
  q?: string;
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
  const { range, warning } = parseRangeFromParams(params, new Date(), tzOffset);
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
  for (const day of summary.byDay) {
    if (shownCount >= LIST_CAP) break;
    const txs = day.txs.slice(0, LIST_CAP - shownCount);
    cappedDays.push({ ...day, txs });
    shownCount += txs.length;
  }
  const listTruncated = summary.count > shownCount;

  return (
    <main className="mx-auto w-full max-w-md px-4 pb-6 pt-[max(1rem,env(safe-area-inset-top))] sm:max-w-lg sm:pt-6">
      <Header name={user.name} image={user.image} />

      <Hero
        monthLabel={budgetSummary.monthLabel}
        momDelta={momDelta}
        bars={summary.monthlyBars}
      />

      <SegmentedRange
        activePreset={range.preset}
        fromInput={toDateInput(range.from, tzOffset)}
        toInput={toDateInput(range.to, tzOffset)}
      />

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

      {budgetSummary.totalCap > 0 ? (
        <BudgetStrip
          spent={budgetSummary.totalSpent}
          cap={budgetSummary.totalCap}
          daysElapsed={budgetSummary.daysElapsed}
          daysInMonth={budgetSummary.daysInMonth}
        />
      ) : null}

      {params.status === "recategorized" ? (
        <Banner tone="ok">
          Re-categorized {params.misc} · {params.byRule} by rule, {params.byLlm} by
          AI, {params.unchanged} left.
          {params.rateLimited === "1" ? " Hit the rate limit — tap again in a minute." : ""}
        </Banner>
      ) : null}
      {params.ruleApplied && Number(params.ruleApplied) > 0 ? (
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
  momDelta,
  bars,
}: {
  monthLabel: string;
  momDelta: MomDelta;
  bars: Array<{ total: number }>;
}) {
  const hasDelta = momDelta.deltaPercent !== null && momDelta.lastMonth > 0;
  const up = (momDelta.deltaPercent ?? 0) > 0;
  const pct = hasDelta ? Math.abs(Math.round((momDelta.deltaPercent ?? 0) * 100)) : 0;
  const max = Math.max(1, ...bars.map((b) => b.total));
  const recent = bars.slice(-7);

  return (
    <section className="relative isolate overflow-hidden rounded-3xl border border-zinc-200/60 bg-gradient-to-br from-white to-zinc-50 p-5 shadow-sm dark:border-zinc-800/70 dark:from-zinc-900 dark:to-zinc-950">
      <div className="hero-aurora" aria-hidden />
      <div className="relative">
        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
          Spent in {monthLabel}
        </div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
          <span className="text-4xl font-bold tabular-nums tracking-tight text-zinc-900 dark:text-zinc-50">
            ₹<AnimatedNumber value={Math.round(momDelta.thisMonth)} />
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

        <div className="mt-4 flex h-10 items-end gap-1.5" aria-hidden>
          {recent.map((b, i) => (
            <div
              key={i}
              className={
                "flex-1 rounded-t-md " +
                (i === recent.length - 1
                  ? "bg-zinc-900 dark:bg-zinc-100"
                  : "bg-zinc-200 dark:bg-zinc-700")
              }
              style={{ height: `${Math.max(8, (b.total / max) * 100)}%` }}
            />
          ))}
        </div>
      </div>
    </section>
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

function BudgetStrip({
  spent,
  cap,
  daysElapsed,
  daysInMonth,
}: {
  spent: number;
  cap: number;
  daysElapsed: number;
  daysInMonth: number;
}) {
  const pct = cap > 0 ? spent / cap : 0;
  const expected = daysElapsed / daysInMonth;
  const color = pct >= 1 ? "bg-red-500" : pct >= 0.8 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <Link
      href="/settings/budgets"
      className="mt-3 block rounded-2xl border border-zinc-200/80 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/40"
    >
      <div className="mb-2 flex items-baseline justify-between text-sm">
        <span className="text-zinc-700 dark:text-zinc-300">
          {formatINR(Math.max(cap - spent, 0))} left of {formatINR(cap)}
        </span>
        <span className="text-xs tabular-nums text-zinc-400">
          Day {daysElapsed}/{daysInMonth}
        </span>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-zinc-200/80 dark:bg-zinc-800">
        <div
          className={"h-full rounded-full " + color}
          style={{ width: `${Math.min(pct, 1) * 100}%` }}
        />
        <div
          className="absolute top-[-2px] h-3 w-0.5 bg-zinc-400 dark:bg-zinc-500"
          style={{ left: `${Math.min(expected, 1) * 100}%` }}
          aria-hidden
        />
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
