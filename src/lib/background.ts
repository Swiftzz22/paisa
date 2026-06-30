import "server-only";
import { runSyncTick } from "@/lib/sync";

const INTERVAL_MS = 60_000; // every 60 seconds

let started = false;

/**
 * Start the in-process background sync. Idempotent — calls after the first
 * are no-ops, so Next.js HMR re-imports don't multiply the interval.
 */
export function startBackgroundSync(): void {
  if (started) return;
  started = true;

  console.log(`[bg sync] starting — every ${INTERVAL_MS / 1000}s`);

  // Fire one immediately, then on the interval. The first tick is wrapped
  // in setTimeout(0) so we don't block module load.
  setTimeout(() => {
    runTick();
  }, 1_000);

  setInterval(() => {
    runTick();
  }, INTERVAL_MS);
}

async function runTick() {
  try {
    // runSyncTick iterates all connected users and records per-user status
    // internally (see getLastSyncRun); it returns void.
    await runSyncTick();
  } catch (e) {
    console.error("[bg sync] tick error:", e);
  }
}
