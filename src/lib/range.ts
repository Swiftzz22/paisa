// Date-range parsing and presets for the spending dashboard.
import { MONTH_NAMES, atLocal, localParts } from "@/lib/time";

export type RangePresetId =
  | "today"
  | "week"
  | "month"
  | "year"
  | "custom";

export type DateRange = {
  preset: RangePresetId;
  /** Inclusive start (00:00 local). */
  from: Date;
  /** Inclusive end (23:59:59.999 local). */
  to: Date;
  label: string;
};

// All boundaries are computed in the viewer's timezone (minutes ahead of UTC),
// not the server's. Rendering happens on Vercel in UTC, so using the server
// clock put a viewer in IST into days and months that began at 05:30 local.

function startOfDay(d: Date, tz: number): Date {
  const { year, month, day } = localParts(d, tz);
  return atLocal(tz, year, month, day);
}

function endOfDay(d: Date, tz: number): Date {
  const { year, month, day } = localParts(d, tz);
  return atLocal(tz, year, month, day, 23, 59, 59, 999);
}

function startOfMonth(d: Date, tz: number): Date {
  const { year, month } = localParts(d, tz);
  return atLocal(tz, year, month, 1);
}

function startOfYear(d: Date, tz: number): Date {
  return atLocal(tz, localParts(d, tz).year, 0, 1);
}

/** Monday as start of week (Indian convention varies; Monday is common). */
function startOfWeek(d: Date, tz: number): Date {
  const { year, month, day, weekday } = localParts(d, tz);
  const offset = (weekday + 6) % 7; // Mon=0, Sun=6
  return atLocal(tz, year, month, day - offset);
}

