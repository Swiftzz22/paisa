import "server-only";
import { prisma } from "@/lib/prisma";
import { fetchRecent } from "@/lib/email/gmail";
import { getRefreshToken, markSynced } from "@/lib/email/account";
import { processPendingForUser } from "@/lib/email/process";
import { isGeminiConfigured } from "@/lib/email/parser";

/** Earliest date we want emails from. User asked for Jan 1, 2026 → today. */
const BACKFILL_START = new Date(2026, 0, 1);

/** How many older emails to pull per backfill tick. */
const BACKFILL_CHUNK_SIZE = 50;

/**
 * Wall-clock budget for one tick, with headroom under the cron route's 60s
 * maxDuration. A tick that blows the limit is killed mid-flight and returns a
 * 504 — the work it did still lands, but the caller sees only a failure. Better
 * to stop cleanly and let the next tick continue: every phase here is
 * resumable (backfill walks backward from the oldest stored email, and the
 * pending queue lives in the database).
 */
export const TICK_BUDGET_MS = 45_000;

/** Headroom the parse phase needs before it's worth starting at all. */
const PARSE_RESERVE_MS = 20_000;

type FetchedEmail = Awaited<ReturnType<typeof fetchRecent>>[number];

/**
 * Persist whichever of `messages` we haven't stored yet, in two queries.
 *
 * The previous per-message `findFirst` + `create` pair meant two sequential
 * round-trips per email — ~160 against a remote Turso for a full tick, which is
 * what pushed the cron past its budget as the backfill worked backwards.
 */
async function insertNewEmails(
  userId: string,
  messages: FetchedEmail[]
): Promise<number> {
  const ids: string[] = [];
  const seen = new Set<string>();
  const unique: FetchedEmail[] = [];
  for (const m of messages) {
    if (!m.messageId || seen.has(m.messageId)) continue;
    seen.add(m.messageId);
    ids.push(m.messageId);
    unique.push(m);
  }
  if (unique.length === 0) return 0;

  const existing = await prisma.receivedEmail.findMany({
    where: { userId, messageId: { in: ids } },
    select: { messageId: true },
  });
  const have = new Set(existing.map((e) => e.messageId));
  const fresh = unique.filter((m) => !have.has(m.messageId));
  if (fresh.length === 0) return 0;

  const { count } = await prisma.receivedEmail.createMany({
    data: fresh.map((m) => ({
      userId,
      messageId: m.messageId,
      fromAddress: m.fromAddress,
      subject: m.subject,
      rawHtml: m.html,
      bodyText: m.text,
      receivedAt: m.receivedAt,
      parseStatus: "pending",
    })),
  });
  return count;
}

export type SyncRunStatus = {
  ranAt: Date;
  fetched: number; // new emails persisted from Gmail this tick
  processed: { parsed: number; ignored: number; failed: number };
  backfillStillRunning: boolean;
  pendingRemaining: number;
  oldestInDb: Date | null;
  backfillComplete: boolean;
  account: string | null;
  error?: string;
  /** Set when the tick's time budget ran out before every phase had run. */
  stoppedEarly?: boolean;
};

// State on globalThis so it's shared across Turbopack module instances (the
// instrumentation hook and page rendering can load this module separately).
// lastRunByUser keys the most recent SyncRunStatus per userId so each user's
// settings page shows THEIR sync, not a global one.
declare global {
  // eslint-disable-next-line no-var
  var __syncState:
    | { lastRunByUser: Map<string, SyncRunStatus>; running: boolean }
    | undefined;
}
function syncState() {
  if (!globalThis.__syncState) {
    globalThis.__syncState = { lastRunByUser: new Map(), running: false };
  }
  return globalThis.__syncState;
}

export function getLastSyncRun(userId: string): SyncRunStatus | null {
  return syncState().lastRunByUser.get(userId) ?? null;
}

function emptyStatus(): SyncRunStatus {
  return {
    ranAt: new Date(),
    fetched: 0,
    processed: { parsed: 0, ignored: 0, failed: 0 },
    backfillStillRunning: false,
    pendingRemaining: 0,
    oldestInDb: null,
    backfillComplete: false,
    account: null,
  };
}

