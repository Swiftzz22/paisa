// Date-range parsing and presets for the spending dashboard.

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

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

function startOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 0, 1, 0, 0, 0, 0);
}

/** Monday as start of week (Indian convention varies; Monday is common). */
function startOfWeek(d: Date): Date {
  const dayOfWeek = d.getDay(); // 0 = Sun
  const offset = (dayOfWeek + 6) % 7; // Mon=0, Sun=6
  const x = startOfDay(d);
  x.setDate(x.getDate() - offset);
  return x;
}

function parseDateInput(s: string | undefined | null): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function presetRange(preset: RangePresetId, now: Date = new Date()): DateRange {
  switch (preset) {
    case "today":
      return {
        preset,
        from: startOfDay(now),
        to: endOfDay(now),
        label: "Today",
      };
    case "week": {
      return {
        preset,
        from: startOfWeek(now),
        to: endOfDay(now),
        label: "This week",
      };
    }
    case "month":
      return {
        preset,
        from: startOfMonth(now),
        to: endOfDay(now),
        label: `${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`,
      };
    case "year":
      return {
        preset,
        from: startOfYear(now),
        to: endOfDay(now),
        label: String(now.getFullYear()),
      };
    case "custom":
      // Fallback only when parseRangeFromParams couldn't read from/to —
      // treat as "this month" so the user sees something useful.
      return presetRange("month", now);
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
  now: Date = new Date()
): ParseResult {
  const fromDate = parseDateInput(params.from);
  const toDate = parseDateInput(params.to);

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
        from: startOfDay(from),
        to: endOfDay(to),
        label: `${formatShort(from)} – ${formatShort(to)}`,
      },
      warning,
    };
  }

  const preset = (params.range ?? "month") as RangePresetId;
  const valid: RangePresetId[] = ["today", "week", "month", "year"];
  const chosen = valid.includes(preset) ? preset : "month";
  return { range: presetRange(chosen, now), warning: null };
}

function formatShort(d: Date): string {
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
}

export function toDateInput(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
