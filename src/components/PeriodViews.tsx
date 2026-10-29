import Link from "next/link";
import { formatINR } from "@/lib/format";
import { MONTH_NAMES, localParts } from "@/lib/time";
import type { Grain, Period } from "@/lib/range";
import { DateJumpButton } from "@/components/DateJumpButton";

/**
 * Ways of seeing a period without scrolling through it.
 *
 * The dashboard used to answer "what did I spend in May?" with a total and
 * several hundred rows. Everything here exists to put the shape of a period on
 * one screen: which days it happened on, the few transactions that actually
 * moved the number, and arrows to step to the period before.
 */

export type DayTotal = {
  /** Day of the month. */
  day: number;
  spent: number;
  received: number;
  count: number;
  href: string;
};

// ── Period navigation ─────────────────────────────────────────────────────

const GRAINS: Array<{ id: Grain; label: string }> = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "year", label: "Year" },
];

/**
 * Arrows to step through periods, plus the size of period being viewed.
 *
 * Plain links rather than a client control: the choice belongs in the URL so it
 * survives a reload and can be shared, and it keeps this off the hydration path.
 */
export function PeriodBar({
  period,
  grainHref,
}: {
  period: Period;
  grainHref: (g: Grain) => string;
}) {
  return (
    <section className="mt-3 space-y-2">
      {/* A calendar button rather than arrows. Stepping one period at a time
          is fine for last month and hopeless for last March, and an exposed
          date field read as a form to fill in — so the picker hides behind the
          button and applies the moment a date is chosen. */}
      <form
        method="GET"
        action="/"
        className="relative flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/40"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {period.label}
            {period.isCurrent ? (
              <span className="ml-2 text-[11px] font-normal uppercase tracking-wide text-zinc-400">
                so far
              </span>
            ) : null}
          </span>
          <span className="block text-[11px] text-zinc-400">
            Tap the calendar to jump to any date
          </span>
        </span>
        <DateJumpButton grain={period.grain} />
      </form>

      <nav aria-label="Period size" className="grid grid-cols-4 gap-1.5">
        {GRAINS.map((g) => {
          const on = g.id === period.grain;
          return (
            <Link
              key={g.id}
              href={grainHref(g.id)}
              aria-current={on ? "true" : undefined}
              className={
                "flex min-h-[40px] items-center justify-center rounded-xl border text-sm font-medium " +
                (on
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                  : "border-zinc-200 text-zinc-600 dark:border-zinc-800 dark:text-zinc-400")
              }
            >
              {g.label}
            </Link>
          );
        })}
      </nav>
    </section>
  );
}

// ── Highlights ────────────────────────────────────────────────────────────

export type Highlight = {
  label: string;
  merchant: string;
  amount: number;
  sub: string;
  href: string;
  tone: "out" | "in" | "neutral";
};

/**
 * The two or three facts that explain a period's total.
 *
 * Almost every "where did it go?" is answered by the largest one or two
 * transactions, which previously required scrolling the whole list to find.
 */