/**
 * Sync a single user: backfill older emails toward BACKFILL_START, pull the
 * most recent, then process one batch of pending emails into transactions.
 * Records the result in the per-user status map and returns it.
 */
export async function runSyncForUser(
  userId: string,
  deadline?: number
): Promise<SyncRunStatus> {
  const status = emptyStatus();
  const timeLeft = () =>
    deadline === undefined ? Number.POSITIVE_INFINITY : deadline - Date.now();
  const outOfTime = () => timeLeft() <= 0;

  try {
    const refreshToken = await getRefreshToken(userId);
    if (!refreshToken) {
      // No Gmail connected for this user — nothing to fetch.
      return status;
    }

    const account = await prisma.emailAccount.findUnique({
      where: { userId },
      select: { accountEmail: true },
    });
    status.account = account?.accountEmail ?? null;

    // 1. Backfill: walk backwards from the oldest stored email toward Jan 1.
    const oldest = await prisma.receivedEmail.findFirst({
      where: { userId },
      orderBy: { receivedAt: "asc" },
      select: { receivedAt: true },
    });
    const cursor = oldest?.receivedAt ?? new Date();
    if (cursor.getTime() > BACKFILL_START.getTime() && !outOfTime()) {
      const messages = await fetchRecent(refreshToken, {
        limit: BACKFILL_CHUNK_SIZE,
        after: BACKFILL_START,
        before: new Date(cursor),
        deadline,
      });
      const inserted = await insertNewEmails(userId, messages);
      status.fetched += inserted;
      status.backfillStillRunning = inserted > 0;
      await markSynced(userId);
    }

    // 2. Going-forward: pull the most recent financial-sender emails.
    if (!outOfTime()) {
      const recent = await fetchRecent(refreshToken, { limit: 30, deadline });
      status.fetched += await insertNewEmails(userId, recent);
    }

    // 3. Process one batch of pending emails into transactions. Needs room for
    // a whole LLM round-trip, so check for real headroom rather than merely
    // "not past the deadline" — starting this with two seconds left is how the
    // tick overran even with a budget in place.
    if (isGeminiConfigured() && timeLeft() >= PARSE_RESERVE_MS) {
      const result = await processPendingForUser(userId);
      status.processed.parsed = result.parsed;
      status.processed.ignored = result.ignored;
      status.processed.failed = result.failed;
    }

    status.stoppedEarly = outOfTime();
  } catch (e) {
    status.error = e instanceof Error ? e.message : String(e);
    console.error(`[sync] user ${userId} failed:`, e);
  } finally {
    // Always snapshot DB stats so the settings card stays informative even if
    // the Gmail fetch errored (e.g. expired token).
    try {
      const [newOldest, remaining] = await Promise.all([
        prisma.receivedEmail.findFirst({
          where: { userId },
          orderBy: { receivedAt: "asc" },
          select: { receivedAt: true },
        }),
        prisma.receivedEmail.count({
          where: { userId, parseStatus: { in: ["pending", "failed"] } },
        }),
      ]);
      status.oldestInDb = newOldest?.receivedAt ?? null;
      status.backfillComplete =
        !!newOldest &&
        newOldest.receivedAt.getTime() <= BACKFILL_START.getTime();
      status.pendingRemaining = remaining;
    } catch (snapErr) {
      console.error(`[sync] snapshot for ${userId} failed:`, snapErr);
    }
  }

  syncState().lastRunByUser.set(userId, status);
  return status;
}

/**
 * Background tick: sync EVERY user that has a connected email account.
 * Re-entrancy-safe (skips if a tick is already running). Processes users
 * sequentially to stay well under Gemini's rate limits.
 */
export async function runSyncTick(deadline?: number): Promise<void> {
  const state = syncState();
  if (state.running) return;
  state.running = true;
  try {
    const accounts = await prisma.emailAccount.findMany({
      select: { userId: true },
    });
    for (const { userId } of accounts) {
      // Stop handing out work once the budget is spent; the next tick picks up
      // the remaining users rather than the whole run dying on a timeout.
      if (deadline !== undefined && Date.now() >= deadline) break;
      await runSyncForUser(userId, deadline);
    }
  } catch (e) {
    console.error("[sync tick] failed to enumerate users:", e);
  } finally {
    state.running = false;
  }
}
