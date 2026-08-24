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
