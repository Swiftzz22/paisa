import { NextRequest } from "next/server";
import { getMobileUser } from "@/lib/auth/mobile";
import { runSyncForUser, getLastSyncRun } from "@/lib/sync";
import { reconcileTransactionDates } from "@/lib/reconcile-dates";

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
    const status = await runSyncForUser(user.id);
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
