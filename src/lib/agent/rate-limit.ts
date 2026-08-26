import "server-only";

/**
 * Lightweight in-memory rate limiting and daily cap.
 *
 * Scope assumptions:
 *   - State lives in this Node process only. On Vercel each warm instance keeps
 *     its own counters, so the effective limit is (instances x limit) — this
 *     slows a runaway client but does NOT stop a determined one. Before opening
 *     signups to strangers, move these buckets to the database or Redis so the
 *     cap is actually shared.
 *   - The "day" is UTC. Good enough for a soft cap; we're not billing.
 *
 * Two limits, intentional:
 *   - **RPM** stops a runaway client (or the user holding Enter) from
 *     hammering Gemini and burning per-minute quota.
 *   - **Daily cap** stops a single bad day from chewing through Gemini's
 *     free-tier daily allowance.
 */

const RPM_LIMIT = 5; // requests per rolling minute, per user
const DAILY_CAP = 100; // requests per UTC day, per user

type RpmBucket = { times: number[] /* request timestamps, ms */ };
type DailyBucket = { day: string; count: number };

const rpmByUser = new Map<string, RpmBucket>();
const dailyByUser = new Map<string, DailyBucket>();

function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export type RateCheck =
  | { ok: true; dailyUsed: number; dailyCap: number }
  | { ok: false; reason: "rpm" | "daily"; retryAfterSeconds: number; message: string };

/**
 * Check + record one usage atomically. Call this once per accepted request.
 * If it returns ok=false, the caller should reject the request and return
 * the suggested retry-after to the client.
 */
export function checkAndRecord(userId: string): RateCheck {
  const now = Date.now();
  const today = utcDay();

  // Daily cap
  let daily = dailyByUser.get(userId);
  if (!daily || daily.day !== today) {
    daily = { day: today, count: 0 };
    dailyByUser.set(userId, daily);
  }
  if (daily.count >= DAILY_CAP) {
    const tomorrow = new Date();
    tomorrow.setUTCHours(24, 0, 0, 0);
    const retry = Math.ceil((tomorrow.getTime() - now) / 1000);
    return {
      ok: false,
      reason: "daily",
      retryAfterSeconds: retry,
      message: `Daily chat cap reached (${DAILY_CAP} per day). Resets at UTC midnight.`,
    };
  }

  // RPM (rolling 60s window)
  let bucket = rpmByUser.get(userId);
  if (!bucket) {
    bucket = { times: [] };
    rpmByUser.set(userId, bucket);
  }
  const cutoff = now - 60_000;
  bucket.times = bucket.times.filter((t) => t > cutoff);
  if (bucket.times.length >= RPM_LIMIT) {
    const oldest = bucket.times[0];
    const retry = Math.max(1, Math.ceil((oldest + 60_000 - now) / 1000));
    return {
      ok: false,
      reason: "rpm",
      retryAfterSeconds: retry,
      message: `Rate limit: max ${RPM_LIMIT} questions per minute. Try again in ${retry}s.`,
    };
  }

  // Accept: record both
  bucket.times.push(now);
  daily.count += 1;
  return { ok: true, dailyUsed: daily.count, dailyCap: DAILY_CAP };
}

const SYNC_PER_MINUTE = 6;
const syncByUser = new Map<string, number[]>();

/**
 * Cap on-demand syncs. A sync costs a Gmail fetch plus an LLM batch, and the
 * model quota is shared across everyone — so this is really protecting other
 * users, not the server. Pull-to-refresh in normal use stays well under it.
 */
export function checkSyncRate(userId: string): RateCheck {
  const now = Date.now();
  const cutoff = now - 60_000;
  const times = (syncByUser.get(userId) ?? []).filter((t) => t > cutoff);

  if (times.length >= SYNC_PER_MINUTE) {
    const retry = Math.max(1, Math.ceil((times[0] + 60_000 - now) / 1000));
    syncByUser.set(userId, times);
    return {
      ok: false,
      reason: "rpm",
      retryAfterSeconds: retry,
      message: `Syncing too often. Try again in ${retry}s.`,
    };
  }

  times.push(now);
  syncByUser.set(userId, times);
  return { ok: true, dailyUsed: times.length, dailyCap: SYNC_PER_MINUTE };
}

export function getDailyUsage(userId: string): { used: number; cap: number } {
  const today = utcDay();
  const daily = dailyByUser.get(userId);
  if (!daily || daily.day !== today) return { used: 0, cap: DAILY_CAP };
  return { used: daily.count, cap: DAILY_CAP };
}
