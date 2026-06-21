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
export async function runSyncForUser(userId: string): Promise<SyncRunStatus> {
  const status = emptyStatus();

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
    if (cursor.getTime() > BACKFILL_START.getTime()) {
      const messages = await fetchRecent(refreshToken, {
        limit: BACKFILL_CHUNK_SIZE,
        after: BACKFILL_START,
        before: new Date(cursor),
      });
      let inserted = 0;
      for (const m of messages) {
        if (!m.messageId) continue;
        const exists = await prisma.receivedEmail.findFirst({
          where: { userId, messageId: m.messageId },
          select: { id: true },
        });
        if (exists) continue;
        await prisma.receivedEmail.create({
          data: {
            userId,
            messageId: m.messageId,
            fromAddress: m.fromAddress,
            subject: m.subject,
            rawHtml: m.html,
            bodyText: m.text,
            receivedAt: m.receivedAt,
            parseStatus: "pending",
          },
        });
        inserted++;
      }
      status.fetched += inserted;
      status.backfillStillRunning = inserted > 0;
      await markSynced(userId);
    }

    // 2. Going-forward: pull the most recent financial-sender emails.
    const recent = await fetchRecent(refreshToken, { limit: 30 });
    for (const m of recent) {
      if (!m.messageId) continue;
      const exists = await prisma.receivedEmail.findFirst({
        where: { userId, messageId: m.messageId },
        select: { id: true },
      });
      if (exists) continue;
      await prisma.receivedEmail.create({
        data: {
          userId,
          messageId: m.messageId,
          fromAddress: m.fromAddress,
          subject: m.subject,
          rawHtml: m.html,
          bodyText: m.text,
          receivedAt: m.receivedAt,
          parseStatus: "pending",
        },
      });
      status.fetched++;
    }

    // 3. Process one batch of pending emails into transactions.
    if (isGeminiConfigured()) {
      const result = await processPendingForUser(userId);
      status.processed.parsed = result.parsed;
      status.processed.ignored = result.ignored;
      status.processed.failed = result.failed;
    }
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
export async function runSyncTick(): Promise<void> {
  const state = syncState();
  if (state.running) return;
  state.running = true;
  try {
    const accounts = await prisma.emailAccount.findMany({
      select: { userId: true },
    });
    for (const { userId } of accounts) {
      await runSyncForUser(userId);
    }
  } catch (e) {
    console.error("[sync tick] failed to enumerate users:", e);
  } finally {
    state.running = false;
  }
}
