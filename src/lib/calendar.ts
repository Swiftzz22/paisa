import "server-only";
import { prisma } from "@/lib/prisma";
import { atLocal, localParts } from "@/lib/time";

export type CalendarDay = {
  /** YYYY-MM-DD in the viewer's zone. */
  date: string;
  /** Debits only, in rupees — the same "spent" the hero counts. */
  total: number;
  count: number;
};

export type SpendingCalendar = {
  /** YYYY-MM. */
  month: string;
  /** The 1st up to today for the current month, the whole month for a past one. */
  days: CalendarDay[];
  noSpendDays: number;
  max: number;
};

const MONTH_KEY = /^(\d{4})-(\d{2})$/;
const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "2026-10" → year and 0-indexed month, or null for anything else. */
export function parseMonthKey(raw: string | null | undefined): { year: number; month: number } | null {
  const m = raw ? MONTH_KEY.exec(raw) : null;
  if (!m) return null;
  const month = +m[2] - 1;
  return month >= 0 && month <= 11 ? { year: +m[1], month } : null;
}

export function parseDayKey(
  raw: string | null | undefined
): { year: number; month: number; day: number } | null {
  const m = raw ? DAY_KEY.exec(raw) : null;
  if (!m) return null;
  const [year, month, day] = [+m[1], +m[2] - 1, +m[3]];
  const check = new Date(Date.UTC(year, month, day));
  return check.getUTCMonth() === month && check.getUTCDate() === day
    ? { year, month, day }
    : null;
}

function key(year: number, month: number, day?: number): string {
  const mm = String(month + 1).padStart(2, "0");
  return day === undefined ? `${year}-${mm}` : `${year}-${mm}-${String(day).padStart(2, "0")}`;
}

/**
 * Day-by-day spending for one local month, for the glowing calendar.
 *
 * Every day appears, zero days included, because a no-spend day is the thing
 * the calendar is there to celebrate. Days after today are left out rather
 * than shown as zeros, which would count the future as frugal.
 */
export async function getSpendingCalendar(
  userId: string,
  year: number,
  month: number,
  tzOffset: number,
  now = new Date()
): Promise<SpendingCalendar> {
  const from = atLocal(tzOffset, year, month, 1);
  const to = atLocal(tzOffset, year, month + 1, 0, 23, 59, 59, 999);
  const rows = await prisma.transaction.findMany({
    where: { userId, type: "debit", occurredAt: { gte: from, lte: to } },
    select: { occurredAt: true, amount: true },
  });

  const today = localParts(now, tzOffset);
  const inMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const isCurrent = today.year === year && today.month === month;
  const isFuture = year > today.year || (year === today.year && month > today.month);
  const lastDay = isFuture ? 0 : isCurrent ? today.day : inMonth;

  const totals = new Array<number>(inMonth + 1).fill(0);
  const counts = new Array<number>(inMonth + 1).fill(0);
  for (const r of rows) {
    const d = localParts(r.occurredAt, tzOffset).day;
    totals[d] += Number(r.amount);
    counts[d] += 1;
  }

  const days: CalendarDay[] = [];
  for (let d = 1; d <= lastDay; d++) {
    days.push({ date: key(year, month, d), total: Math.round(totals[d]), count: counts[d] });
  }
  return {
    month: key(year, month),
    days,
    noSpendDays: days.filter((d) => d.count === 0).length,
    max: days.reduce((m, d) => Math.max(m, d.total), 0),
  };
}

/** The UTC instants bounding one local day. */
export function localDayBounds(
  year: number,
  month: number,
  day: number,
  tzOffset: number
): { from: Date; to: Date } {
  return {
    from: atLocal(tzOffset, year, month, day),
    to: atLocal(tzOffset, year, month, day, 23, 59, 59, 999),
  };
}