export function Highlights({ items }: { items: Highlight[] }) {
  if (items.length === 0) return null;
  return (
    <section className="mt-3">
      <h2 className="mb-2 px-1 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        Highlights
      </h2>
      <div className="space-y-2">
        {items.map((h) => (
          <Link
            key={h.label}
            href={h.href}
            className="flex items-center gap-3 rounded-2xl border border-zinc-200/80 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900/40"
          >
            <span
              aria-hidden
              className={
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base " +
                (h.tone === "in"
                  ? "bg-emerald-500/15"
                  : h.tone === "out"
                    ? "bg-red-500/15"
                    : "bg-zinc-500/15")
              }
            >
              {h.tone === "in" ? "↓" : h.tone === "out" ? "↑" : "📅"}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] uppercase tracking-wide text-zinc-400">
                {h.label}
              </span>
              <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {h.merchant}
              </span>
              <span className="block truncate text-xs text-zinc-500">
                {h.sub}
              </span>
            </span>
            <span
              className={
                "shrink-0 text-sm font-semibold tabular-nums " +
                (h.tone === "in"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-zinc-900 dark:text-zinc-50")
              }
            >
              {h.tone === "in" ? "+" : "−"} {formatINR(h.amount)}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

// ── Calendar ──────────────────────────────────────────────────────────────

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

/**
 * A month on one screen.
 *
 * Each cell carries its spend, shaded by how heavy the day was relative to the
 * month's worst, so the pattern is visible at a glance and any day is one tap
 * away. This is the replacement for scrolling a list to find a date.
 */
export function CalendarMonth({
  monthStart,
  tzOffset,
  days,
}: {
  monthStart: Date;
  tzOffset: number;
  days: DayTotal[];
}) {
  const { year, month } = localParts(monthStart, tzOffset);
  const totalDays = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  // Monday-first, matching the week boundaries used everywhere else.
  const firstWeekday = (localParts(monthStart, tzOffset).weekday + 6) % 7;
  const byDay = new Map(days.map((d) => [d.day, d]));
  const max = Math.max(1, ...days.map((d) => d.spent));
  // Finished days count as no-spend when nothing went out. Today isn't over
  // and later days are the future; calling either frugal would be a lie.
  const today = localParts(new Date(), tzOffset);
  const lastPast =
    year < today.year || (year === today.year && month < today.month)
      ? totalDays
      : year === today.year && month === today.month
        ? today.day - 1
        : 0;
  const noSpendDays = Array.from({ length: lastPast }, (_, i) => i + 1).filter(
    (d) => !(byDay.get(d)?.spent ?? 0)
  ).length;

  const cells: Array<DayTotal | null> = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let day = 1; day <= totalDays; day++) {
    cells.push(byDay.get(day) ?? null2(day));
  }

  function null2(day: number): DayTotal {
    return { day, spent: 0, received: 0, count: 0, href: "" };
  }

  return (
    <section className="mt-3 rounded-2xl border border-zinc-200/80 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="mb-1 grid grid-cols-7 gap-1">
        {WEEKDAYS.map((w, i) => (
          <div
            key={i}
            className="text-center text-[10px] font-medium uppercase text-zinc-400"
          >
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell, i) => {
          if (!cell) return <span key={`pad-${i}`} />;
          const intensity = cell.spent > 0 ? cell.spent / max : 0;
          // Rupee blue, brighter with the day's spend: the same glow as the
          // app's backdrop, so a heavy day reads as lit up rather than dirty.
          const noSpend = cell.spent === 0 && cell.day <= lastPast;
          const shade = noSpend
            ? "border border-dashed border-emerald-500/60"
            : intensity === 0
              ? "bg-transparent"
              : "border border-blue-500/20";
          const glow =
            intensity > 0
              ? {
                  backgroundColor: `rgba(59, 130, 246, ${(0.1 + 0.7 * intensity).toFixed(2)})`,
                  boxShadow:
                    intensity > 0.6
                      ? `0 0 ${Math.round(6 + 10 * intensity)}px rgba(59, 130, 246, 0.45)`
                      : undefined,
                }
              : undefined;
          const inner = (
            <>
              <span className="block text-[11px] leading-none text-zinc-600 dark:text-zinc-300">
                {cell.day}
              </span>
              {cell.spent > 0 ? (
                <span
                  className={
                    "mt-0.5 block truncate text-[9px] leading-none tabular-nums " +
                    (intensity > 0.55 ? "text-white" : "text-zinc-700 dark:text-zinc-200")
                  }
                >
                  {compact(cell.spent)}
                </span>
              ) : null}
              {cell.received > 0 ? (
                <span
                  aria-hidden
                  className="mx-auto mt-0.5 block h-1 w-1 rounded-full bg-emerald-500"
                />
              ) : null}
            </>
          );
          const base =
            "flex min-h-[44px] flex-col items-center justify-center rounded-lg px-0.5 py-1 text-center " +
            shade;
          return cell.count > 0 ? (
            <Link
              key={cell.day}
              href={cell.href}
              title={`${cell.day} ${MONTH_NAMES[month].slice(0, 3)} — ${formatINR(cell.spent)}${cell.received > 0 ? `, ${formatINR(cell.received)} in` : ""}`}
              className={base}
              style={glow}
            >
              {inner}
            </Link>
          ) : (
            <span key={cell.day} className={base + (noSpend ? "" : " opacity-45")} style={glow}>
              {inner}
            </span>
          );
        })}
      </div>
      <p className="mt-2 text-center text-[11px] text-zinc-400">
        {noSpendDays > 0 ? (
          <span className="font-medium text-emerald-600 dark:text-emerald-400">
            {noSpendDays} no-spend {noSpendDays === 1 ? "day" : "days"} ·{" "}
          </span>
        ) : null}
        Brighter means a heavier day · a dot means money came in · tap a day
      </p>
    </section>
  );
}

// ── Week ──────────────────────────────────────────────────────────────────

/** The seven days of a week, side by side, with the same tap-to-filter. */
export function WeekStrip({
  days,
  tzOffset,
  weekStart,
}: {
  days: DayTotal[];
  tzOffset: number;
  weekStart: Date;
}) {
  const max = Math.max(1, ...days.map((d) => d.spent));
  const start = localParts(weekStart, tzOffset);
  return (
    <section className="mt-3 rounded-2xl border border-zinc-200/80 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="grid grid-cols-7 gap-1.5">
        {days.map((d, i) => {
          const label = WEEKDAYS[i];
          const height = d.spent > 0 ? Math.max(6, (d.spent / max) * 44) : 3;
          const inner = (
            <>
              <span className="block text-[10px] uppercase text-zinc-400">
                {label}
              </span>
              <span className="block text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
                {d.day}
              </span>
              <span className="mt-1 flex h-[46px] w-full items-end">
                <span
                  className={
                    "block w-full rounded-t " +
                    (d.spent > 0
                      ? "bg-zinc-900 dark:bg-zinc-100"
                      : "bg-zinc-200 dark:bg-zinc-800")
                  }
                  style={{ height: `${height}px` }}
                />
              </span>
              <span className="mt-1 block truncate text-[9px] tabular-nums text-zinc-500">
                {d.spent > 0 ? compact(d.spent) : "—"}
              </span>
            </>
          );
          const base =
            "flex min-h-[44px] flex-col items-center rounded-lg px-0.5 py-1 text-center";
          return d.count > 0 ? (
            <Link key={i} href={d.href} className={base} title={formatINR(d.spent)}>
              {inner}
            </Link>
          ) : (
            <span key={i} className={base + " opacity-50"}>
              {inner}
            </span>
          );
        })}
      </div>
      <p className="mt-2 text-center text-[11px] text-zinc-400">
        Week of {start.day} {MONTH_NAMES[start.month].slice(0, 3)} · tap a day
      </p>
    </section>
  );
}

/** ₹1,23,456 is too wide for a calendar cell; 1.2L is not. */
function compact(n: number): string {
  if (n >= 1e7) return `${(n / 1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(1)}L`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(Math.round(n));
}
