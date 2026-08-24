/**
 * Period boundaries in the *viewer's* timezone.
 *
 * Every date range in this app used to be built from the server's clock, and
 * Vercel runs in UTC. For a user in IST that meant "today" ran from 05:30 to
 * 05:29 the next morning, so a 1am purchase landed on the previous day and a
 * 2am purchase on the 1st fell outside its own month.
 *
 * The offset is minutes ahead of UTC (+330 for IST). The mobile app sends it as
 * a query param; the web stores it in a cookie set by the browser, since a
 * server component has no other way to learn it. Absent means UTC, which
 * reproduces the old behaviour rather than guessing.
 *
 * No DST handling: correct for India, an hour out twice a year where it
 * applies. Doing better needs an IANA zone rather than a fixed offset.
 */

export const TZ_COOKIE = "tz_offset";

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Real-world offsets span UTC-14:00 to UTC+14:00. */
export function clampTzOffset(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-840, Math.min(840, Math.trunc(n)));
}

export type LocalParts = {
  year: number;
  month: number; // 0-indexed
  day: number;
  weekday: number; // 0 = Sunday
};

/**
 * Read `now` as wall-clock time in the target zone. Shifting the instant lets
 * the UTC getters report local components without touching server locale.
 */
export function localParts(now: Date, tzOffset: number): LocalParts {
  const shifted = new Date(now.getTime() + tzOffset * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
  };
}

/** A local wall-clock time, back as the UTC instant it actually happened. */
export function atLocal(
  tzOffset: number,
  year: number,
  month: number,
  day: number,
  hours = 0,
  minutes = 0,
  seconds = 0,
  ms = 0
): Date {
  return new Date(
    Date.UTC(year, month, day, hours, minutes, seconds, ms) - tzOffset * 60_000
  );
}

export type Range = { from: Date; to: Date; label: string };

export function dayRange(now: Date, tzOffset: number): Range {
  const { year, month, day } = localParts(now, tzOffset);
  return {
    from: atLocal(tzOffset, year, month, day),
    to: atLocal(tzOffset, year, month, day, 23, 59, 59, 999),
    label: "Today",
  };
}

/** Weeks start Monday. */
export function weekRange(now: Date, tzOffset: number): Range {
  const { year, month, day, weekday } = localParts(now, tzOffset);
  const back = (weekday + 6) % 7;
  return {
    from: atLocal(tzOffset, year, month, day - back),
    to: atLocal(tzOffset, year, month, day, 23, 59, 59, 999),
    label: "This week",
  };
}

/** `offsetMonths` of -1 gives last month, +1 next. */
export function monthRange(now: Date, tzOffset: number, offsetMonths = 0): Range {
  const { year, month } = localParts(now, tzOffset);
  const m = month + offsetMonths;
  // Day 0 of the following month is the last day of this one; Date.UTC
  // normalises month overflow, so December and January need no special case.
  const from = atLocal(tzOffset, year, m, 1);
  const to = atLocal(tzOffset, year, m + 1, 0, 23, 59, 59, 999);
  const named = new Date(Date.UTC(year, m, 1));
  return {
    from,
    to,
    label: `${MONTH_NAMES[named.getUTCMonth()]} ${named.getUTCFullYear()}`,
  };
}

export function yearRange(now: Date, tzOffset: number): Range {
  const { year } = localParts(now, tzOffset);
  return {
    from: atLocal(tzOffset, year, 0, 1),
    to: atLocal(tzOffset, year, 11, 31, 23, 59, 59, 999),
    label: `${year}`,
  };
}

/** Days in the local month containing `now`. */
export function daysInLocalMonth(now: Date, tzOffset: number): number {
  const { year, month } = localParts(now, tzOffset);
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** "YYYY-MM" for the local month an instant falls in — for bucketing. */
export function localMonthKey(at: Date, tzOffset: number): string {
  const { year, month } = localParts(at, tzOffset);
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}
