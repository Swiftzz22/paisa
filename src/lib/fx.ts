import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Exchange rates for foreign-currency spending.
 *
 * Free sources, no keys, nothing to bill:
 *   1. fawazahmed0/currency-api on jsDelivr — 200+ currencies, one file per day
 *      going back years, which is what makes "the rate on the day you bought
 *      it" possible at all.
 *   2. The same data on Cloudflare Pages, for when jsDelivr is having a day.
 *   3. Frankfurter (ECB) — ~30 major currencies only, kept as a last resort.
 *
 * Every source publishes once a day. That is the honest ceiling of free rates,
 * and it is plenty for spending: nobody's coffee in Singapore needs the rate to
 * the second.
 *
 * Days are cached in FxRateDay forever. A past day never changes, so after the
 * first person asks about a date, answering it again is a single row read.
 */

/** India Standard Time — the default when the app doesn't say. */
const IST_MINUTES = 330;

/** How far back to look when a day has no published rates (weekend, or today
 *  before the source has published). A week covers every real gap. */
const MAX_LOOKBACK_DAYS = 7;

export type FxQuote = {
  currency: string;
  /** INR for one unit of `currency`. */
  inrPerUnit: number;
  /** The day the rate is actually from. */
  rateDate: string;
  source: string;
};

export class FxUnavailableError extends Error {}

/** ISO 4217-shaped. Rejects garbage before it becomes a URL or a cache miss. */
export function normalizeCurrency(raw: string): string | null {
  const c = raw.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : null;
}

/** The calendar day a moment falls on for someone `tzOffset` minutes ahead of UTC. */
export function localDate(at: Date, tzOffsetMinutes = IST_MINUTES): string {
  return new Date(at.getTime() + tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

function previousDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

type Day = { date: string; rates: Record<string, number>; source: string };

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** fawazahmed0 publishes lowercase codes, crypto included; keep fiat-shaped ones. */
function fromFawaz(json: unknown, source: string): Day | null {
  const j = json as { date?: string; inr?: Record<string, number> } | null;
  if (!j?.date || !j.inr) return null;
  const rates: Record<string, number> = {};
  for (const [code, v] of Object.entries(j.inr)) {
    const c = normalizeCurrency(code);
    if (c && typeof v === "number" && v > 0) rates[c] = v;
  }
  return { date: j.date, rates, source };
}

/** The full (200+ currency) day from currency-api, via either mirror. */
async function fetchFullDay(date: string): Promise<Day | null> {
  const path = "v1/currencies/inr.min.json";
  const jsdelivr = await fetchJson(
    `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/${path}`
  );
  const a = fromFawaz(jsdelivr, "currency-api");
  if (a) return a;
  const pages = await fetchJson(`https://${date}.currency-api.pages.dev/${path}`);
  return fromFawaz(pages, "currency-api");
}

/**
 * Frankfurter, only once currency-api has failed outright. It answers a
 * weekend or an unpublished today with the last working day, so its date is
 * taken from the response rather than assumed.
 */
async function fetchFrankfurter(date: string): Promise<Day | null> {
  const ff = (await fetchJson(`https://api.frankfurter.dev/v1/${date}?base=INR`)) as {
    date?: string;
    rates?: Record<string, number>;
  } | null;
  if (!ff?.date || !ff.rates) return null;
  return { date: ff.date, rates: ff.rates, source: "frankfurter" };
}

async function cachedDay(date: string): Promise<Day | null> {
  const row = await prisma.fxRateDay.findUnique({ where: { date } });
  if (!row) return null;
  return { date: row.date, rates: JSON.parse(row.rates), source: row.source };
}

async function storeDay(day: Day): Promise<void> {
  // A full currency-api day replaces a partial Frankfurter one, never the
  // other way round.
  const existing = await prisma.fxRateDay.findUnique({
    where: { date: day.date },
    select: { source: true },
  });
  if (existing && existing.source !== "frankfurter") return;
  await prisma.fxRateDay.upsert({
    where: { date: day.date },
    create: { date: day.date, rates: JSON.stringify(day.rates), source: day.source },
    update: { rates: JSON.stringify(day.rates), source: day.source, fetchedAt: new Date() },
  });
}

/**
 * INR per unit of `currency` on `date` (YYYY-MM-DD), or the nearest earlier
 * day that has a published rate.
 */
export async function getInrRate(currency: string, date: string): Promise<FxQuote> {
  const code = normalizeCurrency(currency);
  if (!code) throw new FxUnavailableError(`"${currency}" isn't a currency code.`);
  if (code === "INR") {
    return { currency: "INR", inrPerUnit: 1, rateDate: date, source: "identity" };
  }

  // Nothing is published for the future; ask for today instead.
  const today = new Date().toISOString().slice(0, 10);
  const start = date > today ? today : date;
  const quote = (d: Day): FxQuote => ({
    currency: code,
    inrPerUnit: 1 / d.rates[code],
    rateDate: d.date,
    source: d.source,
  });

  // Walk back from the purchase day to the nearest day currency-api published.
  let day = start;
  for (let i = 0; i <= MAX_LOOKBACK_DAYS; i++, day = previousDay(day)) {
    let full = await cachedDay(day);
    if (full?.source === "frankfurter") full = null; // partial; try for the full day
    if (!full) {
      full = await fetchFullDay(day);
      if (full) await storeDay(full);
    }
    if (!full) continue; // nothing published that day — look one day earlier
    if (code in full.rates) return quote(full);
    // A complete day without this code means it isn't a currency anyone
    // quotes. Walking back further would only spend requests on the same no.
    throw new FxUnavailableError(`No exchange rate found for ${code}.`);
  }

  // currency-api unreachable for the whole window: last resort.
  const ff = await fetchFrankfurter(start);
  if (ff) {
    await storeDay(ff);
    if (code in ff.rates) return quote(ff);
  }
  throw new FxUnavailableError(`No exchange rate found for ${code} around ${date}.`);
}

/** Convert, rounded to the paisa. */
export function toInr(originalAmount: number, inrPerUnit: number): number {
  return Math.round(originalAmount * inrPerUnit * 100) / 100;
}

/** The foreign half of a create/edit body. */
export type OriginalInput = { amount: number; currency: string };

export type ResolvedFx = {
  /** What goes in `Transaction.amount`. */
  inrAmount: number;
  fields: {
    originalAmount: number | null;
    originalCurrency: string | null;
    fxRate: number | null;
    fxRateDate: string | null;
  };
};

export const NO_FX: ResolvedFx["fields"] = {
  originalAmount: null,
  originalCurrency: null,
  fxRate: null,
  fxRateDate: null,
};

/**
 * Turn a receipt amount into rupees using the rate for the day it was spent.
 * The rate is always looked up here — never accepted from the client.
 */
export async function resolveOriginal(
  original: OriginalInput,
  occurredAt: Date,
  tzOffsetMinutes = IST_MINUTES
): Promise<ResolvedFx> {
  const quote = await getInrRate(original.currency, localDate(occurredAt, tzOffsetMinutes));
  if (quote.currency === "INR") {
    return { inrAmount: original.amount, fields: NO_FX };
  }
  return {
    inrAmount: toInr(original.amount, quote.inrPerUnit),
    fields: {
      originalAmount: original.amount,
      originalCurrency: quote.currency,
      fxRate: quote.inrPerUnit,
      fxRateDate: quote.rateDate,
    },
  };
}
