import { NextRequest } from "next/server";
import { getMobileUser } from "@/lib/auth/mobile";
import { runSyncForUser, getLastSyncRun, TICK_BUDGET_MS } from "@/lib/sync";
import { reconcileTransactionDates } from "@/lib/reconcile-dates";
import { checkSyncRate } from "@/lib/agent/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// A sync fetches Gmail + LLM-parses a batch; give it real headroom.
export const maxDuration = 60;

// Per-user in-flight guard so a mount-sync and a pull-to-refresh on the same
// warm instance don't run concurrently. (Best-effort across serverless
// instances; runSyncForUser's own existence checks prevent hard duplicates.)
const inFlight = new Set<string>();

/**
 * On-demand sync for the native app: pull the user's latest bank/UPI emails and
 * parse a batch into transactions. Called when the app opens and on pull-to-
 * refresh, so "open the app → see the latest" works without waiting for the
 * once-a-day cron.
 */
export async function POST(req: NextRequest) {
  const user = await getMobileUser(req.headers.get("authorization"));
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  // Each call costs a Gmail fetch plus an LLM batch, and the shared model quota
  // is the scarce resource — one account hammering this degrades everyone.
  const limit = checkSyncRate(user.id);
  if (!limit.ok) {
    return Response.json(
      { error: limit.message, fetched: 0, parsed: 0 },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      }
    );
  }

  if (inFlight.has(user.id)) {
    const last = getLastSyncRun(user.id);
    return Response.json({
      busy: true,
      fetched: 0,
      parsed: last?.processed.parsed ?? 0,
      pending: last?.pendingRemaining ?? 0,
    });
  }

  inFlight.add(user.id);
  try {
    // Same budget as the cron: a pull-to-refresh that overruns returns a 504
    // the app can only report as a generic failure.
    const status = await runSyncForUser(user.id, Date.now() + TICK_BUDGET_MS);
    // Correct any transactions whose stored date drifted from their email.
    const datesFixed = await reconcileTransactionDates(user.id);
    return Response.json({
      fetched: status.fetched,
      parsed: status.processed.parsed,
      pending: status.pendingRemaining,
      datesFixed,
      account: status.account,
      error: status.error ?? null,
    });
  } finally {
    inFlight.delete(user.id);
  }
}