/** A YYYY-MM-DD input means that calendar date in the viewer's zone. */
function parseDateInput(s: string | undefined | null, tz: number): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = atLocal(tz, Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export function presetRange(
  preset: RangePresetId,
  now: Date = new Date(),
  tz = 0
): DateRange {
  const { year, month } = localParts(now, tz);
  switch (preset) {
    case "today":
      return {
        preset,
        from: startOfDay(now, tz),
        to: endOfDay(now, tz),
        label: "Today",
      };
    case "week": {
      return {
        preset,
        from: startOfWeek(now, tz),
        to: endOfDay(now, tz),
        label: "This week",
      };
    }
    case "month":
      return {
        preset,
        from: startOfMonth(now, tz),
        to: endOfDay(now, tz),
        label: `${MONTH_NAMES[month]} ${year}`,
      };
    case "year":
      return {
        preset,
        from: startOfYear(now, tz),
        to: endOfDay(now, tz),
        label: String(year),
      };
    case "custom":
      // Fallback only when parseRangeFromParams couldn't read from/to —
      // treat as "this month" so the user sees something useful.
      return presetRange("month", now, tz);
  }
}

export type ParseResult = {
  range: DateRange;
  warning: string | null;
};

/**
 * Parse a range from URL search params:
 *   ?range=today|week|month|year   → preset
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD → custom range
 *
 * Validation:
 *   - If from > to, swap them and return a warning.
 *   - If only one of from/to is present, fall back to default preset.
 *   - Default = month.
 */
export function parseRangeFromParams(
  params: { range?: string; from?: string; to?: string },
  now: Date = new Date(),
  tz = 0
): ParseResult {
  const fromDate = parseDateInput(params.from, tz);
  const toDate = parseDateInput(params.to, tz);

  if (fromDate && toDate) {
    let from = fromDate;
    let to = toDate;
    let warning: string | null = null;
    if (from.getTime() > to.getTime()) {
      // Swap silently rather than refuse — keep the user moving.
      [from, to] = [to, from];
      warning = "From date was after To — I swapped them.";
    }
    return {
      range: {
        preset: "custom",
        from: startOfDay(from, tz),
        to: endOfDay(to, tz),
        label: `${formatShort(from, tz)} – ${formatShort(to, tz)}`,
      },
      warning,
    };
  }

  const preset = (params.range ?? "month") as RangePresetId;
  const valid: RangePresetId[] = ["today", "week", "month", "year"];
  const chosen = valid.includes(preset) ? preset : "month";
  return { range: presetRange(chosen, now, tz), warning: null };
}

function formatShort(d: Date, tz: number): string {
  const { year, month, day } = localParts(d, tz);
  const thisYear = localParts(new Date(), tz).year;
  const base = `${String(day).padStart(2, "0")} ${MONTH_NAMES[month].slice(0, 3)}`;
  return year === thisYear ? base : `${base} ${year}`;
}

/** The YYYY-MM-DD a date falls on for the viewer — what a date input expects. */
export function toDateInput(d: Date, tz = 0): string {
  const { year, month, day } = localParts(d, tz);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

// ── Navigating whole periods ──────────────────────────────────────────────
//
// The presets above are all anchored to "now", which is fine for looking at
// the current day, week or month and useless for looking at a past one. These
// helpers describe an arbitrary period and step to the one before or after, so
// the dashboard can walk backwards a day or a week at a time rather than only
// offering a date picker.

/** The size of a period, independent of which one is selected. */
export type Grain = "day" | "week" | "month" | "year";

export type Period = {
  grain: Grain;
  from: Date;
  to: Date;
  /** "Tue 12 Aug", "12 – 18 Aug", "August 2026", "2026". */
  label: string;
  /** True when the period contains today, so the UI can say "Today". */
  isCurrent: boolean;
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function shortDate(d: Date, tz: number, withMonth = true): string {
  const { month, day } = localParts(d, tz);
  return withMonth ? `${day} ${MONTH_NAMES[month].slice(0, 3)}` : String(day);
}

/** The period of the given grain that contains `d`. */
export function periodContaining(grain: Grain, d: Date, tz: number): Period {
  const now = new Date();
  const p = localParts(d, tz);

  if (grain === "day") {
    const from = startOfDay(d, tz);
    const to = endOfDay(d, tz);
    const today = localParts(now, tz);
    const isToday =
      p.year === today.year && p.month === today.month && p.day === today.day;
    return {
      grain,
      from,
      to,
      label: isToday
        ? "Today"
        : `${DAY_NAMES[p.weekday]} ${p.day} ${MONTH_NAMES[p.month].slice(0, 3)}`,
      isCurrent: isToday,
    };
  }

  if (grain === "week") {
    const from = startOfWeek(d, tz);
    const endParts = localParts(from, tz);
    const to = atLocal(
      tz,
      endParts.year,
      endParts.month,
      endParts.day + 6,
      23,
      59,
      59,
      999
    );
    const fromP = localParts(from, tz);
    const toP = localParts(to, tz);
    // "12 – 18 Aug" when the week sits inside one month, "29 Jul – 4 Aug" when
    // it straddles two.
    const label =
      fromP.month === toP.month
        ? `${fromP.day} – ${toP.day} ${MONTH_NAMES[toP.month].slice(0, 3)}`
        : `${shortDate(from, tz)} – ${shortDate(to, tz)}`;
    const thisWeek = startOfWeek(now, tz);
    return { grain, from, to, label, isCurrent: +from === +thisWeek };
  }

  if (grain === "month") {
    const from = atLocal(tz, p.year, p.month, 1);
    const to = atLocal(tz, p.year, p.month + 1, 0, 23, 59, 59, 999);
    const nowP = localParts(now, tz);
    return {
      grain,
      from,
      to,
      label: `${MONTH_NAMES[p.month]} ${p.year}`,
      isCurrent: p.year === nowP.year && p.month === nowP.month,
    };
  }

  const from = atLocal(tz, p.year, 0, 1);
  const to = atLocal(tz, p.year, 11, 31, 23, 59, 59, 999);
  return {
    grain,
    from,
    to,
    label: String(p.year),
    isCurrent: p.year === localParts(now, tz).year,
  };
}

/** The same-sized period `step` places away (-1 = previous, +1 = next). */
export function shiftPeriod(period: Period, step: number, tz: number): Period {
  const p = localParts(period.from, tz);
  switch (period.grain) {
    case "day":
      return periodContaining("day", atLocal(tz, p.year, p.month, p.day + step), tz);
    case "week":
      return periodContaining(
        "week",
        atLocal(tz, p.year, p.month, p.day + step * 7),
        tz
      );
    case "month":
      return periodContaining("month", atLocal(tz, p.year, p.month + step, 1), tz);
    case "year":
      return periodContaining("year", atLocal(tz, p.year + step, 0, 1), tz);
  }
}

/**
 * Which grain a from/to range represents, if any.
 *
 * Lets an arbitrary custom range still drive the period arrows when it happens
 * to line up with a whole day, week or month — which is what every link the
 * dashboard generates produces.
 */
export function grainOfRange(range: DateRange, tz: number): Grain | null {
  for (const grain of ["day", "week", "month", "year"] as const) {
    const p = periodContaining(grain, range.from, tz);
    // Compared on the calendar day rather than the millisecond: "this month"
    // runs to today, not to the 31st, and should still count as a month.
    const a = localParts(p.from, tz);
    const b = localParts(range.from, tz);
    if (a.year !== b.year || a.month !== b.month || a.day !== b.day) continue;
    const pe = localParts(p.to, tz);
    const re = localParts(range.to, tz);
    if (pe.year === re.year && pe.month === re.month && pe.day === re.day) {
      return grain;
    }
    // A current period that ends "now" instead of at the period's end.
    if (p.isCurrent && re.year <= pe.year) return grain;
  }
  return null;
}
